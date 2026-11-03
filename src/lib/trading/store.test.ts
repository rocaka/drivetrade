import { test } from "node:test";
import assert from "node:assert/strict";
import { executionStats, moneyStats, newestFirst, type Trade } from "./store.ts";

function trade(id: string, date: string, followedPlan: boolean, extra: Partial<Trade> = {}): Trade {
  return {
    id,
    date,
    symbol: id,
    planReason: "r",
    stopLoss: "s",
    takeProfit: "t",
    actualEntry: "",
    actualExit: "",
    followedPlan,
    deviationReason: "",
    stake: null,
    pnl: null,
    createdAt: `${date}T00:00:00.000Z`,
    ...extra,
  };
}

test("newestFirst orders by date then createdAt without mutating input", () => {
  const input = [
    trade("a", "2026-01-01", true),
    trade("c", "2026-03-01", true),
    trade("b", "2026-02-01", true, { createdAt: "2026-02-01T00:00:00.000Z" }),
    trade("b2", "2026-02-01", true, { createdAt: "2026-02-01T09:00:00.000Z" }),
  ];
  assert.deepEqual(
    newestFirst(input).map((t) => t.id),
    ["c", "b2", "b", "a"],
  );
  assert.equal(input[0].id, "a");
});

test("streak counts the most recent trades even when stored out of order", () => {
  // An older deviation listed first (e.g. after an import) must not zero the streak.
  const trades = [
    trade("old-miss", "2026-01-01", false),
    trade("new-1", "2026-03-02", true),
    trade("new-2", "2026-03-01", true),
  ];
  const stats = executionStats(trades);
  assert.equal(stats.streak, 2);
  assert.equal(stats.rate, 67);
});

test("FOMO imports are excluded from execution stats", () => {
  const stats = executionStats([
    trade("f", "2026-03-03", false, { source: "fomo" }),
    trade("d", "2026-03-01", true),
  ]);
  assert.equal(stats.total, 1);
  assert.equal(stats.streak, 1);
});

test("moneyStats tracks equity and drawdown", () => {
  const money = moneyStats(
    [
      trade("w", "2026-01-01", true, { pnl: 200 }),
      trade("l", "2026-01-02", true, { pnl: -300 }),
      trade("o", "2026-01-03", true),
    ],
    1000,
  );
  assert.equal(money.equity, 900);
  assert.equal(money.maxDrawdown, -300);
  assert.equal(money.open, 1);
  assert.equal(money.winRate, 50);
});
