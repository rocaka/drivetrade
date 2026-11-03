import assert from "node:assert/strict";
import test from "node:test";
import { chartAxisRangeFromTicks, createChartAxisFormatter } from "./chart-axis.ts";

test("trillion market-cap ticks remain distinct inside a narrow visible range", () => {
  const ticks = [1_082_000_000_000, 1_083_000_000_000, 1_084_000_000_000, 1_085_000_000_000];
  const format = createChartAxisFormatter("marketCap", chartAxisRangeFromTicks(ticks)!);
  assert.deepEqual(ticks.map(format), ["$1.082T", "$1.083T", "$1.084T", "$1.085T"]);
  assert.equal(format(1_083_432_100_000), "$1.0834T");
});

test("both axis modes distinguish near-flat values instead of fixed four-significant-digit rounding", () => {
  for (const mode of ["marketCap", "usdPrice"] as const) {
    const ticks = [1.0000001, 1.0000002, 1.0000003, 1.0000004];
    const format = createChartAxisFormatter(mode, chartAxisRangeFromTicks(ticks)!);
    assert.equal(new Set(ticks.map(format)).size, ticks.length);
    assert.equal(format(ticks[0]), "$1.0000001");
  }
});

test("tiny prices preserve significant differences and compact zero notation", () => {
  const ticks = [0.0000004290001, 0.0000004290002, 0.0000004290003];
  const format = createChartAxisFormatter("usdPrice", chartAxisRangeFromTicks(ticks)!);
  assert.equal(new Set(ticks.map(format)).size, ticks.length);
  assert.equal(format(ticks[0]), "$0.0₆4290001");
  assert.ok(ticks.map(format).every((label) => !/[eE][+-]?\d/.test(label)));
});

test("market-cap ticks share a magnitude across a suffix boundary", () => {
  const ticks = [999_000, 1_000_000, 1_001_000];
  const format = createChartAxisFormatter("marketCap", chartAxisRangeFromTicks(ticks)!);
  assert.deepEqual(ticks.map(format), ["$0.999M", "$1M", "$1.001M"]);
});

test("zero and subnormal axes remain finite and never use scientific notation", () => {
  assert.equal(createChartAxisFormatter("usdPrice", { min: 0, max: 0 })(0), "$0");
  assert.equal(createChartAxisFormatter("marketCap", { min: 0, max: 0 })(NaN), "—");
  const ticks = [Number.MIN_VALUE, Number.MIN_VALUE * 2, Number.MIN_VALUE * 3];
  const format = createChartAxisFormatter("usdPrice", chartAxisRangeFromTicks(ticks)!);
  assert.equal(new Set(ticks.map(format)).size, ticks.length);
  assert.ok(ticks.map(format).every((label) => !/[eE][+-]?\d/.test(label)));
});

test("axis range ignores invalid and duplicate ticks and uses the nearest spacing", () => {
  assert.deepEqual(chartAxisRangeFromTicks([NaN, 4, 1, 4, 2, Infinity]), {
    min: 1,
    max: 4,
    step: 1,
  });
  assert.equal(chartAxisRangeFromTicks([NaN, Infinity]), null);
});
