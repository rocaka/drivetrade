import test from "node:test";
import assert from "node:assert/strict";
import { money, compact, currencyCompact, fullDecimal, priceParts, formatPrice } from "./amount.ts";

test("money preserves the currency-neutral, two-decimal contract", () => {
  assert.equal(money(1234567.891), "1,234,567.89");
  assert.equal(money(-1234.5), "-1,234.50");
  assert.equal(money(274), "274.00");
  assert.equal(money(0), "0.00");
  assert.equal(money(-0), "0.00");
  assert.equal(money(0.000000429), "0.00");
  assert.doesNotMatch(money(1), /\$/);
});

test("quantity formatting retains sub-unit precision and never writes scientific notation", () => {
  const fixtures: [number, string][] = [
    [0.012345, "0.01235"],
    [0.014, "0.014"],
    [0.123456, "0.1235"],
    [0.000000429, "0.000000429"],
    [-0.000000429, "-0.000000429"],
    [1.234567e-12, "0.000000000001235"],
    [274, "274"],
    [12.34567, "12.35"],
    [0, "0"],
    [-0, "0"],
  ];
  for (const [value, expected] of fixtures) assert.equal(compact(value), expected);
  const smallest = compact(Number.MIN_VALUE);
  assert.notEqual(smallest, "0");
  assert.match(smallest, /^0\.0+[1-9]/);
  assert.doesNotMatch(smallest, /e[+-]?\d/i);
});

test("K M B T use at most two decimals and rounded thresholds promote units", () => {
  const fixtures: [number, string][] = [
    [999.994, "999.99"],
    [999.995, "1K"],
    [1000, "1K"],
    [12345, "12.35K"],
    [999994.999, "999.99K"],
    [999995, "1M"],
    [1e6, "1M"],
    [1_234_567_890, "1.23B"],
    [1_234_567_890_123, "1.23T"],
    [-12345, "-12.35K"],
    [-999995, "-1M"],
    [1e15, "1,000T"],
  ];
  for (const [value, expected] of fixtures) assert.equal(compact(value), expected);
  assert.doesNotMatch(compact(Number.MAX_VALUE), /e[+-]?\d/i);
  assert.ok(compact(Number.MAX_VALUE).endsWith("T"));
});

test("currency compact distinguishes tiny dollars from precise token quantities", () => {
  assert.equal(currencyCompact(0.000000429), "<$0.01");
  assert.equal(currencyCompact(-0.000000429), "-<$0.01");
  assert.equal(currencyCompact(0.009999), "<$0.01");
  assert.equal(currencyCompact(0.01), "$0.01");
  assert.equal(currencyCompact(0), "$0.00");
  assert.equal(currencyCompact(-0), "$0.00");
  assert.equal(currencyCompact(12.345), "$12.35");
  assert.equal(currencyCompact(-12345), "-$12.35K");
  assert.equal(currencyCompact(1e12), "$1T");
  assert.equal(compact(0.014), "0.014");
  assert.equal(currencyCompact(0.014), "$0.01");
});

test("compressed price zero counts are exact and retain the full original decimal", () => {
  assert.deepEqual(priceParts(0.000000429), {
    sign: "",
    integer: "0",
    zeroCount: 6,
    digits: "429",
    text: "0.0₆429",
    full: "0.000000429",
  });
  assert.equal(formatPrice(-0.000000429), "-0.0₆429");
  assert.equal(priceParts(-0.000000429).full, "-0.000000429");
  assert.equal(formatPrice(4.29e-12), "0.0₁₁429");
  assert.equal(formatPrice(4.29123e-7, 3), "0.0₆429");
  assert.equal(formatPrice(4.29123e-7, 4), "0.0₆4291");
});

test("price rounding recalculates the zero count when it crosses a magnitude boundary", () => {
  assert.equal(formatPrice(0.000099999), "0.0001");
  assert.equal(priceParts(0.000099999).zeroCount, 0);
  assert.equal(formatPrice(0.000000099999), "0.0₆1");
  assert.equal(priceParts(0.000000099999).full, "0.000000099999");
  assert.equal(formatPrice(999.99), "1,000");
});

test("ordinary prices use natural four significant digits without rounding small prices to zero", () => {
  const fixtures: [number, string][] = [
    [1.234567, "1.235"],
    [12.34567, "12.35"],
    [123.4567, "123.5"],
    [1234.567, "1,235"],
    [0.01234567, "0.01235"],
    [0.000429123, "0.0004291"],
    [274, "274"],
    [0, "0"],
    [-0, "0"],
    [-1.234567, "-1.235"],
  ];
  for (const [value, expected] of fixtures) assert.equal(formatPrice(value), expected);
  for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE]) {
    assert.notEqual(formatPrice(value), "0");
    assert.doesNotMatch(formatPrice(value), /e[+-]?\d/i);
  }
});

test("full precision expands both large and tiny exponents for accessible labels and tooltips", () => {
  assert.equal(fullDecimal(1.234e22), "12340000000000000000000");
  assert.equal(fullDecimal(-1.234e22), "-12340000000000000000000");
  assert.equal(fullDecimal(4.29e-7), "0.000000429");
  assert.equal(fullDecimal(0.1 + 0.2), "0.30000000000000004");
  assert.equal(fullDecimal(-0), "0");
  assert.equal(priceParts(1.234567891).full, "1.234567891");
});

test("non-finite display values use one neutral placeholder", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const format of [money, compact, currencyCompact, fullDecimal, formatPrice])
      assert.equal(format(value), "—");
    assert.equal(priceParts(value).zeroCount, 0);
  }
});
