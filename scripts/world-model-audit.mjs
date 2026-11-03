/** Run with Node 24: node --experimental-strip-types scripts/world-model-audit.mjs --output /absolute/audit.json */
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createWorld,
  stepWorld,
  settleWorld,
  applyCommand,
  quoteTrade,
  tokenPrice,
} from "../src/lib/world/engine.ts";
import { CHAINS, ENGINE_VERSION } from "../src/lib/world/config.ts";
import { atoms, units } from "../src/lib/world/amount.ts";
import { validateWorld } from "../src/lib/world/repository.ts";

const args = process.argv.slice(2),
  option = (key, fallback) => {
    const i = args.indexOf(key);
    return i < 0 ? fallback : args[i + 1];
  };
const worlds = Number(option("--worlds", "1000")),
  seconds = Number(option("--seconds", "120")),
  output = option("--output", undefined);
assert.ok(Number.isInteger(worlds) && worlds >= 16 && worlds <= 10000, "worlds must be 16–10000");
assert.ok(
  Number.isInteger(seconds) && seconds >= 120 && seconds <= 7200,
  "seconds must be 120–7200",
);
const regimes = ["inflow", "rotation", "outflow", "stress"],
  variants = ["standard", "thin", "busy", "costly"];
const nativeTotals = (w) =>
  Object.fromEntries(
    CHAINS.map((c) => [
      c.id,
      BigInt(w.wallet[c.id].native) +
        BigInt(w.treasury[c.id].native) +
        BigInt(w.bank[c.id].native) +
        BigInt(w.burnt[c.id]) +
        w.participants.reduce((s, p) => s + BigInt(p.balances[c.id]), 0n) +
        w.tokens.filter((t) => t.chain === c.id).reduce((s, t) => s + BigInt(t.pool.quote), 0n),
    ]),
  );
const stableTotal = (w) =>
  CHAINS.reduce(
    (s, c) =>
      s +
      BigInt(w.wallet[c.id].stable) +
      BigInt(w.treasury[c.id].stable) +
      BigInt(w.bank[c.id].stable),
    0n,
  ) + w.bridges.filter((b) => b.status === "in_transit").reduce((s, b) => s + BigInt(b.amount), 0n);
function check(w, native, stable) {
  assert.deepEqual(nativeTotals(w), native, `${w.id}: native conservation`);
  assert.equal(stableTotal(w), stable, `${w.id}: stable conservation`);
  for (const t of w.tokens) {
    const held =
      BigInt(t.pool.token) +
      BigInt(t.creatorTokens) +
      BigInt(w.lockedTokens[t.id] ?? "0") +
      BigInt(w.positions[t.id]?.quantity ?? "0") +
      w.participants.reduce((s, p) => s + BigInt(p.tokens[t.id] ?? "0"), 0n);
    assert.equal(held, BigInt(t.supply), `${w.id}/${t.id}: token conservation`);
  }
  assert.equal(validateWorld(w), true, `${w.id}: checkpoint validation`);
}
function advance(w, interval) {
  while (interval > 0) {
    const step = Math.min(interval, 3600);
    w = stepWorld(w, step);
    interval -= step;
  }
  return w;
}
const quantiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    p10: sorted[Math.floor((sorted.length - 1) * 0.1)] ?? 0,
    median: sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0,
    p90: sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0,
    max: sorted.at(-1) ?? 0,
    mean: values.reduce((s, v) => s + v, 0) / (values.length || 1),
  };
};
const grouped = Object.fromEntries(
  variants.map((variant) => [
    variant,
    {
      worlds: 0,
      births: 0,
      migrations: 0,
      incidents: 0,
      liquidityUsd: [],
      feesUsd: [],
      simplePolicyExcessPct: [],
    },
  ]),
);
const summary = {
  engineVersion: ENGINE_VERSION,
  fixture: "fixed-1000-seed-audit-v2",
  worlds,
  simulatedSecondsPerWorld: seconds,
  variants: grouped,
  regimes: Object.fromEntries(regimes.map((r) => [r, 0])),
  newBirths: 0,
  migrations: 0,
  riskEvents: {},
  privateIntentDistribution: {},
  priceMultiples: { belowHalf: 0, halfToTwo: 0, twoToTen: 0, tenOrMore: 0 },
  nativeAndTokenConservation: "passed",
  stableConservation: "passed",
  checkpointValidation: "passed",
  baseline: {
    cashHoldMaxAbsoluteExcessPct: 0,
    simplePolicyExcessPct: [],
    simplePolicyWins: 0,
    simplePolicyTrades: 0,
  },
  limitations: [
    "All names, reserves and prices are fictional.",
    "These synthetic distributions do not estimate real market frequencies or validate trading profitability.",
    "The simple baseline buys the first publicly tradable project with 10 teaching USD and tries a full exit after 60 seconds; costs and failures remain real within the model.",
  ],
};
const incidentTypes = new Set([
  "liquidity_removed",
  "permission_used",
  "tax_changed",
  "supply_changed",
  "large_holder_sell",
]);
for (let i = 0; i < worlds; i++) {
  const marketVariant = variants[Math.floor(i / 4) % 4],
    regime = regimes[i % 4],
    g = grouped[marketVariant];
  const initial = createWorld({
    seed: `model-audit-v2-${i}`,
    mode: "free",
    regime,
    marketVariant,
    spawnPerMinute: 6,
    protection: true,
    duration: seconds,
  });
  const native = nativeTotals(initial),
    stable = stableTotal(initial);
  let quiet = advance(initial, seconds);
  const births = quiet.tokens.length - initial.tokens.length;
  summary.newBirths += births;
  g.births += births;
  g.worlds++;
  summary.regimes[regime]++;
  for (const t of quiet.tokens) {
    summary.privateIntentDistribution[t.latent.intent] =
      (summary.privateIntentDistribution[t.latent.intent] ?? 0) + 1;
    const multiple = t.initialPrice ? tokenPrice(t) / t.initialPrice : 0;
    summary.priceMultiples[
      multiple < 0.5
        ? "belowHalf"
        : multiple < 2
          ? "halfToTwo"
          : multiple < 10
            ? "twoToTen"
            : "tenOrMore"
    ]++;
    g.liquidityUsd.push(units(t.pool.quote) * quiet.fx[t.chain]);
  }
  for (const e of quiet.events) {
    if (e.type === "migrated") {
      summary.migrations++;
      g.migrations++;
    }
    if (incidentTypes.has(e.type)) {
      summary.riskEvents[e.type] = (summary.riskEvents[e.type] ?? 0) + 1;
      g.incidents++;
    }
  }
  quiet = settleWorld(quiet);
  check(quiet, native, stable);
  summary.baseline.cashHoldMaxAbsoluteExcessPct = Math.max(
    summary.baseline.cashHoldMaxAbsoluteExcessPct,
    Math.abs(quiet.report.excessPct),
  );
  assert.ok(
    Math.abs(quiet.report.excessPct) <= 0.000001,
    "cash hold must match its own FX baseline",
  );
  let policy = structuredClone(initial);
  const t = policy.tokens.find(
    (t) => quoteTrade(policy, t.id, "buy", atoms((10 / policy.fx[t.chain]).toFixed(6))).ok,
  );
  if (t) {
    const buy = applyCommand(policy, {
      id: "audit-public-buy",
      type: "buy",
      tokenId: t.id,
      amount: atoms((10 / policy.fx[t.chain]).toFixed(6)),
      minOut: "0",
      note: "预先固定的10教学美元基线",
      deadline: 120,
    });
    policy = buy.world;
    policy = advance(policy, 60);
    if (BigInt(policy.positions[t.id]?.quantity ?? "0") > 0n)
      policy = applyCommand(policy, {
        id: "audit-public-sell",
        type: "sell",
        tokenId: t.id,
        amount: policy.positions[t.id].quantity,
        minOut: "0",
        note: "固定60秒后尝试退出",
        deadline: policy.now + 120,
      }).world;
    policy = advance(policy, seconds - 60);
  } else policy = advance(policy, seconds);
  policy = settleWorld(policy);
  check(policy, native, stable);
  const excess = policy.report.excessPct;
  g.feesUsd.push(policy.report.fees);
  g.simplePolicyExcessPct.push(excess);
  summary.baseline.simplePolicyExcessPct.push(excess);
  if (excess > 0) summary.baseline.simplePolicyWins++;
  summary.baseline.simplePolicyTrades += policy.report.trades;
  if ((i + 1) % 100 === 0) process.stderr.write(`Audited ${i + 1}/${worlds} worlds\n`);
}
summary.baseline.simplePolicyExcessPct = quantiles(summary.baseline.simplePolicyExcessPct);
for (const g of Object.values(grouped)) {
  g.liquidityUsd = quantiles(g.liquidityUsd);
  g.feesUsd = quantiles(g.feesUsd);
  g.simplePolicyExcessPct = quantiles(g.simplePolicyExcessPct);
}
const json = `${JSON.stringify(summary, null, 2)}\n`;
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, json);
}
process.stdout.write(json);
