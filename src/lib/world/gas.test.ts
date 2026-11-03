import { test } from "node:test";
import assert from "node:assert/strict";
import { atoms, units } from "./amount.ts";
import { applyCommand, createWorld, quoteGasTopup, stepWorld } from "./engine.ts";
import { validateWorld } from "./repository.ts";
import type { World } from "./types.ts";
const chains=["solana","bnb","base"] as const;
const config={seed:"gas-service-ledger",mode:"free" as const,regime:"rotation" as const,spawnPerMinute:6,protection:true,duration:120};
function emptyGas() {
  const w=createWorld(config);
  w.bank.base.native=(BigInt(w.bank.base.native)+BigInt(w.wallet.base.native)).toString();
  w.wallet.base.native="0";
  return w;
}
function totals(w:World) {
  return {
    native:chains.map(chain=>BigInt(w.wallet[chain].native)+BigInt(w.bank[chain].native)+BigInt(w.treasury[chain].native)+BigInt(w.burnt[chain])+w.participants.reduce((sum,p)=>sum+BigInt(p.balances[chain]),0n)+w.tokens.filter(t=>t.chain===chain).reduce((sum,t)=>sum+BigInt(t.pool.quote),0n)),
    stable:chains.reduce((sum,chain)=>sum+BigInt(w.wallet[chain].stable)+BigInt(w.bank[chain].stable)+BigInt(w.treasury[chain].stable),0n)+w.bridges.filter(b=>b.status==="in_transit").reduce((sum,b)=>sum+BigInt(b.amount),0n),
  };
}
test("zero-gas account buys gas using same-chain stable with explicit provider-paid gas and exact conservation",()=>{
  const w=emptyGas(),initial=totals(w),gross=atoms("10"),quote=quoteGasTopup(w,"base",gross);
  assert.equal(quote.ok,true);assert.equal(quote.serviceFeeUsd,atoms("0.05"));
  assert.equal(quote.gasUsd,atoms("0.35"));assert.equal(quote.totalFeeUsd,atoms("0.4"));
  assert.equal(quote.nativeOut,atoms("0.00384"));
  const request=applyCommand(w,{id:"topup-zero",type:"gas_topup",chain:"base",amount:gross,note:"付费补充本链gas"});
  assert.equal(request.ok,true,request.error);assert.equal(request.world.wallet.base.native,"0");assert.equal(request.world.transactions[0].status,"pending");
  assert.equal(request.world.wallet.base.stable,w.wallet.base.stable);
  const done=stepWorld(request.world,3),tx=done.transactions[0];
  assert.equal(tx.status,"confirmed");assert.equal(tx.out,quote.nativeOut);assert.equal(tx.feeUsd,0.4);
  assert.equal(done.wallet.base.native,quote.nativeOut);
  assert.equal(BigInt(w.wallet.base.stable)-BigInt(done.wallet.base.stable),BigInt(gross));
  assert.equal(BigInt(done.bank.base.stable)-BigInt(w.bank.base.stable),BigInt(gross)-BigInt(quote.serviceFeeUsd));
  assert.equal(BigInt(w.bank.base.native)-BigInt(done.bank.base.native),BigInt(quote.nativeOut)+BigInt(quote.gasNative));
  assert.deepEqual(totals(done),initial);assert.equal(done.feesUsd,0.4);
  assert.equal(validateWorld(done),true);assert.equal(validateWorld(JSON.parse(JSON.stringify(done))),true);
  const replay=applyCommand(done,{id:"topup-zero",type:"gas_topup",chain:"base",amount:gross,note:"重复同一命令"});
  assert.equal(replay.world,done);
});
test("service rejects insufficient gross, wrong-chain funding and absent provider reserves without mutations",()=>{
  const w=emptyGas();
  assert.equal(quoteGasTopup(w,"base",atoms("0.35")).ok,false);
  assert.equal(quoteGasTopup(w,"base",atoms("2")).serviceFeeUsd,atoms("0.02"));
  const before=structuredClone(w);w.wallet.base.stable="0";
  const noStable=applyCommand(w,{id:"no-stable",type:"gas_topup",chain:"base",amount:atoms("10"),note:"其他链的钱不能冒用"});
  assert.equal(noStable.ok,false);assert.equal(noStable.world,w);assert.equal(w.wallet.base.native,"0");assert.ok(BigInt(w.wallet.solana.stable)>0n);
  before.bank.base.native="0";
  const noBank=applyCommand(before,{id:"no-provider",type:"gas_topup",chain:"base",amount:atoms("10"),note:"没有免费铸币"});
  assert.equal(noBank.ok,false);assert.equal(noBank.world,before);
});
test("provider reserve disappearance while queued reverts atomically and charges neither wallet nor provider",()=>{
  const w=emptyGas(),request=applyCommand(w,{id:"reserve-race",type:"gas_topup",chain:"base",amount:atoms("10"),note:"排队复核"});
  assert.equal(request.ok,true);
  const queued=request.world;
  queued.treasury.base.native=(BigInt(queued.treasury.base.native)+BigInt(queued.bank.base.native)).toString();queued.bank.base.native="0";
  const initial=totals(queued),stable=queued.wallet.base.stable;
  const done=stepWorld(queued,3),tx=done.transactions[0];
  assert.equal(tx.status,"reverted");assert.equal(tx.feeUsd,undefined);assert.equal(tx.out,undefined);assert.equal(tx.gasService,undefined);
  assert.equal(done.wallet.base.native,"0");assert.equal(done.wallet.base.stable,stable);assert.equal(done.feesUsd,0);assert.deepEqual(totals(done),initial);
  assert.equal(validateWorld(done),true);
});
test("execution-time FX determines sponsored gas and output; fee receipt cannot be forged on restore",()=>{
  const w=emptyGas(),request=applyCommand(w,{id:"fx-move",type:"gas_topup",chain:"base",amount:atoms("10"),note:"按执行时汇率"});
  request.world.fx.base*=2;
  const done=stepWorld(request.world,3),tx=done.transactions[0];
  assert.equal(tx.status,"confirmed");assert.equal(tx.gasService?.gasUsd,atoms("0.7"));assert.equal(tx.feeUsd,0.75);
  assert.equal(units(tx.out!),9.25/5000);
  assert.equal(validateWorld(done),true);
  const forged=structuredClone(done);forged.transactions[0].gasService!.gasUsd="0";
  assert.equal(validateWorld(forged),false);
  const noEvent=structuredClone(done);noEvent.events=noEvent.events.filter(event=>event.type!=="gas_topup");
  assert.equal(validateWorld(noEvent),false);
});
test("settlement cancels pending topup without service fees and rejects new requests",()=>{
  const w=emptyGas(),request=applyCommand(w,{id:"pending-end",type:"gas_topup",chain:"base",amount:atoms("10"),note:"待处理补gas"});
  const done=applyCommand(request.world,{id:"finish",type:"finish"}).world;
  assert.equal(done.transactions[0].status,"cancelled");assert.equal(done.transactions[0].out,undefined);assert.equal(done.feesUsd,0);assert.equal(done.wallet.base.native,"0");
  assert.equal(done.wallet.base.stable,w.wallet.base.stable);assert.equal(validateWorld(done),true);
  const settling=structuredClone(request.world);settling.phase="settling";settling.settlementStartedAt=0;
  assert.equal(applyCommand(settling,{id:"too-late",type:"gas_topup",chain:"base",amount:atoms("10"),note:"结束后不新增"}).ok,false);
});
