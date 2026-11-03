import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVANCED_LAB_CHALLENGES,
  LAB_CHALLENGES,
  evaluateLabs,
  makeLabRun,
  validateLabRun,
} from "./engine.ts";
import type { LabAction } from "./types.ts";

const buy = (tokenId: string, cents: number): LabAction => ({
  type: "buy",
  tokenId,
  cents,
  slippageBps: 500,
  ttlSteps: 6,
});
const sell = (tokenId: string, percent: 25 | 50 | 100 = 100): LabAction => ({
  type: "sell",
  tokenId,
  percent,
});
const wait = (steps = 1): LabAction => ({ type: "wait", steps });
const finish: LabAction = { type: "finish" };
const run = (n: number, actions: LabAction[]) =>
  makeLabRun(`trade-practice-${n}`, `advanced-${n}`, [...actions, finish]);

test("advanced exercises are optional and never change the required twelve", () => {
  assert.equal(LAB_CHALLENGES.length, 12);
  assert.deepEqual(
    ADVANCED_LAB_CHALLENGES.map((c) => c.id),
    ["trade-practice-13", "trade-practice-14", "trade-practice-15", "trade-practice-16"],
  );
  assert.ok(ADVANCED_LAB_CHALLENGES.every((c) => c.lessonId.startsWith("profit-lesson-")));
  const good = run(13, [buy("token-a", 300), wait(), sell("token-a")]);
  assert.equal(evaluateLabs([good]).required, 12);
  assert.equal(evaluateLabs([good]).completed, 0);
  assert.equal(evaluateLabs([good], ADVANCED_LAB_CHALLENGES).completed, 1);
});

test("1R sizing: $3 at a 20% stop passes; $4 (fees push it past $1) and $1 do not", () => {
  const passed = run(13, [buy("token-a", 300), wait(), sell("token-a")]);
  assert.equal(passed.result.passed, true);
  assert.ok(validateLabRun(passed));
  assert.equal(run(13, [buy("token-a", 400), wait(), sell("token-a")]).result.passed, false);
  assert.equal(run(13, [buy("token-a", 100), wait(), sell("token-a")]).result.passed, false);
});

test("break-even protection: take part at target, exit the rest above cost", () => {
  const passed = run(14, [wait(2), sell("token-a", 50), wait(4), sell("token-a")]);
  assert.equal(passed.result.passed, true);
  // Holding the rest through the fade turns a winner into a loss.
  assert.equal(
    run(14, [wait(2), sell("token-a", 50), wait(4), wait(2), sell("token-a")]).result.passed,
    false,
  );
  // Selling everything at the target skips the partial.
  assert.equal(run(14, [wait(2), sell("token-a")]).result.passed, false);
});

test("time stop: give it two steps, leave by the fourth", () => {
  assert.equal(run(15, [buy("token-a", 400), wait(3), sell("token-a")]).result.passed, true);
  assert.equal(run(15, [buy("token-a", 400), wait(), sell("token-a")]).result.passed, false);
  assert.equal(
    run(15, [buy("token-a", 400), wait(4), wait(2), sell("token-a")]).result.passed,
    false,
  );
});

test("equal risk: smaller size for wider stops, one position at a time", () => {
  const trade = (tokenId: string, cents: number) => [buy(tokenId, cents), wait(), sell(tokenId)];
  const passed = run(16, [
    ...trade("token-a", 750),
    ...trade("token-b", 400),
    ...trade("token-c", 250),
  ]);
  assert.equal(passed.result.passed, true);
  // Same $7.50 everywhere: the 25% stop on C risks about $2.
  assert.equal(
    run(16, [...trade("token-a", 750), ...trade("token-b", 750), ...trade("token-c", 750)]).result
      .passed,
    false,
  );
  // Overlapping positions break the one-at-a-time rule.
  assert.equal(
    run(16, [
      buy("token-a", 750),
      buy("token-b", 400),
      wait(),
      sell("token-a"),
      sell("token-b"),
      ...trade("token-c", 250),
    ]).result.passed,
    false,
  );
});
