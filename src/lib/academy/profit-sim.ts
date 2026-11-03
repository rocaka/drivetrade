/** Monte Carlo drill for the advanced track: fixed-fraction risk over a run of trades. */
export interface ProfitSimInput {
  /** 0–1 */
  winRate: number;
  /** Average winner in R; losers are always −1R. */
  winR: number;
  /** Fraction of equity risked per trade, 0–1. */
  risk: number;
  trades: number;
  paths: number;
  seed: number;
}
export interface ProfitSimResult {
  expectancyR: number;
  profitableShare: number;
  medianReturnPct: number;
  worstDecileReturnPct: number;
  medianMaxDrawdownPct: number;
  medianLosingStreak: number;
  ruinShare: number;
  /** A handful of equity curves (start = 1) for drawing, plus the median curve. */
  sample: number[][];
  median: number[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
};

export function simulateProfit(input: ProfitSimInput): ProfitSimResult {
  const { winRate, winR, risk, trades, paths } = input;
  if (
    !(winRate >= 0 && winRate <= 1) ||
    !(winR > 0) ||
    !(risk > 0 && risk < 1) ||
    !Number.isInteger(trades) ||
    trades < 1 ||
    !Number.isInteger(paths) ||
    paths < 1
  )
    throw new RangeError("Invalid simulation input");
  const random = mulberry32(input.seed);
  const finals: number[] = [],
    drawdowns: number[] = [],
    streaks: number[] = [],
    curves: number[][] = [];
  let ruined = 0;
  for (let p = 0; p < paths; p++) {
    let equity = 1,
      peak = 1,
      maxDrawdown = 0,
      streak = 0,
      longest = 0,
      ruin = false;
    const curve = [1];
    for (let t = 0; t < trades; t++) {
      if (random() < winRate) {
        equity *= 1 + risk * winR;
        streak = 0;
      } else {
        equity *= 1 - risk;
        longest = Math.max(longest, ++streak);
      }
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
      if (equity < 0.5) ruin = true;
      curve.push(equity);
    }
    if (ruin) ruined++;
    finals.push(equity);
    drawdowns.push(maxDrawdown);
    streaks.push(longest);
    curves.push(curve);
  }
  const median = Array.from({ length: trades + 1 }, (_, t) =>
    quantile(
      curves.map((c) => c[t]),
      0.5,
    ),
  );
  return {
    expectancyR: winRate * winR - (1 - winRate),
    profitableShare: finals.filter((f) => f > 1).length / paths,
    medianReturnPct: (quantile(finals, 0.5) - 1) * 100,
    worstDecileReturnPct: (quantile(finals, 0.1) - 1) * 100,
    medianMaxDrawdownPct: quantile(drawdowns, 0.5) * 100,
    medianLosingStreak: quantile(streaks, 0.5),
    ruinShare: ruined / paths,
    sample: curves.slice(0, 24),
    median,
  };
}
