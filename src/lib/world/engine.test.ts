import { test } from "node:test";
import assert from "node:assert/strict";
import { atoms, units } from "./amount.ts";
import { CHAINS, EASTER_EGG_ASSETS } from "./config.ts";
import {
  createWorld,
  applyCommand,
  stepWorld,
  settleWorld,
  quoteTrade,
  poolQuote,
  liquidationValue,
  publicObservations,
  tokenPrice,
} from "./engine.ts";
import type { ChainId, World, WorldConfig } from "./types.ts";

const config: WorldConfig = {
  seed: "engine-fixture-2026",
  mode: "free",
  regime: "rotation",
  spawnPerMinute: 6,
  protection: false,
  duration: 7200,
};
function nativeTotals(w: World) {
  return Object.fromEntries(
    CHAINS.map((c) => [
      c.id,
      BigInt(w.wallet[c.id].native) +
        BigInt(w.treasury[c.id].native) +
        BigInt(w.bank[c.id].native) +
        BigInt(w.burnt[c.id]) +
        w.participants.reduce((sum, p) => sum + BigInt(p.balances[c.id]), 0n) +
        w.tokens.filter((t) => t.chain === c.id).reduce((sum, t) => sum + BigInt(t.pool.quote), 0n),
    ]),
  );
}
function stableTotal(w: World) {
  return (
    CHAINS.reduce(
      (s, c) =>
        s +
        BigInt(w.wallet[c.id].stable) +
        BigInt(w.treasury[c.id].stable) +
        BigInt(w.bank[c.id].stable),
      0n,
    ) +
    w.bridges.filter((b) => b.status === "in_transit").reduce((s, b) => s + BigInt(b.amount), 0n)
  );
}
function assertTokenSupplies(w: World) {
  for (const t of w.tokens) {
    const held =
      BigInt(t.pool.token) +
      BigInt(t.creatorTokens) +
      BigInt(w.lockedTokens[t.id] ?? "0") +
      BigInt(w.positions[t.id]?.quantity ?? "0") +
      w.participants.reduce((sum, p) => sum + BigInt(p.tokens[t.id] ?? "0"), 0n);
    assert.equal(held, BigInt(t.supply), `supply conservation ${t.symbol}`);
  }
}
function buyable(w: World) {
  return w.tokens.find((t) => quoteTrade(w, t.id, "buy", atoms(".05".replace(/^\./, "0."))).ok)!;
}

test("fixed amounts, genesis, native and token balances are exact", () => {
  assert.equal(atoms("0.000001"), "1");
  assert.throws(() => atoms("0.0000001"));
  const w = createWorld(config);
  assert.equal(w.initialEquity, 10000);
  assert.equal(liquidationValue(w), 10000);
  assert.equal(new Set(w.tokens.map((t) => t.chain)).size, 3);
  assert.equal(new Set(w.tokens.map((t) => t.platformId)).size, 5);
  assertTokenSupplies(w);
});

const mixedConfig: WorldConfig = {
  ...config,
  seed: "mixed-fixture",
  generationProfile: "mixed-v1",
};

test("mixed generation replays actual seeded launches, market history and quiet older projects", () => {
  const w = createWorld(mixedConfig);
  assert.deepEqual(w, createWorld(mixedConfig));
  assert.equal(w.tokens.length, 36);
  assert.equal(new Set(w.tokens.map((t) => t.bornAt)).size, 36);
  assert.equal(w.tokens.filter((t) => t.bornAt <= -3000).length, 12);
  assert.equal(w.tokens.filter((t) => t.bornAt >= -2400 && t.bornAt <= -900).length, 12);
  assert.equal(w.tokens.filter((t) => t.bornAt >= -480).length, 12);
  assert.ok(w.tokens.some((t) => t.status === "dormant"));
  assert.ok(
    w.tokens.some((t) => tokenPrice(t) < t.peakPrice * 0.8 && (t.lastTradeAt ?? t.bornAt) < -600),
  );
  for (const t of w.tokens) {
    assert.ok(t.history.length > 1);
    assert.equal(t.history.at(-1)?.t, 0);
    assert.equal(t.history.at(-1)?.price, tokenPrice(t));
    assert.ok(
      t.history.every(
        (p, i) => p.t >= t.bornAt && (i === 0 || p.volume >= t.history[i - 1].volume),
      ),
    );
  }
  assert.ok(w.tokens.reduce((sum, t) => sum + t.trades, 0) > 1000);
  assert.ok(w.events.some((e) => e.type === "large_holder_sell" && e.at < 0));
});

test("mixed prices span denominations backed by real pools and all allocations conserve supply", () => {
  const w = createWorld(mixedConfig),
    legacy = createWorld(config);
  const prices = w.tokens.map((t) => tokenPrice(t) * w.fx[t.chain]);
  assert.ok(Math.max(...prices) / Math.min(...prices) > 1e7);
  assert.ok(Math.max(...prices) > 1);
  assert.ok(Math.min(...prices) < 0.000001);
  assert.ok(new Set(w.tokens.map((t) => t.supply)).size > 30);
  for (const t of w.tokens) {
    const virtual = t.pool.kind === "curve";
    assert.equal(
      tokenPrice(t),
      Number(BigInt(t.pool.quote) + (virtual ? BigInt(t.pool.virtualQuote) : 0n)) /
        Number(BigInt(t.pool.token) + (virtual ? BigInt(t.pool.virtualToken) : 0n)),
    );
  }
  assertTokenSupplies(w);
  assert.deepEqual(nativeTotals(w), nativeTotals(legacy));
  assert.equal(stableTotal(w), stableTotal(legacy));
  const later = stepWorld(w, 180);
  assert.ok(later.tokens.length > w.tokens.length);
  assertTokenSupplies(later);
  assert.deepEqual(nativeTotals(later), nativeTotals(w));
  assert.equal(stableTotal(later), stableTotal(w));
  assert.deepEqual(later, stepWorld(createWorld(mixedConfig), 180));
});

test("four unique simulated mapping assets have funded deep pools and no rug capabilities", () => {
  const w = createWorld(mixedConfig);
  const eggs = w.tokens.filter((t) => t.easterEgg);
  assert.deepEqual(
    eggs.map((t) => t.easterEgg),
    ["btc", "eth", "sol", "doge"],
  );
  for (const [index, token] of eggs.entries()) {
    const spec = EASTER_EGG_ASSETS[index];
    assert.equal(token.id, `${w.id}-t${index}`);
    assert.equal(token.symbol, spec.symbol);
    assert.equal(token.chain, spec.chain);
    assert.equal(token.supply, atoms(spec.supply));
    assert.equal(token.creatorTokens, "0");
    assert.ok(BigInt(w.lockedTokens[token.id]) > (BigInt(token.supply) * 99n) / 100n);
    assert.equal(token.platformId, "open-market");
    assert.equal(token.pool.kind, "cpmm");
    assert.equal(token.pool.virtualQuote, "0");
    assert.equal(token.pool.virtualToken, "0");
    assert.equal(token.pool.lpLocked, true);
    assert.equal(token.mintAuthority, false);
    assert.equal(token.freezeAuthority, false);
    assert.equal(token.taxMutable, false);
    assert.equal(token.sellTaxBps, 0);
    assert.equal(token.frozen, false);
    assert.equal(token.latent.intent, "honest");
    assert.equal(token.latent.fired, false);
    assert.match(token.narrative, /非实时行情/);
    const priceUsd = tokenPrice(token) * w.fx[token.chain];
    assert.ok(priceUsd > spec.priceUsd[0] * 0.9 && priceUsd < spec.priceUsd[1] * 1.1);
    assert.ok(units(token.pool.quote) * w.fx[token.chain] > spec.liquidityUsd[0] * 0.9);
    assert.ok(token.trades > 0);
    const quote = quoteTrade(w, token.id, "buy", atoms("0.01"));
    assert.ok(quote.ok);
    assert.ok(quote.impactPct < 2, "small orders use the actual deeper reserves");
  }
  const later = stepWorld({ ...w, config: { ...w.config, spawnPerMinute: 12 } }, 1200);
  assert.ok(later.tokens.length > 200, "exercise the ordinary active-project capacity policy");
  assert.equal(later.tokens.filter((t) => t.easterEgg).length, 4);
  assert.ok(later.tokens.filter((t) => t.easterEgg).every((t) => t.status === "pool"));
  assert.ok(later.tokens.slice(36).every((t) => !t.easterEgg));
  assert.deepEqual(nativeTotals(later), nativeTotals(w));
  assert.equal(stableTotal(later), stableTotal(w));
  assertTokenSupplies(later);
  const eggIds = new Set(eggs.map((t) => t.id));
  assert.ok(
    !later.events.some(
      (e) =>
        eggIds.has(e.tokenId ?? "") &&
        [
          "liquidity_removed",
          "permission_used",
          "tax_changed",
          "supply_changed",
          "large_holder_sell",
        ].includes(e.type),
    ),
  );
  assert.ok(createWorld(config).tokens.every((t) => !t.easterEgg));
  assert.ok(createWorld({ ...config, mode: "exam" }).tokens.every((t) => !t.easterEgg));
});

test("mixed entry resets the player baseline after bounded bootstrap and guards assessment profiles", () => {
  const w = createWorld({
    ...mixedConfig,
    duration: 120,
    protection: true,
    spawnPerMinute: Infinity,
  });
  assert.equal(w.now, 0);
  assert.equal(w.phase, "running");
  assert.equal(w.tokens.length, 36, "bootstrap work does not scale with configured issuance");
  assert.equal(w.config.spawnPerMinute, 12);
  assert.equal(w.initialEquity, 10000);
  assert.equal(liquidationValue(w), 10000);
  assert.deepEqual(w.initialWallet, w.wallet);
  assert.deepEqual(w.initialFx, w.fx);
  assert.notEqual(w.initialFx, w.fx);
  assert.deepEqual(w.equity, [{ t: 0, equity: 10000, baseline: 10000 }]);
  assert.equal(w.feesUsd, 0);
  assert.equal(w.maxDrawdownPct, 0);
  assert.equal(w.stopUntil, 0);
  assert.equal(w.transactions.length, 0);
  assert.equal(w.riskEvidence.length, 0);
  assert.throws(() => createWorld({ ...mixedConfig, mode: "exam" }), /仅用于自由练习/);
  assert.throws(() => createWorld({ ...mixedConfig, mode: "practice" }), /仅用于自由练习/);
  assert.throws(
    () => createWorld({ ...mixedConfig, generationProfile: "unknown" } as unknown as WorldConfig),
    /不支持/,
  );
  const legacy = createWorld(config);
  assert.equal(legacy.engineVersion, "world-2.0.0");
  assert.equal(legacy.config.generationProfile, undefined);
  assert.ok(legacy.tokens.every((t) => t.bornAt === -120 && t.supply === atoms("1000000000")));
  assert.deepEqual(
    legacy.tokens.slice(4).map((t) => [t.name, t.symbol]),
    createWorld({ ...config, generationProfile: "mixed-v1" })
      .tokens.slice(4)
      .map((t) => [t.name, t.symbol]),
  );
});

test("same seed and commands replay identically; continuous birth never creates quote assets", () => {
  const start = createWorld(config);
  const next = stepWorld(start, 180);
  assert.deepEqual(next, stepWorld(createWorld(config), 180));
  assert.ok(next.tokens.length > start.tokens.length);
  assert.deepEqual(nativeTotals(next), nativeTotals(start));
  assert.equal(stableTotal(next), stableTotal(start));
  assertTokenSupplies(next);
});

test("confirmed commands are idempotent and use queued execution", () => {
  const w = createWorld(config),
    t = buyable(w),
    amount = atoms("0.05");
  const q = quoteTrade(w, t.id, "buy", amount);
  assert.ok(q.ok);
  const command = {
    id: "buy-unique",
    type: "buy" as const,
    tokenId: t.id,
    amount,
    minOut: "0",
    note: "有限投入观察池子变化",
  };
  const queued = applyCommand(w, command);
  assert.ok(queued.ok);
  assert.equal(queued.world.positions[t.id], undefined);
  assert.deepEqual(applyCommand(queued.world, command).world, queued.world);
  const after = stepWorld(queued.world, 4);
  assert.equal(after.transactions.find((x) => x.id === command.id)?.status, "confirmed");
  assert.ok(BigInt(after.positions[t.id].quantity) > 0n);
  assert.deepEqual(applyCommand(after, command).world, after);
  assert.deepEqual(nativeTotals(after), nativeTotals(w));
  assertTokenSupplies(after);
});

test("minOut failure rolls swap back but preserves executed gas only", () => {
  const w = createWorld(config),
    t = buyable(w),
    before = BigInt(w.wallet[t.chain].native);
  const q = quoteTrade(w, t.id, "buy", atoms("0.05"));
  const queued = applyCommand(w, {
    id: "fail-min-out",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.05"),
    minOut: "100000000000000000000000000",
    note: "测试执行变化",
  }).world;
  const after = stepWorld(queued, 4),
    tx = after.transactions.find((x) => x.id === "fail-min-out")!;
  assert.equal(tx.status, "reverted");
  assert.equal(after.positions[t.id], undefined);
  assert.equal(BigInt(after.wallet[t.chain].native), before - BigInt(q.gas));
  assert.deepEqual(nativeTotals(after), nativeTotals(w));
});

test("virtual reserve cannot be withdrawn; sold output is bounded by the real vault", () => {
  const w = createWorld(config),
    t = structuredClone(w.tokens.find((t) => t.pool.kind === "curve")!);
  t.pool.quote = "0";
  t.pool.virtualQuote = atoms("1000000");
  const q = poolQuote(t, "sell", atoms("100"));
  assert.equal(q.ok, false);
  assert.match(q.error ?? "", /真实金库/);
});

test("locked LP cannot be removed by an incompatible private event", () => {
  let w = createWorld(config);
  const t = w.tokens.find((t) => t.pool.lpLocked)!;
  t.latent.intent = "pull";
  t.latent.incidentAt = 1;
  t.latent.fired = false;
  w = stepWorld(w, 2);
  assert.equal(w.tokens.find((x) => x.id === t.id)?.pool.lpLocked, true);
  assert.equal(
    w.events.some((e) => e.type === "liquidity_removed" && e.tokenId === t.id),
    false,
  );
  assertTokenSupplies(w);
});

test("bridge escrow is counted once and does not magically become destination gas", () => {
  const w = createWorld(config),
    nativeBefore = w.wallet.base.native,
    total = stableTotal(w);
  const queued = applyCommand(w, {
    id: "bridge-1",
    type: "bridge",
    from: "solana",
    to: "base",
    amount: atoms("100"),
    note: "跨链稳定资产",
  }).world;
  const inTransit = stepWorld(queued, 4);
  assert.equal(inTransit.bridges[0]?.status, "in_transit");
  assert.equal(stableTotal(inTransit), total);
  assert.equal(inTransit.wallet.base.native, nativeBefore);
  const completed = stepWorld(inTransit, 220);
  assert.equal(completed.bridges[0].status, "completed");
  assert.equal(stableTotal(completed), total);
  assert.equal(completed.wallet.base.native, nativeBefore);
});

test("no target-chain gas means local rejection and no fee", () => {
  const w = createWorld(config);
  const t = w.tokens.find((t) => t.chain === "base" && poolQuote(t, "buy", atoms("0.005")).ok)!;
  w.wallet.base.native = "0";
  const result = applyCommand(w, {
    id: "no-gas",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.005"),
    minOut: "0",
    note: "缺gas测试",
  });
  assert.equal(result.ok, false);
  assert.equal(result.world, w);
  assert.equal(result.world.feesUsd, 0);
});

test("full-loss budget rejects confirmed oversized intent while ordinary input mistakes do not score", () => {
  let w = createWorld({ ...config, protection: true });
  const funded = applyCommand(w, {
    id: "fund-risk-test",
    type: "swap",
    chain: "solana",
    direction: "to_native",
    amount: atoms("200"),
    note: "准备本链资金",
  });
  w = stepWorld(funded.world, 4);
  const t = w.tokens.find((t) => t.chain === "solana" && t.pool.kind === "cpmm")!;
  const oversized = applyCommand(w, {
    id: "risk-1",
    type: "buy",
    tokenId: t.id,
    amount: atoms(String(110 / w.fx[t.chain])),
    minOut: "0",
    note: "确认超预算",
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.world.riskEvidence.length, 1);
  const invalid = applyCommand(w, {
    id: "risk-invalid",
    type: "buy",
    tokenId: t.id,
    amount: "-1",
    minOut: "0",
    note: "草稿错误",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.world.riskEvidence.length, 0);
});

test("formal world cannot end early or lower its fixed duration", () => {
  const w = createWorld({ ...config, mode: "exam", duration: 120, protection: false });
  assert.equal(w.config.duration, 7200);
  assert.equal(w.config.protection, true);
  assert.equal(applyCommand(w, { id: "finish-early", type: "finish" }).ok, false);
  assert.equal(settleWorld(w), w);
});

test("settlement cancels buys and never fabricates a sale of a frozen asset", () => {
  let w = createWorld(config);
  const t = buyable(w);
  w = applyCommand(w, {
    id: "buy-before-freeze",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.05"),
    minOut: "0",
    note: "随后遭遇冻结",
  }).world;
  w = stepWorld(w, 4);
  assert.ok(w.positions[t.id]);
  w.tokens.find((x) => x.id === t.id)!.frozen = true;
  const other = buyable(w);
  w = applyCommand(w, {
    id: "pending-buy",
    type: "buy",
    tokenId: other.id,
    amount: atoms("0.01"),
    minOut: "0",
    note: "未执行的新增风险",
  }).world;
  const done = settleWorld(w);
  assert.equal(done.phase, "completed");
  assert.ok(done.report);
  assert.equal(done.transactions.find((tx) => tx.id === "pending-buy")?.status, "cancelled");
  assert.ok(BigInt(done.positions[t.id].quantity) > 0n);
  assert.ok(done.report!.residual >= 1);
  assert.equal(
    done.transactions.filter(
      (tx) => tx.type === "sell" && tx.tokenId === t.id && tx.status === "confirmed",
    ).length,
    0,
  );
  assertTokenSupplies(done);
});

test("observations expose current capabilities rather than hidden future intent", () => {
  const w = createWorld(config),
    t = w.tokens[0],
    obs = JSON.stringify(publicObservations(w, t.id));
  assert.ok(obs.includes("LP"));
  assert.ok(!obs.includes("incidentAt"));
  assert.ok(!obs.includes("appeal"));
});

test("own immediate buy/sell cannot monetize its marginal-price spike; LP fee stays in k", () => {
  let w = createWorld(config);
  for (const p of w.participants) for (const chain of CHAINS) p.balances[chain.id] = "0";
  for (const t of w.tokens) t.latent.intent = "honest";
  const t = w.tokens.find((t) => t.pool.kind === "cpmm" && t.chain === "solana")!;
  const before = w.initialEquity,
    k0 = BigInt(t.pool.token) * BigInt(t.pool.quote);
  const q = quoteTrade(w, t.id, "buy", atoms("0.05"));
  assert.ok(q.ok && BigInt(q.retainedFee ?? "0") > 0n);
  w = applyCommand(w, {
    id: "round-trip-buy",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.05"),
    minOut: "0",
    note: "先检查真实池冲击",
  }).world;
  w = stepWorld(w, 4);
  const p = w.positions[t.id];
  assert.ok(p);
  const updated = w.tokens.find((x) => x.id === t.id)!;
  assert.ok(BigInt(updated.pool.token) * BigInt(updated.pool.quote) > k0);
  assert.ok(
    liquidationValue(w) < before,
    "executable equity must not credit a self-created marginal spike",
  );
  w = applyCommand(w, {
    id: "round-trip-sell",
    type: "sell",
    tokenId: t.id,
    amount: p.quantity,
    minOut: "0",
    note: "立即按池子净回款退出",
  }).world;
  w = stepWorld(w, 4);
  const final = CHAINS.reduce(
    (sum, c) => sum + units(w.wallet[c.id].stable) + units(w.wallet[c.id].native) * w.fx[c.id],
    0,
  );
  assert.ok(final < before);
  assert.equal(w.positions[t.id].quantity, "0");
});

test("migration uses real quote only, preserves marginal price and all token supply", () => {
  let w = createWorld(config);
  for (const p of w.participants) for (const chain of CHAINS) p.balances[chain.id] = "0";
  const t = w.tokens.find((t) => t.pool.kind === "curve")!;
  for (const p of w.participants) delete p.tokens[t.id];
  t.supply = atoms("1000000");
  t.creatorTokens = atoms("100000");
  w.lockedTokens[t.id] = "0";
  w.participants[0].tokens[t.id] = atoms("675000");
  t.pool.token = atoms("225000");
  t.pool.quote = atoms("30");
  t.pool.virtualToken = "0";
  t.pool.virtualQuote = atoms("10");
  t.pool.targetQuote = atoms("30");
  t.pool.migratedAt = 1;
  t.status = "migrating";
  t.latent.intent = "honest";
  const native = nativeTotals(w);
  w = stepWorld(w, 1);
  const after = w.tokens.find((x) => x.id === t.id)!;
  assert.equal(after.pool.kind, "cpmm");
  assert.equal(after.pool.quote, atoms("30"));
  assert.equal(after.pool.token, atoms("168750"));
  assert.equal(w.lockedTokens[t.id], atoms("56250"));
  assert.equal(after.pool.virtualQuote, "0");
  assert.deepEqual(nativeTotals(w), native);
  assertTokenSupplies(w);
  assert.equal(w.events.filter((e) => e.type === "migrated" && e.tokenId === t.id).length, 1);
  w = stepWorld(w, 2);
  assert.equal(w.events.filter((e) => e.type === "migrated" && e.tokenId === t.id).length, 1);
});

test("explicit abandon preserves attempt and never produces a completed exam", () => {
  const w = createWorld({ ...config, mode: "exam" });
  const result = applyCommand(w, { id: "abandon-exam", type: "abandon" });
  assert.ok(result.ok);
  assert.equal(result.world.phase, "completed");
  assert.equal(result.world.report?.completed, false);
  assert.ok(result.world.report?.events.some((e) => e.type === "abandoned"));
});

test("pending buys of the same project cannot bypass the total full-loss budget", () => {
  let w = createWorld({ ...config, protection: true });
  w = applyCommand(w, {
    id: "fund-pending",
    type: "swap",
    chain: "solana",
    direction: "to_native",
    amount: atoms("250"),
    note: "准备资金",
  }).world;
  w = stepWorld(w, 4);
  const t = w.tokens.find((t) => t.chain === "solana" && t.pool.kind === "cpmm")!;
  const first = applyCommand(w, {
    id: "pending-risk-1",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.6"),
    minOut: "0",
    note: "首次60训练美元",
  });
  assert.ok(first.ok);
  const second = applyCommand(first.world, {
    id: "pending-risk-2",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.6"),
    minOut: "0",
    note: "第二次确认同额",
  });
  assert.equal(second.ok, false);
  assert.equal(second.world.riskEvidence.length, 1);
  assert.equal(second.world.transactions.filter((tx) => tx.type === "buy").length, 1);
});

test("sequential liquidation consumes gas and reuses actual earlier sale proceeds", () => {
  let w = createWorld(config);
  for (const p of w.participants) for (const chain of CHAINS) p.balances[chain.id] = "0";
  for (const t of w.tokens) t.latent.intent = "honest";
  const tokens = w.tokens.filter((t) => t.chain === "solana" && t.pool.kind === "cpmm").slice(0, 2);
  assert.equal(tokens.length, 2);
  for (const [i, t] of tokens.entries()) {
    w = applyCommand(w, {
      id: `liquidate-buy-${i}`,
      type: "buy",
      tokenId: t.id,
      amount: atoms("0.04"),
      minOut: "0",
      note: "有限分散教学仓位",
    }).world;
    w = stepWorld(w, 2);
  }
  const gas = BigInt(quoteTrade(w, tokens[0].id, "sell", w.positions[tokens[0].id].quantity).gas);
  const excess = BigInt(w.wallet.solana.native) - gas;
  w.wallet.solana.native = gas.toString();
  w.bank.solana.native = (BigInt(w.bank.solana.native) + excess).toString();
  const predicted = liquidationValue(w);
  for (const [i, t] of tokens.entries())
    w = applyCommand(w, {
      id: `liquidate-sell-${i}`,
      type: "sell",
      tokenId: t.id,
      amount: w.positions[t.id].quantity,
      minOut: "0",
      note: "按固定顺序退出",
    }).world;
  w = stepWorld(w, 3);
  const actual = CHAINS.reduce(
    (sum, c) => sum + units(w.wallet[c.id].stable) + units(w.wallet[c.id].native) * w.fx[c.id],
    0,
  );
  assert.ok(Math.abs(predicted - actual) < 0.000002);
  assert.equal(tokens.filter((t) => w.positions[t.id].quantity !== "0").length, 0);
  const zeroGas = structuredClone(w);
  zeroGas.positions[tokens[0].id] = {
    tokenId: tokens[0].id,
    quantity: atoms("1000"),
    costUsd: atoms("1"),
    realizedUsd: "0",
    firstAt: 0,
  };
  zeroGas.wallet.solana.native = "0";
  const withoutPosition = structuredClone(zeroGas);
  withoutPosition.positions = {};
  assert.equal(
    liquidationValue(zeroGas),
    liquidationValue(withoutPosition),
    "zero gas cannot be financed by a sale that has not executed",
  );
});

test("pending bridge is zero-valued at the fixed final deadline and retains its evidence", () => {
  let w = createWorld(config);
  w = applyCommand(w, {
    id: "late-bridge",
    type: "bridge",
    from: "solana",
    to: "base",
    amount: atoms("200"),
    note: "桥在途边界",
  }).world;
  w = stepWorld(w, 2);
  assert.equal(w.bridges.length, 1);
  w.bridges[0].dueAt = w.now + 1000;
  const report = settleWorld(w).report!;
  assert.equal(report.residual, 1);
  assert.ok(report.final < report.initial - 150);
});

test("same-seed attempts have distinct run identity but the same exogenous economy", () => {
  const one = createWorld({ ...config, runId: "attempt-one" }),
    two = createWorld({ ...config, runId: "attempt-two" });
  assert.notEqual(one.id, two.id);
  assert.deepEqual(
    one.tokens.map((t) => t.pool),
    two.tokens.map((t) => t.pool),
  );
  assert.deepEqual(
    one.tokens.map((t) => t.latent),
    two.tokens.map((t) => t.latent),
  );
  assert.deepEqual(one.wallet, two.wallet);
  const progressed = stepWorld(one, 90),
    restored = JSON.parse(JSON.stringify(progressed)) as World;
  assert.deepEqual(stepWorld(progressed, 90), stepWorld(restored, 90));
});

test("market variants change actual liquidity, fees, gas and confirmation timing", () => {
  const standard = createWorld({ ...config, marketVariant: "standard" }),
    thin = createWorld({ ...config, marketVariant: "thin" }),
    busy = createWorld({ ...config, marketVariant: "busy" }),
    costly = createWorld({ ...config, marketVariant: "costly" });
  const index = standard.tokens.findIndex((t) => t.pool.kind === "curve");
  assert.ok(
    Math.abs(
      units(thin.tokens[index].pool.targetQuote) / units(standard.tokens[index].pool.targetQuote) -
        0.4,
    ) < 0.00001,
  );
  const t = standard.tokens.find((t) => t.chain === "solana" && t.pool.kind === "cpmm")!,
    amount = atoms("0.02");
  const id = t.id,
    q = quoteTrade(standard, id, "buy", amount),
    b = quoteTrade(busy, id, "buy", amount),
    c = quoteTrade(costly, id, "buy", amount);
  assert.equal(BigInt(b.gas), BigInt(q.gas) * 2n);
  assert.equal(BigInt(c.gas), (BigInt(q.gas) * 3n) / 2n);
  assert.equal(costly.tokens.find((token) => token.id === id)!.pool.feeBps, t.pool.feeBps * 2);
  const command = {
    id: "variant-buy",
    type: "buy" as const,
    tokenId: id,
    amount,
    minOut: "0",
    note: "比较同输入执行环境",
  };
  const aTx = applyCommand(standard, command).world.transactions.at(-1)!;
  const bTx = applyCommand(busy, command).world.transactions.at(-1)!;
  assert.equal(bTx.executeAt - bTx.submittedAt, 3 * (aTx.executeAt - aTx.submittedAt));
  assert.equal(settleWorld(costly).report?.marketVariant, "costly");
});

test("a queued order expires before a late block without paying execution gas", () => {
  const w = createWorld({ ...config, marketVariant: "busy" }),
    t = w.tokens.find((t) => t.chain === "solana" && t.pool.kind === "cpmm")!,
    before = w.wallet.solana.native;
  const cmd = {
    id: "expires-before-block",
    type: "buy" as const,
    tokenId: t.id,
    amount: atoms("0.01"),
    minOut: "0",
    deadline: 1,
    note: "短截止等待区块",
  };
  const queued = applyCommand(w, cmd);
  assert.ok(queued.ok);
  const after = stepWorld(queued.world, 4),
    tx = after.transactions.find((tx) => tx.id === cmd.id)!;
  assert.equal(tx.status, "expired");
  assert.equal(tx.feeUsd, undefined);
  assert.equal(after.wallet.solana.native, before);
  assert.equal(after.positions[t.id], undefined);
  assert.equal(after.events.filter((e) => e.type === "order_expired").length, 1);
  assert.deepEqual(applyCommand(after, cmd).world, after);
  for (const deadline of [0, 3601, NaN])
    assert.equal(
      applyCommand(w, { ...cmd, id: `invalid-deadline-${String(deadline)}`, deadline }).ok,
      false,
    );
});

test("free-world continuation preserves identity, balances and evidence with a seven-day bound", () => {
  let w = stepWorld(createWorld({ ...config, duration: 86400 }), 20);
  const before = structuredClone(w),
    result = applyCommand(w, { id: "extend-day-2", type: "extend" });
  assert.ok(result.ok);
  w = result.world;
  assert.equal(w.config.duration, 172800);
  assert.equal(w.id, before.id);
  assert.equal(w.now, before.now);
  assert.deepEqual(w.wallet, before.wallet);
  assert.deepEqual(w.positions, before.positions);
  assert.deepEqual(w.riskEvidence, before.riskEvidence);
  assert.deepEqual(w.tokens, before.tokens);
  assert.deepEqual(applyCommand(w, { id: "extend-day-2", type: "extend" }).world, w);
  for (let day = 3; day <= 7; day++)
    w = applyCommand(w, { id: `extend-day-${day}`, type: "extend" }).world;
  assert.equal(w.config.duration, 86400 * 7);
  assert.equal(applyCommand(w, { id: "extend-day-8", type: "extend" }).ok, false);
  assert.equal(
    applyCommand(createWorld({ ...config, mode: "exam" }), { id: "exam-extension", type: "extend" })
      .ok,
    false,
  );
  assert.equal(
    applyCommand(settleWorld(before), { id: "ended-extension", type: "extend" }).ok,
    false,
  );
});

test("mixed partial entries, exit, migration, bridge and authorized rug conserve every ledger", () => {
  let w = createWorld({ ...config, spawnPerMinute: 0.1 });
  const native = nativeTotals(w),
    stable = stableTotal(w);
  for (const p of w.participants.filter((p) => !p.id.startsWith("creator-")))
    for (const c of CHAINS) {
      w.treasury[c.id].native = (
        BigInt(w.treasury[c.id].native) + BigInt(p.balances[c.id])
      ).toString();
      p.balances[c.id] = "0";
    }
  for (const t of w.tokens) t.latent.intent = "honest";
  const command = (cmd: Parameters<typeof applyCommand>[1], seconds = 4) => {
    const r = applyCommand(w, cmd);
    assert.ok(r.ok, r.error);
    w = stepWorld(r.world, seconds);
    assert.deepEqual(nativeTotals(w), native);
    assert.equal(stableTotal(w), stable);
    assertTokenSupplies(w);
  };
  command({
    id: "mixed-fund",
    type: "swap",
    chain: "solana",
    direction: "to_native",
    amount: atoms("100"),
    note: "留出分批交易原生币",
  });
  const t = w.tokens.find(
    (t) =>
      t.chain === "solana" &&
      t.pool.kind === "cpmm" &&
      quoteTrade(w, t.id, "buy", atoms("0.05")).ok,
  )!;
  command({
    id: "mixed-buy-1",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.05"),
    minOut: "0",
    note: "第一批观察",
  });
  const first = BigInt(w.positions[t.id].quantity);
  command({
    id: "mixed-buy-2",
    type: "buy",
    tokenId: t.id,
    amount: atoms("0.03"),
    minOut: "0",
    note: "第二批追加",
  });
  assert.ok(BigInt(w.positions[t.id].quantity) > first);
  command({
    id: "mixed-partial",
    type: "sell",
    tokenId: t.id,
    amount: (BigInt(w.positions[t.id].quantity) / 3n).toString(),
    minOut: "0",
    note: "只退出部分风险",
  });
  assert.ok(BigInt(w.positions[t.id].quantity) > 0n);
  command(
    {
      id: "mixed-bridge",
      type: "bridge",
      from: "solana",
      to: "base",
      amount: atoms("100"),
      note: "桥在途资金单独记账",
    },
    220,
  );
  assert.equal(w.bridges[0].status, "completed");
  const curve = w.tokens.find((t) => t.pool.kind === "curve" && BigInt(t.pool.quote) > 0n)!;
  curve.status = "migrating";
  curve.pool.migratedAt = w.now + 1;
  const migrationId = curve.id;
  w = stepWorld(w, 1);
  assert.equal(w.tokens.find((t) => t.id === migrationId)!.pool.kind, "cpmm");
  const rug = w.tokens.find(
    (t) => !t.pool.lpLocked && t.pool.kind === "cpmm" && BigInt(t.pool.quote) > 0n,
  )!;
  rug.latent.intent = "pull";
  rug.latent.incidentAt = w.now + 1;
  rug.latent.fired = false;
  const rugId = rug.id;
  w = stepWorld(w, 1);
  assert.ok(w.events.some((e) => e.type === "liquidity_removed" && e.tokenId === rugId));
  assert.deepEqual(nativeTotals(w), native);
  assert.equal(stableTotal(w), stable);
  assertTokenSupplies(w);
  w = settleWorld(w);
  assert.deepEqual(nativeTotals(w), native);
  assert.equal(stableTotal(w), stable);
  assertTokenSupplies(w);
  assert.ok(w.report!.fees > 0);
  assert.ok(w.report!.trades >= 3);
});
