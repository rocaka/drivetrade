export type ChartAxisMode = "marketCap" | "usdPrice";
export interface ChartAxisRange {
  min: number;
  max: number;
  /** Actual tick spacing, when supplied by the chart renderer. */
  step?: number;
}

const magnitudes = [
  { divisor: 1e12, suffix: "T" },
  { divisor: 1e9, suffix: "B" },
  { divisor: 1e6, suffix: "M" },
  { divisor: 1e3, suffix: "K" },
] as const;
const subscripts = "₀₁₂₃₄₅₆₇₈₉";

function plainDecimal(text: string) {
  const [coefficient, exponent] = text.toLowerCase().split("e");
  let result = coefficient;
  if (exponent !== undefined) {
    const [whole, fraction = ""] = coefficient.split(".");
    const digits = whole + fraction;
    const point = whole.length + Number(exponent);
    result =
      point <= 0
        ? `0.${"0".repeat(-point)}${digits}`
        : point >= digits.length
          ? digits + "0".repeat(point - digits.length)
          : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return result.includes(".") ? result.replace(/0+$/, "").replace(/\.$/, "") : result;
}

/** Axis precision follows the visible price step, rather than a fixed number of
 * decimals or significant figures. All marks share one magnitude. */
export function createChartAxisFormatter(mode: ChartAxisMode, range: ChartAxisRange) {
  const extent = Math.max(Math.abs(range.min), Math.abs(range.max));
  const magnitude =
    mode === "marketCap" ? magnitudes.find((item) => extent >= item.divisor) : undefined;
  const divisor = magnitude?.divisor ?? 1;
  const suffix = magnitude?.suffix ?? "";
  const span = Math.abs(range.max - range.min);
  const step =
    range.step && Number.isFinite(range.step) && range.step > 0
      ? range.step
      : span > 0 && Number.isFinite(span)
        ? span / 5
        : extent > 0
          ? extent / 1000
          : mode === "marketCap"
            ? 0.2
            : 0.0000002;
  const scaledStep = step / divisor;
  // An extra decimal prevents floating point ticks just below a power of ten
  // from rounding to identical neighboring labels.
  const decimals = Math.max(0, Math.ceil(-Math.log10(scaledStep)) + 1);
  return (value: number) => {
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return `$0${suffix}`;
    const scaled = Math.abs(value) / divisor;
    const significantDigits = Math.max(
      1,
      Math.min(17, Math.floor(Math.log10(scaled)) + decimals + 1),
    );
    const decimal = plainDecimal(scaled.toPrecision(significantDigits));
    const tiny = decimal.match(/^0\.(0{4,})([1-9]\d*)$/);
    const [integer, fraction] = decimal.split(".");
    const unsigned = tiny
      ? `0.0${String(tiny[1].length)
          .split("")
          .map((digit) => subscripts[Number(digit)])
          .join("")}${tiny[2]}`
      : integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
    return `${value < 0 ? "−" : ""}$${unsigned}${suffix}`;
  };
}

/** Tick marks are renderer-selected and already account for manual axis zoom. */
export function chartAxisRangeFromTicks(prices: readonly number[]): ChartAxisRange | null {
  const values = [...new Set(prices.filter(Number.isFinite))].sort((a, b) => a - b);
  if (!values.length) return null;
  const gaps = values
    .slice(1)
    .map((value, index) => value - values[index])
    .filter((gap) => gap > 0);
  return { min: values[0], max: values.at(-1)!, step: gaps.length ? Math.min(...gaps) : undefined };
}
