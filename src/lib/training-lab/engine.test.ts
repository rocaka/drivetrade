import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLabAction,
  createLab,
  evaluateLabs,
  LEGACY_LAB_CHALLENGES,
  labConservation,
  labPrice,
  labResult,
  makeLabRun,
  replayLabRun,
  validateLabRun,
} from "./engine.ts";
import type { LabAction } from "./types.ts";
const buy = (tokenId = "token-a", cents = 400): LabAction => ({
  type: "buy",
  tokenId,
  cents,
  slippageBps: 500,
  ttlSteps: 6,
});
const sell = (tokenId = "token-a", percent: 25 | 50 | 100 = 100): LabAction => ({
  type: "sell",
  tokenId,
  percent,
});
const inspect = (tokenId = "token-a"): LabAction => ({ type: "inspect", tokenId });
function solution(index: number, seed = "test-seed"): LabAction[] {
  const start = createLab(`practice-${index}`, seed),
    a = start.tokens[0];
  const actions: LabAction[] = [inspect()];
  if (index === 1 || index === 3 || index === 8) actions.push(buy(), sell());
  if (index === 2) actions.push({ type: "fund", chain: "base", cents: 200 }, sell());
  if (index === 4)
    actions.push(
      { type: "plan", tokenId: a.id, stopPrice: labPrice(a) * 0.85 },
      { type: "wait", steps: 2 },
      sell(),
    );
  if (index === 5 || index === 7) actions.push({ type: "wait", steps: 4 });
  if (index === 6) actions.push(sell("token-a", 25), { type: "wait", steps: 3 }, sell());
  if (index === 9)
    actions.push(
      { type: "bridge", from: "solana", to: "base", cents: 1000 },
      { type: "wait", steps: 3 },
      { type: "fund", chain: "base", cents: 100 },
      buy(),
      sell(),
    );
  if (index === 10)
    actions.push({ type: "wait", steps: 2 }, buy(), { type: "wait", steps: 2 }, sell());
  if (index === 11) actions.push(inspect("token-b"), inspect("token-c"), sell(), sell("token-b"));
  if (index === 12) actions.push(sell(), { type: "wait", steps: 4 });
  actions.push({ type: "finish" });
  return actions;
}
test("all twelve practical competencies have an actual executable successful path across seeds", () => {
  for (const seed of ["test-seed", "different-market", "third-market"])
    for (let i = 1; i <= 12; i++) {
      const run = makeLabRun(`practice-${i}`, seed, solution(i, seed));
      assert.equal(run.result.passed, true, `${seed} lab${i}: ${JSON.stringify(run.result)}`);
      assert.equal(validateLabRun(run), true, `${i} replay`);
    }
});
test("every transition conserves cash including fees/in-transit and token inventory", () => {
  for (let i = 1; i <= 12; i++) {
    let s = createLab(`practice-${i}`, "conservation");
    for (const action of solution(i, "conservation")) {
      s = applyLabAction(s, action);
      assert.equal(labConservation(s), s.initialConservation, `${i} ${action.type}`);
      for (const t of s.tokens)
        assert.equal(
          t.poolUnits + t.npcUnits + (s.positions[t.id]?.units ?? 0),
          t.initialPoolUnits,
        );
      assert.ok(
        [...Object.values(s.cash), ...Object.values(s.gas), s.feesCents].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ),
      );
    }
  }
});
test("empty finish and blind wrong-chain trade do not award practical mastery", () => {
  assert.equal(makeLabRun("practice-1", "seed", [{ type: "finish" }]).result.passed, false);
  const wrong = makeLabRun("practice-1", "seed", [
    inspect("token-b"),
    buy("token-b"),
    sell("token-b"),
    { type: "finish" },
  ]);
  assert.equal(wrong.result.passed, false);
});
test("AMM roundtrip costs money and frozen exits never fabricate a sell", () => {
  const run = makeLabRun("practice-8", "seed", solution(8, "seed"));
  assert.ok(run.result.pnlCents < 0);
  let s = createLab("practice-6", "seed");
  s = applyLabAction(s, { type: "wait", steps: 3 });
  const before = s.positions["token-a"].units,
    cash = s.cash.base,
    gas = s.gas.base;
  s = applyLabAction(s, sell());
  assert.equal(s.positions["token-a"].units, before);
  assert.equal(s.cash.base, cash);
  assert.equal(s.gas.base, gas - 10);
});
test("bridge deducts once, cannot be spent early, settles once, and gas funding uses local cash", () => {
  let s = createLab("practice-9", "bridge");
  s = applyLabAction(s, { type: "bridge", from: "solana", to: "base", cents: 1000 });
  assert.equal(s.cash.base, 0);
  const quoted = labConservation(s);
  s = applyLabAction(s, buy());
  assert.equal(s.facts.buyCount, 0);
  assert.equal(labConservation(s), quoted);
  s = applyLabAction(s, { type: "wait", steps: 3 });
  assert.equal(s.cash.base, 1000);
  s = applyLabAction(s, { type: "fund", chain: "base", cents: 100 });
  assert.equal(s.cash.base, 900);
  assert.equal(s.gas.base, 100);
  s = applyLabAction(s, { type: "wait", steps: 3 });
  assert.equal(s.cash.base, 900);
});
test("replay refuses forged results, extra fields, invalid actions and post-finish edits", () => {
  const run = makeLabRun("practice-1", "valid", solution(1, "valid"));
  assert.equal(
    validateLabRun({ ...run, result: { ...run.result, pnlCents: run.result.pnlCents + 1 } }),
    false,
  );
  assert.equal(validateLabRun({ ...run, result: { ...run.result, score: 0 } }), false);
  assert.equal(validateLabRun({ ...run, extra: "accept me" }), false);
  assert.equal(
    validateLabRun({ ...run, actions: [...run.actions, { type: "wait", steps: 1 }] }),
    false,
  );
  assert.equal(
    validateLabRun({ ...run, actions: [{ type: "buy", tokenId: "token-a", cents: -500 }] }),
    false,
  );
});
test("stopping rules, queue results, capacity and immutable loss plans are enforced by actual state", () => {
  let s = createLab("practice-12", "stop");
  s = applyLabAction(s, buy());
  assert.equal(s.facts.buyCount, 0);
  assert.equal(s.facts.addedAfterStop, true);
  s = createLab("practice-3", "capacity");
  s = applyLabAction(s, buy("token-a", 800));
  assert.equal(s.facts.capacityViolation, true);
  s = createLab("practice-4", "plan");
  s = applyLabAction(s, {
    type: "plan",
    tokenId: "token-a",
    stopPrice: labPrice(s.tokens[0]) * 0.85,
  });
  const stop = s.stopPlans["token-a"];
  s = applyLabAction(s, { type: "plan", tokenId: "token-a", stopPrice: stop * 0.8 });
  assert.equal(s.stopPlans["token-a"], stop);
  s = createLab("practice-10", "queue");
  s = applyLabAction(s, buy());
  assert.equal(s.facts.duplicatePending, true);
  assert.equal(s.orders.length, 1);
});
test("initial public lab state contains no future quote path and deterministic replay freezes results", () => {
  const initial = createLab("practice-4", "history");
  assert.equal(initial.tokens[0].history.length, 1);
  assert.ok(!JSON.stringify(initial).includes("incidentAt"));
  const run = makeLabRun("practice-4", "history", solution(4, "history"));
  assert.deepEqual(labResult(replayLabRun(run)), run.result);
  assert.deepEqual(createLab("practice-4", "history"), initial);
  assert.throws(() =>
    replayLabRun({ ...run, actions: Array.from({ length: 201 }, () => inspect()) }),
  );
});
test("graduation requires all twelve replay-validated competencies and preserves failures", () => {
  const runs = LEGACY_LAB_CHALLENGES.map((c, i) =>
    makeLabRun(c.id, "group", solution(i + 1, "group")),
  );
  assert.equal(
    evaluateLabs(runs).passed,
    false,
    "legacy competencies remain historical, never upgraded into trading-v2 graduation",
  );
  assert.equal(evaluateLabs(runs.slice(0, 11)).passed, false);
  const bad = makeLabRun("practice-12", "failed", [{ type: "finish" }]);
  assert.equal(evaluateLabs([...runs.slice(0, 11), bad]).passed, false);
});
