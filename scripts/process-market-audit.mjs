#!/usr/bin/env node
/** Local simulator audit. Policies receive public snapshots, never latent intent or future quotes. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { applyCommand, createWorld, quoteTrade, settleWorld, stepWorld, tokenPrice } from "../src/lib/world/engine.ts";
import { atoms, units } from "../src/lib/world/amount.ts";
import { compactArchive, validateCheckpoint, validateWorld } from "../src/lib/world/repository.ts";
import { random } from "../src/lib/world/random.ts";

const regimes=["inflow","rotation","outflow","stress"];
const variants=["standard","thin","busy","costly"];
const chains=["solana","bnb","base"];
const rounded=value=>Math.round(value*1e6)/1e6;
const jsonClone=value=>JSON.parse(JSON.stringify(value));
function totals(world) {
  return {
    native:chains.map(chain=>[world.wallet[chain].native,world.treasury[chain].native,world.bank[chain].native,world.burnt[chain],...world.participants.map(p=>p.balances[chain]),...world.tokens.filter(t=>t.chain===chain).map(t=>t.pool.quote)].reduce((sum,value)=>sum+BigInt(value),0n).toString()),
    stable:(chains.reduce((sum,chain)=>sum+BigInt(world.wallet[chain].stable)+BigInt(world.treasury[chain].stable)+BigInt(world.bank[chain].stable),0n)+world.bridges.filter(b=>b.status==="in_transit").reduce((sum,b)=>sum+BigInt(b.amount),0n)).toString(),
  };
}
function check(world,initial) {
  assert.deepEqual(totals(world),initial,"native and stable conservation");
  for(const token of world.tokens) {
    const total=BigInt(token.pool.token)+BigInt(token.creatorTokens)+BigInt(world.lockedTokens[token.id]??"0")+BigInt(world.positions[token.id]?.quantity??"0")+world.participants.reduce((sum,p)=>sum+BigInt(p.tokens[token.id]??"0"),0n);
    assert.equal(total,BigInt(token.supply),`supply ${token.id}`);
    assert.ok(token.history.length<=240);
    assert.ok(token.history.every(point=>point.t<=world.now),"no future quote");
  }
  assert.ok(validateWorld(world),"strict world validation");
  assert.ok(validateCheckpoint({version:1,world,reports:world.report?[world.report]:[],archives:[],speed:10,selectedId:null,revision:1}),"checkpoint evidence validation");
}
/** Deliberately excludes latent fields, unexecuted incidents and future state. */
function publicMarket(world) {
  return world.tokens.map(token=> {
    const price=tokenPrice(token),old=token.history.filter(p=>p.t<=world.now-60).at(-1);
    return {id:token.id,chain:token.chain,price,age:world.now-token.bornAt,holders:token.holders,
      liquidityUsd:units(token.pool.quote)*world.fx[token.chain],creatorPct:Number(BigInt(token.creatorTokens))/Number(BigInt(token.supply))*100,
      lpLocked:token.pool.lpLocked,mintAuthority:token.mintAuthority,freezeAuthority:token.freezeAuthority,taxMutable:token.taxMutable,
      frozen:token.frozen,sellTaxBps:token.sellTaxBps,status:token.status,momentumPct:old?.price>0?(price/old.price-1)*100:0};
  });
}
function choosePolicy(snapshot,policy,seed,at) {
  const tradable=snapshot.filter(t=>!t.frozen && !["dead","migrating"].includes(t.status) && t.price>0 && t.liquidityUsd>0);
  if(policy==="cash" || !tradable.length)return null;
  if(policy==="random")return tradable[Math.floor(random(seed,"audit-choice",at)*tradable.length)];
  return tradable.filter(t=>t.lpLocked && !t.mintAuthority && !t.freezeAuthority && !t.taxMutable && t.creatorPct<=20 && t.liquidityUsd>=1000 && t.holders>=5 && t.age>=60 && t.momentumPct>0)
    .sort((a,b)=>b.momentumPct-a.momentumPct || a.id.localeCompare(b.id))[0]??null;
}
function policyCommand(world,policy,at) {
  const selected=choosePolicy(publicMarket(world),policy,world.config.seed,at);
  if(!selected)return {selected:null,ok:false,world};
  const amount=atoms((10/world.fx[selected.chain]).toFixed(6)), quote=quoteTrade(world,selected.id,"buy",amount);
  if(!quote.ok || BigInt(world.wallet[selected.chain].native)<BigInt(amount)+BigInt(quote.gas))return {selected,ok:false,world};
  const plan={version:"plan-v1",thesis:"probe",maxLossUsd:25,invalidationPrice:selected.price*.8,targetPrice:selected.price*1.5,maxHoldSeconds:180,maxImpactPct:5,evidence:["lp","permissions","liquidity","concentration","momentum"]};
  const command={id:`audit-${policy}-${at}`,type:"buy",tokenId:selected.id,amount,minOut:(BigInt(quote.amountOut)*95n/100n).toString()};
  const result=applyCommand(world,world.config.assessmentVersion==="process-v2-trading"?command:{...command,note:"固定公开策略小额验证",plan,stopPrice:plan.invalidationPrice,targetPrice:plan.targetPrice});
  return {...result,selected};
}
function summary(values) {
  const sorted=values.slice().sort((a,b)=>a-b);
  return {min:rounded(sorted[0]??0),median:rounded(sorted[Math.floor(sorted.length*.5)]??0),p95:rounded(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]??0),max:rounded(sorted.at(-1)??0)};
}
function configFor(index,seconds,assessment="process-v1") {
  return {seed:`process-audit-v1-${index}`,mode:seconds===7200?"exam":"free",regime:regimes[Math.floor(index/4)%4],marketVariant:variants[index%4],generationProfile:"mixed-v1",assessmentVersion:assessment,spawnPerMinute:6,protection:true,duration:seconds};
}
function manualPolicyExits(world,policy) {
  let current=world;
  for(const position of Object.values(world.positions)) {
    if(BigInt(position.quantity)<=0n || world.now-position.firstAt<180 || current.transactions.some(tx=>tx.tokenId===position.tokenId && tx.type==="sell" && tx.status==="pending"))continue;
    const q=quoteTrade(current,position.tokenId,"sell",position.quantity);if(!q.ok)continue;
    const r=applyCommand(current,{id:`manual-${policy}-${position.tokenId}-${world.now}`,type:"sell",tokenId:position.tokenId,amount:position.quantity,minOut:(BigInt(q.amountOut)*95n/100n).toString()});
    if(r.ok)current=r.world;
  }
  return current;
}
function runPolicy(index,policy,seconds,assessment) {
  const started=performance.now(),config=configFor(index,seconds,assessment);
  let world=createWorld(config),restores=0,attempts=0,submissions=0,unsafeSelections=0;
  const initial=totals(world),stepTimes=[];
  check(world,initial);
  for(let at=0;at<seconds;at+=60) {
    if(assessment==="process-v2-trading" && policy!=="cash")world=manualPolicyExits(world,policy);
    if(at%600===0 && at+180<seconds && policy!=="cash") {
      const next=policyCommand(world,policy,at);world=next.world;
      if(next.selected){attempts++;if(!next.selected.lpLocked||next.selected.mintAuthority||next.selected.freezeAuthority||next.selected.taxMutable||next.selected.creatorPct>20)unsafeSelections++;}
      if(next.ok)submissions++;
    }
    const before=performance.now();world=stepWorld(world,Math.min(60,seconds-at));stepTimes.push(performance.now()-before);
    if(world.now%1200===0) {
      check(world,initial);
      const restored=jsonClone(world);assert.ok(validateWorld(restored));
      assert.deepEqual(jsonClone(stepWorld(restored,1)),jsonClone(stepWorld(world,1)),"JSON restore replay");
      world=restored;restores++;
    }
  }
  if(world.phase!=="completed")world=settleWorld(world);
  check(world,initial);
  const archive=jsonClone(compactArchive(world));assert.ok(validateWorld(archive),"compact archive restore");
  const report=world.report;
  return {index,seed:config.seed,policy,regime:config.regime,marketVariant:config.marketVariant,engineVersion:world.engineVersion,
    simulatedSeconds:world.now,attempts,submissions,unsafeSelections,confirmedBuys:world.transactions.filter(t=>t.type==="buy"&&t.status==="confirmed").length,
    trades:report.trades,fees:report.fees,pnl:report.pnl,excessPct:report.excessPct,drawdownPct:report.maxDrawdownPct,residual:report.residual,violations:report.violations,
    processScore:report.process.score,processDecisions:report.process.decisions,tokens:world.tokens.length,active:world.tokens.filter(t=>!["dead","dormant"].includes(t.status)).length,
    assessmentVersion:assessment,manualConfirmedSells:world.transactions.filter(tx=>tx.type==="sell" && tx.status==="confirmed" && tx.source==="manual").length,
    restores,conservationPassed:true,checkpointPassed:true,archivePassed:true,step60Ms:summary(stepTimes),runtimeMs:rounded(performance.now()-started)};
}
function runLong(seconds,assessment) {
  const started=performance.now();let world=createWorld({...configFor(0,seconds,assessment),seed:"process-long-mixed-v1",mode:"free"});
  const initial=totals(world),stepTimes=[],samples=[];let restores=0;
  for(let at=0;at<seconds;at+=600) {
    const before=performance.now();world=stepWorld(world,Math.min(600,seconds-at));stepTimes.push(performance.now()-before);
    check(world,initial);
    world=jsonClone(world);assert.ok(validateWorld(world));restores++;
    samples.push({at:world.now,tokens:world.tokens.length,active:world.tokens.filter(t=>!["dead","dormant"].includes(t.status)).length,maxHistory:Math.max(...world.tokens.map(t=>t.history.length)),bytes:Buffer.byteLength(JSON.stringify(world))});
  }
  world=settleWorld(world);check(world,initial);assert.ok(validateWorld(jsonClone(compactArchive(world))));
  return {seed:world.config.seed,engineVersion:world.engineVersion,config:world.config,simulatedSeconds:world.now,runtimeMs:rounded(performance.now()-started),restores,conservationPassed:true,checkpointPassed:true,archivePassed:true,step600Ms:summary(stepTimes),samples};
}
function pairedInterval(values) {
  if(!values.length)return null;
  const boot=[];
  for(let i=0;i<10000;i++) {let sum=0;for(let j=0;j<values.length;j++)sum+=values[Math.floor(random("audit-ci-v1",`${i}`,j)*values.length)];boot.push(sum/values.length);}
  boot.sort((a,b)=>a-b);
  return {n:values.length,mean:rounded(values.reduce((a,b)=>a+b,0)/values.length),lower95:rounded(boot[250]),upper95:rounded(boot[9749]),method:"seeded paired bootstrap, 10000 resamples; small synthetic sample, not evidence of real-world returns"};
}
if(!isMainThread) {
  const results=[];
  for(const index of workerData.indices)for(const policy of ["cash","random","signal"]) {const result=runPolicy(index,policy,workerData.seconds,workerData.assessment);results.push(result);parentPort.postMessage({progress:{index,policy,runtimeMs:result.runtimeMs,pnl:result.pnl}});}
  parentPort.postMessage({results});
} else {
  const args=process.argv.slice(2),arg=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
  const count=Math.max(1,Math.min(64,Number(arg("--cases",16)))),seconds=Number(arg("--seconds",7200)),longSeconds=Number(arg("--long-seconds",21600));
  const assessment=arg("--assessment","process-v1");assert.ok(["process-v1","process-v2-trading"].includes(assessment));
  assert.ok(Number.isInteger(seconds)&&seconds>=120&&seconds<=86400);
  assert.ok(Number.isInteger(longSeconds)&&longSeconds>=120&&longSeconds<=86400*7);
  const output=arg("--output","work/process-market-audit.json"),started=performance.now();
  const partitions=Array.from({length:Math.min(2,count)},()=>[]);for(let i=0;i<count;i++)partitions[i%partitions.length].push(i);
  const parts=await Promise.all(partitions.map(indices=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{indices,seconds,assessment}});
    worker.on("message",message=>{if(message.progress)console.log(JSON.stringify(message.progress));else resolve(message.results);});worker.on("error",reject);worker.on("exit",code=>{if(code!==0)reject(new Error(`audit worker exit ${code}`));});
  })));
  const runs=parts.flat().sort((a,b)=>a.index-b.index||a.policy.localeCompare(b.policy));
  const longRun=runLong(longSeconds,assessment),policies=Object.fromEntries(["cash","random","signal"].map(policy=>{const rows=runs.filter(r=>r.policy===policy);return [policy,{worlds:rows.length,meanPnl:rounded(rows.reduce((sum,r)=>sum+r.pnl,0)/rows.length),meanFees:rounded(rows.reduce((sum,r)=>sum+r.fees,0)/rows.length),trades:rows.reduce((sum,r)=>sum+r.trades,0),unsafeSelections:rows.reduce((sum,r)=>sum+r.unsafeSelections,0),profitableWorlds:rows.filter(r=>r.pnl>0).length,maxDrawdownPct:Math.max(...rows.map(r=>r.drawdownPct))}];}));
  const differences=Array.from({length:count},(_,index)=>runs.find(r=>r.index===index&&r.policy==="signal").pnl-runs.find(r=>r.index===index&&r.policy==="random").pnl);
  const result={auditVersion:assessment==="process-v2-trading"?"process-market-audit-v2-trading":"process-market-audit-v1",createdAt:new Date().toISOString(),node:process.version,config:{generationProfile:"mixed-v1",assessmentVersion:assessment,cases:count,seconds,matched:["seed","regime","marketVariant"],regimes,variants,baseGasAtoms:assessment==="process-v2-trading"?{solana:"50",bnb:"20",base:"4"}:{solana:"12000",bnb:"1800",base:"140"}},
    policyDefinitions:{cash:"No commands; unchanged entry portfolio.",random:assessment==="process-v2-trading"?"Every600s, seeded uniform public tradable project; $10 stake, algorithm manually sells remaining holdings after180s if executable, 5%slippage; simulator guide -15%/+30%/900s safety is not scored as manual skill. No written plan or reason sent. Actual teaching fees/delays.":"Every600s, seeded uniform public tradable project; $10 stake, max180s, -20%/+50% bracket, 5%slippage and actual fees/delays.",signal:"Same schedule,size,exit rule; public lockedLP, revoked mint/freeze/tax, creator<=20%, depth>=$1000, holders>=5, age>=60s and positive prior60s momentum; highest current momentum. No latent/future reads."},
    policies,pairedSignalMinusRandomPnl:pairedInterval(differences),runs,longRun,runtimeMs:rounded(performance.now()-started),
    limitations:["Synthetic local market; no real-market calibration or profit guarantee.","Only one fixed public-signal policy and one random policy; a win or loss does not validate all strategies or all users.","Bootstrap interval measures variability across this small matched synthetic seed grid, not real trading uncertainty.","Native balances and capital restrictions remain real in the simulation; insufficient funding creates rejected opportunities rather than free money.","Runtime is Node on this machine, not a mobile browser latency benchmark."]};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify({output,policies,pairedSignalMinusRandomPnl:result.pairedSignalMinusRandomPnl,longRun:{seconds:longRun.simulatedSeconds,tokens:longRun.samples.at(-1).tokens,restores:longRun.restores,runtimeMs:longRun.runtimeMs},runtimeMs:result.runtimeMs},null,2));
}
