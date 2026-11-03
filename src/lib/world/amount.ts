import type { Atom } from "./types.ts";
export const SCALE = 1_000_000n;
export function atoms(value: number | string): Atom {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(text)) throw new Error("请输入非负数字，最多六位小数");
  const [whole, part = ""] = text.split(".");
  const n = BigInt(whole) * SCALE + BigInt(part.padEnd(6, "0"));
  if (n > 10n ** 30n) throw new Error("金额超出范围");
  return n.toString();
}
export function units(value: Atom): number {
  return Number(BigInt(value)) / Number(SCALE);
}
export function add(a: Atom, b: Atom): Atom {
  return (BigInt(a) + BigInt(b)).toString();
}
export function sub(a: Atom, b: Atom): Atom {
  const n = BigInt(a) - BigInt(b);
  if (n < 0n) throw new Error("余额不足");
  return n.toString();
}
export function mulDiv(a: Atom, b: Atom, c: Atom): Atom {
  if (BigInt(c) <= 0n) throw new Error("无效除数");
  return ((BigInt(a) * BigInt(b)) / BigInt(c)).toString();
}
export function usd(value: Atom, fx: number): Atom {
  return ((BigInt(value) * BigInt(Math.max(0, Math.round(fx * 1e6)))) / SCALE).toString();
}
const decimalMoney = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const shortNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const shortUngrouped = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  useGrouping: false,
});
const magnitudes = [
  { divisor: 1, suffix: "" },
  { divisor: 1e3, suffix: "K" },
  { divisor: 1e6, suffix: "M" },
  { divisor: 1e9, suffix: "B" },
  { divisor: 1e12, suffix: "T" },
] as const;

/** Dollar/stable-asset amount without a currency prefix; existing interpolations stay valid. */
export function money(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return decimalMoney.format(Object.is(value, -0) ? 0 : value);
}

function expandDecimal(text: string): string {
  const [coefficient, exponent] = text.toLowerCase().split("e");
  if (exponent === undefined) return coefficient;
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  const expanded =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return (negative ? "-" : "") + expanded;
}
function trimFraction(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
function significantDecimal(value: number, significantDigits: 3 | 4): string {
  // Keep the precision string: converting it back to Number can underflow or overflow.
  return trimFraction(expandDecimal(value.toPrecision(significantDigits)));
}
function groupDecimal(text: string): string {
  const [whole, fraction] = text.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}

/** Full shortest round-trip decimal represented by this Number, never scientific notation. */
export function fullDecimal(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return expandDecimal(String(Object.is(value, -0) ? 0 : value));
}

/** Quantity formatter. Small quantities keep four significant digits rather than becoming zero. */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const absolute = Math.abs(value),
    sign = value < 0 ? "-" : "";
  if (absolute < 1) return sign + significantDecimal(absolute, 4);
  let index = magnitudes.length - 1;
  while (index > 0 && absolute < magnitudes[index].divisor) index--;
  let scaled = absolute / magnitudes[index].divisor;
  // Promote a rounded 1000K to 1M, including the un-suffixed 999.995 boundary.
  if (index < magnitudes.length - 1 && Number(shortUngrouped.format(scaled)) >= 1000) {
    index++;
    scaled = absolute / magnitudes[index].divisor;
  }
  return sign + shortNumber.format(scaled) + magnitudes[index].suffix;
}

/** Includes the dollar sign; use this directly instead of prefixing `$` to compact(). */
export function currencyCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value),
    sign = value < 0 ? "-" : "";
  if (absolute > 0 && absolute < 0.01) return `${sign}<$0.01`;
  return sign + "$" + (absolute >= 1000 ? compact(absolute) : money(absolute));
}

export interface PriceParts {
  sign: "" | "-";
  integer: string;
  /** Count of zeros after the decimal point before the first significant digit. */
  zeroCount: number;
  /** Significant tail when compressed; fractional digits for an ordinary price. */
  digits: string;
  /** Plain-text counterpart using Unicode subscript zero counts. No currency sign. */
  text: string;
  /** Original Number's full decimal, before display rounding. */
  full: string;
}
const subscripts = "₀₁₂₃₄₅₆₇₈₉";
export function priceParts(value: number, significantDigits: 3 | 4 = 4): PriceParts {
  const full = fullDecimal(value);
  if (!Number.isFinite(value))
    return { sign: "", integer: "—", zeroCount: 0, digits: "", text: "—", full };
  const sign = value < 0 ? "-" : "";
  const rounded = significantDecimal(Math.abs(value), significantDigits === 3 ? 3 : 4);
  // Derive the count AFTER significant-digit rounding so 0.000099999 -> 0.0001
  // cannot be rendered with the old exponent and become ten times too small.
  const match = rounded.match(/^0\.(0{4,})([1-9]\d*)$/);
  if (match) {
    const zeroCount = match[1].length,
      digits = match[2];
    const count = String(zeroCount)
      .split("")
      .map((digit) => subscripts[Number(digit)])
      .join("");
    return { sign, integer: "0", zeroCount, digits, text: `${sign}0.0${count}${digits}`, full };
  }
  const [integer, digits = ""] = rounded.split(".");
  return {
    sign,
    integer: groupDecimal(integer),
    zeroCount: 0,
    digits,
    text: sign + groupDecimal(rounded),
    full,
  };
}
export function formatPrice(value: number, significantDigits: 3 | 4 = 4): string {
  return priceParts(value, significantDigits).text;
}
