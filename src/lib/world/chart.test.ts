import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateQuoteCandles,
  chartTimeTicks,
  formatChartTime,
  positionChartOverlay,
  quoteLineSegments,
} from "./chart.ts";

test("OHLC uses first, last and extrema of actual chronologically sorted samples", () => {
  const samples = [
    { t: 45, price: 8 },
    { t: 0, price: 5 },
    { t: 30, price: 12 },
    { t: 15, price: 3 },
  ];
  const original = structuredClone(samples);
  assert.deepEqual(aggregateQuoteCandles(samples, 60), [
    { time: 0, open: 5, high: 12, low: 3, close: 8, samples: 4, firstAt: 0, lastAt: 45 },
  ]);
  assert.deepEqual(samples, original);
});
test("empty intervals and trailing unsampled time do not forward fill", () => {
  const candles = aggregateQuoteCandles(
    [
      { t: 0, price: 7 },
      { t: 180, price: 9 },
    ],
    60,
    { through: 300 },
  );
  assert.equal(candles.length, 6);
  for (const index of [1, 2, 4, 5])
    assert.deepEqual(candles[index], {
      time: index * 60,
      open: null,
      high: null,
      low: null,
      close: null,
      samples: 0,
      firstAt: null,
      lastAt: null,
    });
  assert.equal(candles[3].close, 9);
});
test("5m and 15m buckets have exact boundaries, including warm-up time", () => {
  const samples = [
    { t: -1, price: 2 },
    { t: 0, price: 3 },
    { t: 299, price: 4 },
    { t: 300, price: 5 },
    { t: 900, price: 6 },
  ];
  const five = aggregateQuoteCandles(samples, 300);
  assert.deepEqual(
    five.map((c) => [c.time, c.samples]),
    [
      [-300, 1],
      [0, 2],
      [300, 1],
      [600, 0],
      [900, 1],
    ],
  );
  const fifteen = aggregateQuoteCandles(samples, 900);
  assert.deepEqual(
    fifteen.map((c) => [c.time, c.samples]),
    [
      [-900, 1],
      [0, 3],
      [900, 1],
    ],
  );
});
test("future samples cannot leak through the visible world cursor", () => {
  const candles = aggregateQuoteCandles(
    [
      { t: 0, price: 1 },
      { t: 30, price: 2 },
      { t: 45, price: 999 },
    ],
    60,
    { through: 30 },
  );
  assert.equal(candles[0].close, 2);
  assert.equal(candles[0].high, 2);
  assert.equal(candles[0].samples, 2);
});
test("zero is a valid quote, invalid values are ignored, and no sample stays empty", () => {
  assert.deepEqual(aggregateQuoteCandles([], 60), []);
  const candles = aggregateQuoteCandles(
    [
      { t: 0, price: 0 },
      { t: 1, price: NaN },
      { t: 2, price: -1 },
      { t: Infinity, price: 3 },
    ],
    60,
  );
  assert.equal(candles[0].samples, 1);
  assert.equal(candles[0].close, 0);
});
test("positive display scaling preserves actual OHLC ordering and sample counts", () => {
  const c = aggregateQuoteCandles(
    [
      { t: 0, price: 0.000000429 },
      { t: 15, price: 0.0000005 },
    ],
    60,
    { scale: 1e9 },
  )[0];
  assert.equal(c.open, 429);
  assert.equal(c.close, 500);
  assert.equal(c.samples, 2);
  assert.throws(() => aggregateQuoteCandles([], 0 as 60), RangeError);
  assert.throws(() => aggregateQuoteCandles([], 60, { scale: -1 }), RangeError);
});
test("75m–77m ticks are numeric seconds and have distinct HH:mm labels", () => {
  const ticks = chartTimeTicks(4500, 4620, 5);
  assert.deepEqual(ticks, [4500, 4560, 4620]);
  assert.deepEqual(
    ticks.map((t) => formatChartTime(t)),
    ["01:15", "01:16", "01:17"],
  );
  assert.equal(new Set(ticks.map((t) => formatChartTime(t))).size, ticks.length);
});
test("short windows, warm-up and multi-day times never create duplicate minute labels", () => {
  for (const [start, end] of [
    [0, 20],
    [-120, 60],
    [86340, 86520],
    [4500, 4900],
  ]) {
    const ticks = chartTimeTicks(start, end, 4);
    assert.ok(ticks.every((t) => t >= start && t <= end && t % 60 === 0));
    assert.equal(new Set(ticks.map((t) => formatChartTime(t))).size, ticks.length);
  }
  assert.equal(formatChartTime(4523, true), "01:15:23");
  assert.equal(formatChartTime(-120), "-00:02");
  assert.equal(formatChartTime(90061, true), "25:01:01");
});

test("position overlay uses remaining allocated cost and net executable exit", () => {
  const full = positionChartOverlay({
    quantity: 100,
    costUsd: 50,
    exitValueUsd: 65,
    canExit: true,
  });
  assert.equal(full?.entryValue, 0.5);
  assert.equal(full?.pnlUsd, 15);
  assert.equal(full?.returnPct, 30);
  const partial = positionChartOverlay({
    quantity: 75,
    costUsd: 37.5,
    exitValueUsd: 48,
    canExit: true,
  });
  assert.equal(partial?.entryValue, 0.5);
  assert.equal(partial?.pnlUsd, 10.5);
  assert.ok(Math.abs(partial!.returnPct! - 28) < 1e-10);
  const cap = positionChartOverlay({
    quantity: 75,
    costUsd: 37.5,
    exitValueUsd: 48,
    canExit: true,
    valueScale: 1e9,
  });
  assert.equal(cap?.entryValue, 5e8);
  assert.equal(cap?.entryUsd, partial?.entryUsd);
  assert.equal(cap?.pnlUsd, partial?.pnlUsd);
});
test("zero holdings have no entry line; unavailable exits use zero recovery", () => {
  assert.equal(
    positionChartOverlay({ quantity: 0, costUsd: 0, exitValueUsd: 0, canExit: false }),
    null,
  );
  const unavailable = positionChartOverlay({
    quantity: 3,
    costUsd: 10,
    exitValueUsd: 999,
    canExit: false,
    exitReason: "权限限制",
  });
  assert.equal(unavailable?.pnlUsd, -10);
  assert.equal(unavailable?.returnPct, -100);
  assert.equal(unavailable?.canExit, false);
  const zeroCost = positionChartOverlay({
    quantity: 3,
    costUsd: 0,
    exitValueUsd: 2,
    canExit: true,
  });
  assert.equal(zeroCost?.entryValue, 0);
  assert.equal(zeroCost?.returnPct, null);
  assert.equal(
    positionChartOverlay({ quantity: NaN, costUsd: 0, exitValueUsd: 2, canExit: true }),
    null,
  );
});
test("line paths keep real numeric times and break at missing reference quotes", () => {
  const samples = [
    { t: 75, price: 7 },
    { t: 0, price: 2 },
    { t: 15, price: 4 },
    { t: 30, price: 5 },
    { t: 90, price: 8 },
    { t: 105, price: 999 },
  ];
  const original = structuredClone(samples);
  assert.deepEqual(quoteLineSegments(samples, { through: 90, scale: 2 }), [
    [
      { t: 0, price: 4 },
      { t: 15, price: 8 },
      { t: 30, price: 10 },
    ],
    [
      { t: 75, price: 14 },
      { t: 90, price: 16 },
    ],
  ]);
  assert.deepEqual(samples, original);
  assert.deepEqual(
    quoteLineSegments([
      { t: 0, price: 1 },
      { t: 0, price: 2 },
    ]),
    [[{ t: 0, price: 2 }]],
  );
});
