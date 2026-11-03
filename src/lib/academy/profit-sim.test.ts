import assert from "node:assert/strict";
import test from "node:test";
import { simulateProfit } from "./profit-sim.ts";

const base = { winRate: 0.4, winR: 1.8, risk: 0.01, trades: 100, paths: 400, seed: 7 };

test("same seed gives the same result; expectancy follows the formula", () => {
  assert.deepEqual(simulateProfit(base), simulateProfit(base));
  assert.ok(Math.abs(simulateProfit(base).expectancyR - 0.12) < 1e-9);
});

test("a positive edge at small risk is usually profitable and rarely ruined", () => {
  const r = simulateProfit(base);
  assert.ok(r.profitableShare > 0.7);
  assert.equal(r.ruinShare, 0);
  assert.ok(r.medianLosingStreak >= 4);
});

test("the same small edge with oversized risk usually ends in a loss", () => {
  const small = simulateProfit(base),
    large = simulateProfit({ ...base, risk: 0.2 });
  assert.ok(large.medianMaxDrawdownPct > small.medianMaxDrawdownPct * 5);
  assert.ok(large.ruinShare > 0.5);
  assert.ok(large.medianReturnPct < 0);
});

test("a negative edge loses no matter how carefully it is sized", () => {
  const r = simulateProfit({ ...base, winRate: 0.3, winR: 1.5 });
  assert.ok(r.expectancyR < 0);
  assert.ok(r.medianReturnPct < 0);
});

test("invalid input is rejected", () => {
  assert.throws(() => simulateProfit({ ...base, risk: 0 }), RangeError);
  assert.throws(() => simulateProfit({ ...base, winRate: 1.2 }), RangeError);
});
