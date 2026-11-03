import { test } from "node:test";
import assert from "node:assert/strict";
import { atoms } from "./amount.ts";
import {
  applyCommand,
  createWorld,
  quoteTrade,
  settleWorld,
  stepWorld,
  tokenPrice,
} from "./engine.ts";
import { buildProcessReport, classifyTokenOutcomes, validateTradePlan } from "./process.ts";
import { validateWorld, worldSchema } from "./repository.ts";
import type { TradePlan, World, WorldConfig } from "./types.ts";

const config: WorldConfig = {
  seed: "process-evidence-v1",
  mode: "free",
  regime: "rotation",
  generationProfile: "mixed-v1",
  assessmentVersion: "process-v1",
  duration: 120,
  spawnPerMinute: 6,
  protection: true,
};
function buy(w: World, id = "planned-buy", overrides: Partial<TradePlan> = {}) {
  const token = w.tokens.find((t) => t.easterEgg === "btc")!;
  const price = tokenPrice(token);
  const plan: TradePlan = {
    version: "plan-v1",
    thesis: "probe",
    maxLossUsd: 100,
    invalidationPrice: price * 0.5,
    targetPrice: price * 10,
    maxHoldSeconds: 30,
    maxImpactPct: 5,
    evidence: ["lp", "permissions", "liquidity", "concentration"],
    ...overrides,
  };
  const result = applyCommand(w, {
    id,
    type: "buy",
    tokenId: token.id,
    amount: atoms("0.002"),
    minOut: "0",
    note: "小额验证",
    stopPrice: plan.invalidationPrice,
    targetPrice: plan.targetPrice,
    plan,
  });
  assert.equal(result.ok, true, result.error);
  return { world: result.world, token, plan };
}
test("new process assessment freezes public snapshots, times out once and scores actual execution", () => {
  let { world: w } = buy(createWorld(config));
  w = stepWorld(w, 3);
  const tx = w.transactions.find((tx) => tx.id === "planned-buy")!;
  assert.equal(tx.status, "confirmed");
  assert.ok(tx.process?.confirmedAt);
  assert.equal(tx.process?.permissions.mint, false);
  assert.equal(validateWorld(w), true, JSON.stringify(worldSchema.safeParse(w)));
  w = stepWorld(w, 36);
  const saved = w.transactions.find((tx) => tx.id === "planned-buy")!;
  assert.equal(saved.process?.trigger, "timeout");
  assert.equal(saved.process?.remaining, "0");
  assert.ok(saved.process?.exitTransactionId?.startsWith("auto-"));
  assert.equal(w.transactions.filter((tx) => tx.type === "sell").length, 1);
  const report = buildProcessReport(w);
  assert.equal(report.score, 100);
  assert.equal(report.decisions, 1);
  w = settleWorld(w);
  assert.equal(w.report?.assessmentVersion, "process-v1");
  assert.equal(w.report?.discipline.execution, 100);
  assert.equal(w.report?.outcomes?.length, w.tokens.length);
  assert.equal(validateWorld(w), true, JSON.stringify(worldSchema.safeParse(w)));
  const forged = structuredClone(w);
  forged.report!.process!.score = 99;
  forged.report!.discipline.execution = 99;
  assert.equal(validateWorld(forged), false);
  const forgedOutcome = structuredClone(w);
  forgedOutcome.report!.outcomes![0].classification = "quality";
  assert.equal(validateWorld(forgedOutcome), false);
});
test("long notes cannot substitute for a plan and no-action has no fabricated execution sample", () => {
  const w = createWorld(config),
    t = w.tokens.find((t) => t.easterEgg === "btc")!;
  const missing = applyCommand(w, {
    id: "no-plan",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.002"),
    minOut: "0",
    note: "计划写得再长也不能代替数值预算和事实",
  });
  assert.equal(missing.ok, true);
  const filled = stepWorld(missing.world, 3);
  assert.equal(buildProcessReport(filled).score, 0);
  assert.equal(buildProcessReport(w).score, 0);
  const legacy = settleWorld(
    createWorld({ ...config, assessmentVersion: undefined, generationProfile: undefined }),
  );
  assert.equal(legacy.report?.process, undefined);
  assert.equal(legacy.report?.discipline.execution, 80);
});
test("frozen old exams stay legacy and new version permits mixed assessment with mandatory plan", () => {
  assert.throws(() => createWorld({ ...config, mode: "exam", assessmentVersion: undefined }));
  const w = createWorld({ ...config, mode: "exam" });
  const t = w.tokens.find((t) => t.easterEgg === "btc")!;
  const missing = applyCommand(w, {
    id: "exam-missing",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.002"),
    minOut: "0",
    note: "这是非常长的交易理由",
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error!, /冻结/);
  assert.equal(validateWorld(w), true);
  assert.equal(buy(w).world.transactions[0].plan?.thesis, "probe");
});
test("invalid numeric plans reject before submission and public snapshots contain no hidden intent", () => {
  const { world: w, plan, token } = buy(createWorld(config));
  assert.equal(
    validateTradePlan({ ...plan, invalidationPrice: Infinity }, tokenPrice(token)),
    false,
  );
  assert.equal(validateTradePlan({ ...plan, evidence: ["intent"] }, tokenPrice(token)), false);
  const snapshot = JSON.stringify(w.transactions[0].process);
  assert.doesNotMatch(snapshot, /incidentAt|appeal|latent|intent/);
  const result = applyCommand(createWorld(config), {
    id: "invalid",
    type: "buy",
    tokenId: token.id,
    amount: atoms("0.002"),
    minOut: "0",
    note: "依据",
    plan: { ...plan, targetPrice: 0 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.world.transactions.length, 0);
});
test("failed timeout exit remains an attempted exit and does not repeatedly burn gas", () => {
  let { world: w, token } = buy(createWorld(config));
  w = stepWorld(w, 3);
  const actual = w.tokens.find((t) => t.id === token.id)!;
  actual.frozen = true;
  w = stepWorld(w, 40);
  const lot = w.transactions.find((tx) => tx.id === "planned-buy")!;
  assert.equal(lot.process?.trigger, "timeout");
  assert.ok(lot.process?.exitAttemptAt);
  assert.equal(w.transactions.filter((tx) => tx.type === "sell").length, 1);
  const attempts = w.transactions.filter((tx) => tx.type === "sell");
  assert.equal(attempts[0].status, "reverted");
  assert.equal(
    buildProcessReport(w).checks.find((check) => check.id.endsWith(":exit"))?.passed,
    true,
  );
});
test("post-submission FX movement is recorded without falsely scoring a budget violation", () => {
  const initial = createWorld(config), token = initial.tokens.find(t => t.easterEgg === "btc")!;
  const quote = quoteTrade(initial, token.id, "buy", atoms("0.002"));
  const cap = (Number(atoms("0.002")) + Number(quote.gas)) / 1e6 * initial.fx.base + 0.000001;
  const { world: w } = buy(initial, "planned-buy", { maxLossUsd: cap });
  w.fx.base *= 2;
  const filled = stepWorld(w, 3),
    tx = filled.transactions.find((tx) => tx.id === "planned-buy")!;
  assert.ok(tx.process!.filledCostUsd! > tx.plan!.maxLossUsd);
  assert.equal(
    buildProcessReport(filled).checks.find((check) => check.id.endsWith(":budget"))?.passed,
    true,
  );
});
test("unused budget headroom and caller edits do not alter the frozen decision", () => {
  const { world: w, plan } = buy(createWorld(config), "planned-buy", { maxLossUsd: 1000 });
  plan.maxLossUsd = 1;
  plan.evidence.length = 0;
  const filled = stepWorld(w, 3);
  assert.equal(filled.transactions[0].plan!.maxLossUsd, 1000);
  assert.equal(filled.transactions[0].plan!.evidence.length, 4);
  assert.equal(buildProcessReport(filled).checks.find(check => check.id.endsWith(":budget"))?.passed, true);
});
test("outcome labels require completed observation and actual executed evidence, never intent alone", () => {
  const w = createWorld(config);
  assert.deepEqual(
    classifyTokenOutcomes(w, (t, a) => quoteTrade(w, t.id, "sell", a)),
    [],
  );
  const ended = settleWorld(w),
    t = ended.tokens[4];
  t.latent.intent = "pull";
  t.latent.fired = true;
  ended.events = ended.events.filter((event) => event.tokenId !== t.id);
  const without = classifyTokenOutcomes(ended, (token, amount) =>
    quoteTrade(ended, token.id, "sell", amount),
  );
  assert.notEqual(without.find((item) => item.tokenId === t.id)?.classification, "rug");
  ended.events.push({
    id: "unsupported-label",
    seq: ended.nextId++,
    at: ended.now,
    type: "liquidity_removed",
    message: "只有文字，没有执行增量",
    tokenId: t.id,
    chain: t.chain,
  });
  assert.notEqual(
    classifyTokenOutcomes(ended, (token, amount) =>
      quoteTrade(ended, token.id, "sell", amount),
    ).find((item) => item.tokenId === t.id)?.classification,
    "rug",
  );
  t.pool.lpLocked = false;
  ended.events.push({
    id: "actual-pull",
    seq: ended.nextId++,
    at: ended.now,
    type: "liquidity_removed",
    message: "实际撤池证据",
    tokenId: t.id,
    chain: t.chain,
    effect: { field: "pool_quote", before: "10000", after: "500" },
  });
  const withAttack = classifyTokenOutcomes(ended, (token, amount) =>
    quoteTrade(ended, token.id, "sell", amount),
  );
  assert.equal(withAttack.find((item) => item.tokenId === t.id)?.classification, "rug");
  assert.deepEqual(withAttack.find((item) => item.tokenId === t.id)?.eventIds, ["actual-pull"]);
});
