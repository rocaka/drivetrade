import { atoms, units } from "./amount.ts";
import { EASTER_EGG_ASSETS } from "./config.ts";
import { random } from "./random.ts";
import type { Atom } from "./types.ts";

/** A bounded, versioned pre-entry market. These seconds are actually simulated. */
export const MIXED_BOOTSTRAP_SECONDS = 3600;
export const MIXED_INITIAL_TOKENS = 36;

export function mixedSeed(seed: string): string {
  return `${seed}:generation:mixed-v1`;
}

/** Three overlapping generations, with independently seeded launch times. */
export function mixedBirthSchedule(seed: string): number[] {
  const domain = mixedSeed(seed);
  return Array.from({ length: MIXED_INITIAL_TOKENS }, (_, index) => {
    const cohort = Math.floor(index / 12);
    const [start, width] = [
      [-3600, 600],
      [-2400, 1500],
      [-480, 480],
    ][cohort];
    // Stratification guarantees a broad age mix while retaining seed-specific launches.
    return start + Math.floor((((index % 12) + random(domain, "launch-time", index)) * width) / 12);
  }).sort((a, b) => a - b);
}

/** Supply denomination changes unit price; every unit has a ledger owner. */
export function mixedSupply(
  seed: string,
  index: number,
): {
  supply: Atom;
  poolTokens: Atom;
  creatorTokens: Atom;
  lockedTokens: Atom;
} {
  const domain = mixedSeed(seed);
  // Interleaved denomination bands avoid an accidental all-micro-price market.
  const band = (index + Math.floor(random(domain, "supply-band", Math.floor(index / 6)) * 6)) % 6;
  const exponent = 3 + band * 1.6 + random(domain, "supply-size", index) * 1.1;
  const total = BigInt(atoms(Math.pow(10, exponent).toFixed(6)));
  const pool = (total * 70n) / 100n;
  const creator = (total * 10n) / 100n;
  return {
    supply: total.toString(),
    poolTokens: pool.toString(),
    creatorTokens: creator.toString(),
    lockedTokens: (total - pool - creator).toString(),
  };
}

/** Only a small executable float enters these deeper pools; all remaining supply is locked. */
export function mixedEasterEgg(seed: string, index: number, fx: number, liquidityScale: number) {
  const spec = EASTER_EGG_ASSETS[index];
  if (!spec || index < 0 || !Number.isInteger(index)) return undefined;
  const domain = mixedSeed(seed);
  const price =
    spec.priceUsd[0] +
    random(domain, "easter-egg-price", spec.id) * (spec.priceUsd[1] - spec.priceUsd[0]);
  const liquidity =
    (spec.liquidityUsd[0] +
      random(domain, "easter-egg-liquidity", spec.id) *
        (spec.liquidityUsd[1] - spec.liquidityUsd[0])) *
    liquidityScale;
  const quote = atoms((liquidity / fx).toFixed(6));
  // Derive inventory from the actual atom-rounded native reserve, not a displayed price.
  const poolTokens = atoms(((units(quote) * fx) / price).toFixed(6));
  const supply = atoms(spec.supply);
  return {
    spec,
    quote,
    supply,
    poolTokens,
    creatorTokens: "0",
    lockedTokens: (BigInt(supply) - BigInt(poolTokens)).toString(),
  };
}

/** Attention can fade after a real trading lifecycle; quiet projects can still revive. */
export function mixedAttention(seed: string, address: string, age: number): number {
  const domain = mixedSeed(seed);
  const lifetime = 180 + Math.pow(random(domain, "attention-lifetime", address), 2) * 7200;
  return 0.002 + 0.998 * Math.exp(-Math.max(0, age) / lifetime);
}
