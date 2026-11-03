import assert from "node:assert/strict";
import test from "node:test";
import { nextFundingStep, fundingGas } from "./funding.ts";
import { applyCommand, createWorld, stepWorld } from "./engine.ts";
import { atoms } from "./amount.ts";
import { validateWorld } from "./repository.ts";
import { CHAINS } from "./config.ts";
import type { World } from "./types.ts";
const make = () =>
  createWorld({
    seed: "funding-integration",
    mode: "free",
    regime: "rotation",
    duration: 3600,
    spawnPerMinute: 2,
    protection: true,
  });
function totals(w: World) {
  return {
    stable:
      CHAINS.reduce(
        (s, c) =>
          s +
          BigInt(w.wallet[c.id].stable) +
          BigInt(w.bank[c.id].stable) +
          BigInt(w.treasury[c.id].stable),
        0n,
      ) +
      w.bridges.filter((b) => b.status === "in_transit").reduce((s, b) => s + BigInt(b.amount), 0n),
    native: CHAINS.map(
      (c) =>
        BigInt(w.wallet[c.id].native) +
        BigInt(w.bank[c.id].native) +
        BigInt(w.treasury[c.id].native) +
        BigInt(w.burnt[c.id]) +
        w.participants.reduce((s, p) => s + BigInt(p.balances[c.id]), 0n) +
        w.tokens.filter((t) => t.chain === c.id).reduce((s, t) => s + BigInt(t.pool.quote), 0n),
    ),
  };
}
test("automatic preparation uses actual local swaps and preserves every ledger", () => {
  let w = make();
  const before = totals(w),
    amount = atoms("0.1");
  const next = nextFundingStep(w, "base", amount, "fund-local");
  assert.equal(next.kind, "command");
  if (next.kind !== "command") return;
  assert.equal(next.command.type, "swap");
  const result = applyCommand(w, next.command);
  assert.equal(result.ok, true);
  w = stepWorld(result.world, 30);
  assert.equal(nextFundingStep(w, "base", amount, "done").kind, "ready");
  assert.deepEqual(totals(w), before);
  assert.equal(validateWorld(w), true);
  assert.ok(w.feesUsd > 0);
});
test("cross-chain preparation waits for a real bridge and then swaps on target", () => {
  let w = make();
  const before = totals(w),
    amount = atoms("1.5");
  let sawTransit = false,
    sawBridge = false,
    sawTargetSwap = false;
  for (let i = 0; i < 60; i++) {
    const step = nextFundingStep(w, "base", amount, `fund-${i}`);
    if (step.kind === "ready") break;
    assert.notEqual(step.kind, "blocked");
    if (step.kind === "command") {
      sawBridge ||= step.command.type === "bridge";
      sawTargetSwap ||= step.command.type === "swap" && step.command.chain === "base";
      const r = applyCommand(w, step.command);
      assert.equal(r.ok, true);
      w = r.world;
    }
    w = stepWorld(w, 15);
    sawTransit ||= w.bridges.some((b) => b.status === "in_transit");
    assert.deepEqual(totals(w), before);
  }
  assert.equal(nextFundingStep(w, "base", amount, "done").kind, "ready");
  assert.ok(sawBridge && sawTransit && sawTargetSwap);
  assert.equal(validateWorld(w), true);
});
test("in-transit cash is never spendable and zero gas uses a paid service", () => {
  const w = make();
  w.wallet.base.native = "0";
  const bootstrap = nextFundingStep(w, "base", atoms("1"), "zero");
  assert.equal(bootstrap.kind, "command");
  if (bootstrap.kind === "command") assert.equal(bootstrap.command.type, "gas_topup");
  w.wallet.base.native = (fundingGas(w, "base") * 4n).toString();
  w.bridges.push({
    id: "pending",
    from: "solana",
    to: "base",
    amount: atoms("100"),
    fee: atoms("1"),
    dueAt: w.now + 100,
    status: "in_transit",
  });
  assert.equal(nextFundingStep(w, "base", atoms("1"), "pending").kind, "wait");
});
test("a zero-gas target with no stable balance can recover through paid source topup and bridge", () => {
  let w = make();
  for (const c of CHAINS) {
    w.bank[c.id].native = (BigInt(w.bank[c.id].native) + BigInt(w.wallet[c.id].native)).toString();
    w.wallet[c.id].native = "0";
  }
  w.bank.base.stable = (BigInt(w.bank.base.stable) + BigInt(w.wallet.base.stable)).toString();
  w.wallet.base.stable = "0";
  const before = totals(w),
    amount = atoms("0.01");
  const kinds = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const next = nextFundingStep(w, "base", amount, `recover-${i}`);
    if (next.kind === "ready") break;
    assert.notEqual(next.kind, "blocked", next.message);
    if (next.kind === "command") {
      kinds.add(next.command.type);
      const r = applyCommand(w, next.command);
      assert.equal(r.ok, true, r.error);
      w = r.world;
    }
    w = stepWorld(w, 15);
    assert.deepEqual(totals(w), before);
  }
  assert.equal(nextFundingStep(w, "base", amount, "done").kind, "ready");
  assert.ok(kinds.has("gas_topup") && kinds.has("bridge") && kinds.has("swap"));
  assert.ok(w.feesUsd > 0);
  assert.equal(validateWorld(w), true);
});
test("preparation refuses invalid amounts and excludes holdings from cash", () => {
  const w = make();
  for (const c of CHAINS) {
    w.wallet[c.id].stable = "0";
    w.wallet[c.id].native = (fundingGas(w, c.id) * 2n).toString();
  }
  assert.equal(nextFundingStep(w, "base", "NaN", "bad").kind, "blocked");
  assert.equal(nextFundingStep(w, "base", atoms("10"), "cash").kind, "blocked");
});

test("a small zero-gas wallet only pays for the balance it needs", () => {
  let w = make();
  w.bank.base.native = (BigInt(w.bank.base.native) + BigInt(w.wallet.base.native)).toString();
  w.wallet.base.native = "0";
  w.bank.base.stable = (
    BigInt(w.bank.base.stable) +
    BigInt(w.wallet.base.stable) -
    BigInt(atoms("2"))
  ).toString();
  w.wallet.base.stable = atoms("2");
  const before = totals(w);
  const amount = atoms("0.0001");
  const first = nextFundingStep(w, "base", amount, "small-zero");
  assert.equal(first.kind, "command");
  if (first.kind !== "command") return;
  assert.equal(first.command.type, "gas_topup");
  assert.ok(BigInt(first.command.amount) < BigInt(atoms("2")));
  const result = applyCommand(w, first.command);
  assert.ok(result.ok, result.error);
  w = stepWorld(result.world, 30);
  assert.equal(nextFundingStep(w, "base", amount, "small-ready").kind, "ready");
  assert.deepEqual(totals(w), before);
  assert.ok(validateWorld(w));
});

test("simple trading preparation shares the engine's teaching gas quote", () => {
  let w = createWorld({
    seed: "simple-funding",
    mode: "free",
    regime: "rotation",
    duration: 3600,
    spawnPerMinute: 2,
    protection: true,
    assessmentVersion: "process-v2-trading",
  });
  for (const c of CHAINS) {
    w.bank[c.id].native = (BigInt(w.bank[c.id].native) + BigInt(w.wallet[c.id].native)).toString();
    w.wallet[c.id].native = "0";
  }
  const before = totals(w),
    amount = atoms("0.002");
  for (let i = 0; i < 30; i++) {
    const next = nextFundingStep(w, "base", amount, `simple-funding-${i}`);
    if (next.kind === "ready") break;
    assert.notEqual(next.kind, "blocked", next.message);
    if (next.kind === "command") {
      const result = applyCommand(w, next.command);
      assert.ok(result.ok, result.error);
      w = result.world;
    }
    w = stepWorld(w, 15);
    assert.deepEqual(totals(w), before);
  }
  assert.equal(nextFundingStep(w, "base", amount, "simple-ready").kind, "ready");
  assert.ok(validateWorld(w));
});
