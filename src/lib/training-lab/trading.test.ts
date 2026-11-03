import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLabAction,
  createLab,
  evaluateLabs,
  LAB_CHALLENGES,
  labConservation,
  labResult,
  makeLabRun,
  replayLabRun,
  validateLabRun,
  tradingBuyQuote,
} from "./engine.ts";
import * as legacy from "./legacy.ts";
import { passingTradingActions as actions } from "./__tests__/fixtures.ts";
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
const wait = (steps = 1): LabAction => ({ type: "wait", steps });

test("all twelve trading-v2 labs are reachable with only buy sell observe and finish across three seeds", () => {
  for (const seed of ["trading-a", "trading-b", "trading-c"])
    for (let i = 1; i <= 12; i++) {
      const run = makeLabRun(`trade-practice-${i}`, seed, actions(i));
      assert.equal(run.version, "lab-v2-trading");
      assert.equal(run.result.passed, true, `${seed} #${i}: ${JSON.stringify(run.result.checks)}`);
      assert.equal(validateLabRun(run), true, `${seed} #${i} replay`);
      assert.ok(
        run.actions.every((a) => ["buy", "sell", "wait", "finish"].includes(a.type)),
        "no forms, blockchain quiz or required journal action",
      );
    }
});
test("v2 snapshots conserve pool supply and all cash on every transition including queue reverts", () => {
  for (let i = 1; i <= 12; i++) {
    let s = createLab(`trade-practice-${i}`, "ledger");
    for (const action of actions(i)) {
      s = applyLabAction(s, action);
      assert.equal(labConservation(s), s.initialConservation, `${i}:${action.type}`);
      for (const t of s.tokens)
        assert.equal(
          t.poolUnits + t.npcUnits + (s.positions[t.id]?.units ?? 0),
          t.initialPoolUnits,
        );
      assert.ok(
        [...Object.values(s.cash), ...Object.values(s.gas), s.feesCents].every(
          (v) => Number.isSafeInteger(v) && v >= 0,
        ),
      );
    }
  }
});
test("old lab-v1 scores and deterministic replay remain byte-for-byte compatible and historical only", () => {
  const old = legacy.makeLabRun("practice-8", "legacy", [
    { type: "inspect", tokenId: "token-a" },
    buy(),
    sell(),
    { type: "finish" },
  ]);
  assert.equal(old.result.passed, true);
  assert.equal(old.version, "lab-v1");
  assert.equal(validateLabRun(old), true);
  assert.deepEqual(labResult(replayLabRun(old)), old.result);
  assert.deepEqual(makeLabRun(old.challengeId, old.seed, old.actions), old);
  assert.equal(evaluateLabs([old]).completed, 0);
  assert.equal(evaluateLabs([old]).passed, false);
  assert.equal(validateLabRun({ ...old, version: "lab-v2-trading" }), false);
});
test("graduation uses the twelve current trading competencies, never preserved technical-lab flags", () => {
  const runs = LAB_CHALLENGES.map((c, i) => makeLabRun(c.id, "all-trading", actions(i + 1)));
  assert.equal(evaluateLabs(runs).passed, true);
  assert.equal(evaluateLabs(runs.slice(0, -1)).passed, false);
  assert.equal(
    validateLabRun({
      ...runs[0],
      result: { ...runs[0].result, pnlCents: runs[0].result.pnlCents + 1 },
    }),
    false,
  );
  assert.equal(validateLabRun({ ...runs[0], result: { ...runs[0].result, score: 50 } }), false);
  assert.equal(validateLabRun({ ...runs[0], actions: [...runs[0].actions, wait()] }), false);
});
test("chasing before the buy zone, exceeding amount and adding after a losing-stop do not pass", () => {
  const chase = makeLabRun("trade-practice-2", "chase", [
    buy(),
    wait(2),
    buy(),
    sell(),
    { type: "finish" },
  ]);
  assert.equal(chase.result.passed, false);
  const oversized = makeLabRun("trade-practice-1", "size", [
    buy("token-a", 800),
    buy(),
    sell(),
    { type: "finish" },
  ]);
  assert.equal(oversized.result.passed, false);
  const revenge = makeLabRun("trade-practice-7", "revenge", [
    buy(),
    sell(),
    wait(4),
    { type: "finish" },
  ]);
  assert.equal(revenge.result.passed, false);
});
test("stop and target competencies require actual timely sale and partial realized exit, not a typed plan", () => {
  const hold = makeLabRun("trade-practice-3", "stop", [wait(4), sell(), { type: "finish" }]);
  assert.equal(hold.result.passed, false);
  const full = makeLabRun("trade-practice-4", "target", [wait(2), sell(), { type: "finish" }]);
  assert.equal(full.result.passed, false);
  const partial = makeLabRun("trade-practice-4", "target", actions(4));
  assert.equal(partial.result.passed, true);
  const s = createLab("trade-practice-3", "immutable"),
    before = structuredClone(s.trading!.plans);
  const after = applyLabAction(s, {
    type: "trade-plan",
    tokenId: "token-a",
    entryPrice: 9,
    stopPrice: 0.01,
    targetPrice: 10,
    maxCents: 800,
    maxHoldSteps: 12,
  });
  assert.deepEqual(after.trading!.plans, before);
});
test("actual low-impact quote and sequential position discipline decide results", () => {
  const s = createLab("trade-practice-6", "quotes");
  assert.ok(tradingBuyQuote(s, "token-a", 400).impactPct > 2);
  assert.ok(tradingBuyQuote(s, "token-b", 400).impactPct <= 2);
  assert.equal(
    makeLabRun("trade-practice-6", "quotes", [buy(), sell(), { type: "finish" }]).result.passed,
    false,
  );
  assert.equal(
    makeLabRun("trade-practice-11", "overlap", [
      buy(),
      buy("token-b"),
      sell(),
      sell("token-b"),
      { type: "finish" },
    ]).result.passed,
    false,
  );
});
test("journal text is optional and cannot replace actual buy sell evidence", () => {
  const journal: LabAction = { type: "journal", phase: "before", note: "先看价格，不急着买" };
  assert.equal(
    makeLabRun("trade-practice-12", "notes", [journal, { type: "finish" }]).result.passed,
    false,
  );
  assert.equal(makeLabRun("trade-practice-12", "notes", actions(12)).result.passed, true);
});
test("current public snapshot never contains future quote path or future event schedule", () => {
  const a = createLab("trade-practice-3", "now");
  assert.equal(a.tokens[0].history.length, 1);
  assert.ok(a.tokens[0].history.every((p) => p.step <= a.step));
  assert.ok(!JSON.stringify(a).includes("incidentAt"));
  assert.deepEqual(createLab("trade-practice-3", "now"), a);
  const run = makeLabRun("trade-practice-3", "now", actions(3));
  assert.deepEqual(labResult(replayLabRun(run)), run.result);
});
