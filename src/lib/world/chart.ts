export type CandleInterval = 60 | 300 | 900;
export interface QuoteSample {
  t: number;
  price: number;
}
export interface QuoteCandle {
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  samples: number;
  firstAt: number | null;
  lastAt: number | null;
}

export interface PositionChartOverlay {
  entryValue: number;
  entryUsd: number;
  pnlUsd: number;
  returnPct: number | null;
  quantity: number;
  canExit: boolean;
  exitReason?: string;
}

/** Remaining allocated cost, not the initial order price or a mark-to-market promise. */
export function positionChartOverlay({
  quantity,
  costUsd,
  exitValueUsd,
  canExit,
  valueScale = 1,
  exitReason,
}: {
  quantity: number;
  costUsd: number;
  exitValueUsd: number;
  canExit: boolean;
  valueScale?: number;
  exitReason?: string;
}): PositionChartOverlay | null {
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(costUsd) ||
    costUsd < 0 ||
    !Number.isFinite(valueScale) ||
    valueScale < 0
  )
    return null;
  const entryUsd = costUsd / quantity;
  const entryValue = entryUsd * valueScale;
  if (!Number.isFinite(entryValue)) return null;
  const recoverable = canExit && Number.isFinite(exitValueUsd) && exitValueUsd >= 0;
  const pnlUsd = (recoverable ? exitValueUsd : 0) - costUsd;
  return {
    entryValue,
    entryUsd,
    pnlUsd,
    returnPct: costUsd > 0 ? (pnlUsd / costUsd) * 100 : null,
    quantity,
    canExit: recoverable,
    exitReason,
  };
}

/** Saved quotes have a 15-second cadence; missing samples break the line. */
export function quoteLineSegments(
  input: readonly QuoteSample[],
  {
    from = -Infinity,
    through = Infinity,
    scale = 1,
    maxGap = 15,
  }: { from?: number; through?: number; scale?: number; maxGap?: number } = {},
): QuoteSample[][] {
  if (!Number.isFinite(scale) || scale < 0 || !Number.isFinite(maxGap) || maxGap <= 0)
    throw new RangeError("Invalid quote line options");
  const samples = input
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.price) &&
        point.price >= 0 &&
        point.t >= from &&
        point.t <= through &&
        Number.isFinite(point.price * scale),
    )
    .map((point, index) => ({ t: point.t, price: point.price * scale, index }))
    .sort((a, b) => a.t - b.t || a.index - b.index);
  const segments: QuoteSample[][] = [];
  for (const point of samples) {
    const previous = segments.at(-1)?.at(-1);
    if (!previous || point.t - previous.t > maxGap) segments.push([]);
    const segment = segments.at(-1)!;
    if (previous?.t === point.t) segment[segment.length - 1] = { t: point.t, price: point.price };
    else segment.push({ t: point.t, price: point.price });
  }
  return segments;
}

/** Samples are reference quotes, not a transaction tape. Empty intervals remain empty. */
export function aggregateQuoteCandles(
  input: readonly QuoteSample[],
  interval: CandleInterval,
  { through, scale = 1 }: { through?: number; scale?: number } = {},
): QuoteCandle[] {
  if (![60, 300, 900].includes(interval)) throw new RangeError("Unsupported candle interval");
  if (!Number.isFinite(scale) || scale < 0) throw new RangeError("Invalid quote scale");
  if (through !== undefined && !Number.isFinite(through))
    throw new RangeError("Invalid chart time");
  const samples = input
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.price) &&
        point.price >= 0 &&
        (through === undefined || point.t <= through) &&
        Number.isFinite(point.price * scale),
    )
    .map((point, index) => ({ t: point.t, price: point.price * scale, index }))
    .sort((a, b) => a.t - b.t || a.index - b.index);
  if (!samples.length) return [];
  const first = Math.floor(samples[0].t / interval) * interval;
  const last =
    Math.floor(Math.max(samples.at(-1)!.t, through ?? samples.at(-1)!.t) / interval) * interval;
  const candles: QuoteCandle[] = [];
  for (let time = first; time <= last; time += interval) {
    candles.push({
      time,
      open: null,
      high: null,
      low: null,
      close: null,
      samples: 0,
      firstAt: null,
      lastAt: null,
    });
  }
  for (const point of samples) {
    const candle = candles[Math.floor((point.t - first) / interval)];
    if (candle.samples === 0) {
      candle.open = candle.high = candle.low = point.price;
      candle.firstAt = point.t;
    }
    candle.high = Math.max(candle.high!, point.price);
    candle.low = Math.min(candle.low!, point.price);
    candle.close = point.price;
    candle.lastAt = point.t;
    candle.samples++;
  }
  return candles;
}

/** Model elapsed time, including the negative warm-up period and hours beyond 24. */
export function formatChartTime(seconds: number, withSeconds = false): string {
  if (!Number.isFinite(seconds)) return "—";
  const absolute = Math.floor(Math.abs(seconds));
  const sign = seconds < 0 && absolute > 0 ? "-" : "";
  const hours = String(Math.floor(absolute / 3600)).padStart(2, "0");
  const minutes = String(Math.floor(absolute / 60) % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}${withSeconds ? `:${String(absolute % 60).padStart(2, "0")}` : ""}`;
}

/** Numeric ticks use whole minutes or longer, so HH:mm labels cannot repeat. */
export function chartTimeTicks(start: number, end: number, maxTicks = 5): number[] {
  if (![start, end].every(Number.isFinite) || end < start) return [];
  const count = Math.max(2, Math.floor(maxTicks));
  const wanted = Math.max(60, (end - start) / (count - 1));
  const steps = [
    60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800, 345600, 604800,
  ];
  const step = steps.find((value) => value >= wanted) ?? Math.ceil(wanted / 86400) * 86400;
  const ticks: number[] = [];
  for (let tick = Math.ceil(start / step) * step; tick <= end; tick += step)
    ticks.push(Object.is(tick, -0) ? 0 : tick);
  return ticks;
}
