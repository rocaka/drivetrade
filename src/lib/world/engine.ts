import { atoms, units, usd, SCALE } from "./amount.ts";
import {
  CHAINS,
  PLATFORMS,
  ENGINE_VERSION,
  MIXED_ENGINE_VERSION,
  EASTER_EGG_ASSETS,
  chainSpec,
  platformSpec,
} from "./config.ts";
import { random, pick, hash } from "./random.ts";
import { deriveIdentity } from "./identity.ts";
import {
  buildProcessReport,
  captureTradeProcess,
  classifyTokenOutcomes,
  markProcessExit,
  recordProcessFill,
  recordFailedTradingExit,
  trackProcessTriggers,
  validateTradePlan,
} from "./process.ts";
import {
  MIXED_BOOTSTRAP_SECONDS,
  mixedAttention,
  mixedBirthSchedule,
  mixedEasterEgg,
  mixedSeed,
  mixedSupply,
} from "./bootstrap.ts";
import type {
  Atom,
  Balance,
  ChainId,
  CommandResult,
  GasTopupQuote,
  Participant,
  Pool,
  Position,
  Quote,
  Side,
  Token,
  Transaction,
  World,
  WorldCommand,
  WorldConfig,
  WorldEvent,
  WorldReport,
} from "./types.ts";

const ZERO = "0";
const BPS = 10000n;
const n = (s: Atom) => BigInt(s);
const str = (v: bigint) => v.toString();
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const copy = <T>(v: T): T => structuredClone(v);
const rounded = (v: number) => Math.round(v * 1e6) / 1e6;
const a = (v: number): Atom => atoms(Math.max(0, v).toFixed(6));
const marketSeed = (w: World) =>
  w.config.generationProfile === "mixed-v1" ? mixedSeed(w.config.seed) : w.config.seed;
type InternalTx = Transaction & {
  direction?: "to_native" | "to_stable";
  stopPrice?: number;
  targetPrice?: number;
  automatic?: boolean;
};
const record = <T>(make: (id: ChainId) => T) =>
  Object.fromEntries(CHAINS.map((c) => [c.id, make(c.id)])) as Record<ChainId, T>;
function emit(w: World, type: string, message: string, extra: Partial<WorldEvent> = {}) {
  const seq = w.nextId++;
  w.events.push({ id: `${w.id}-e${seq}`, seq, at: w.now, type, message, ...extra });
}
function validAmount(v: string) {
  return /^(0|[1-9]\d*)$/.test(v) && n(v) > 0n && n(v) <= 10n ** 28n;
}
function nativeUsd(w: World, chain: ChainId, value: Atom) {
  return units(usd(value, w.fx[chain]));
}
function addTo(balance: Balance, key: keyof Balance, value: bigint) {
  balance[key] = str(n(balance[key]) + value);
}
function spend(balance: Balance, key: keyof Balance, value: bigint) {
  if (n(balance[key]) < value) throw new Error("余额不足");
  balance[key] = str(n(balance[key]) - value);
}

export function tokenPrice(token: Token): number {
  const p = token.pool;
  const x = n(p.token) + (p.kind === "curve" ? n(p.virtualToken) : 0n);
  const y = n(p.quote) + (p.kind === "curve" ? n(p.virtualQuote) : 0n);
  return x > 0n ? Number(y) / Number(x) : 0;
}

/** Pool math only: no wallets, gas, mutations, or random number consumption. */
export function poolQuote(token: Token, side: Side, amount: Atom): Quote {
  const empty: Quote = {
    ok: false,
    amountIn: amount,
    amountOut: ZERO,
    fee: ZERO,
    gas: ZERO,
    impactPct: 0,
    price: tokenPrice(token),
  };
  if (!validAmount(amount)) return { ...empty, error: "金额必须大于 0" };
  if (token.status === "migrating") return { ...empty, error: "正在迁池，请等待确认" };
  if (token.status === "dead" || token.frozen)
    return {
      ...empty,
      error: token.frozen ? "代币转账被冻结，暂时不能交易" : "没有可执行的交易池",
    };
  const p = token.pool;
  const realX = n(p.token),
    realY = n(p.quote);
  const X = realX + (p.kind === "curve" ? n(p.virtualToken) : 0n);
  const Y = realY + (p.kind === "curve" ? n(p.virtualQuote) : 0n);
  if (X <= 0n || Y <= 0n) return { ...empty, error: "池子没有流动性" };
  const feeRate = BigInt(p.feeBps),
    input = n(amount),
    lpRate = BigInt(p.kind === "cpmm" ? (p.lpFeeBps ?? 30) : 0);
  if (side === "buy") {
    const fee = (input * feeRate) / BPS,
      net = input - fee,
      retained = (net * lpRate) / BPS,
      effective = net - retained;
    if (net <= 0n) return { ...empty, error: "金额不足以支付交易费用" };
    if (p.kind === "curve" && realY + net > n(p.targetQuote))
      return { ...empty, error: "超过曲线剩余容量，请减少数量或等迁池后重试" };
    const out = (X * effective) / (Y + effective);
    if (out <= 0n || out > realX) return { ...empty, error: "曲线可售库存不足" };
    const ideal = (Number(input) / Number(X > 0n ? Y : 1n)) * Number(X);
    return {
      ...empty,
      ok: true,
      amountOut: str(out),
      fee: str(fee + retained),
      externalFee: str(fee),
      retainedFee: str(retained),
      impactPct: Math.max(0, (1 - Number(out) / ideal) * 100),
    };
  }
  const retained = (input * lpRate) / BPS,
    effective = input - retained;
  const gross = (Y * effective) / (X + effective);
  if (gross <= 0n || gross > realY)
    return { ...empty, error: "真实金库不足，虚拟储备不能用于提现" };
  const fee = (gross * feeRate) / BPS;
  const tax = (gross * BigInt(token.sellTaxBps)) / BPS;
  const out = gross - fee - tax;
  if (out <= 0n) return { ...empty, error: "卖出税费吞掉了全部回款" };
  const ideal = (Number(input) * Number(Y)) / Number(X);
  const retainedNative = (retained * Y) / X;
  return {
    ...empty,
    ok: true,
    amountOut: str(out),
    fee: str(fee + tax + retainedNative),
    externalFee: str(fee + tax),
    retainedFee: str(retained),
    impactPct: Math.max(0, (1 - Number(out) / ideal) * 100),
  };
}

export function quoteTrade(w: World, tokenId: string, side: Side, amount: Atom): Quote {
  const token = w.tokens.find((t) => t.id === tokenId);
  if (!token)
    return {
      ok: false,
      error: "找不到这个代币",
      amountIn: amount,
      amountOut: ZERO,
      fee: ZERO,
      gas: ZERO,
      impactPct: 0,
      price: 0,
    };
  const q = poolQuote(token, side, amount);
  return { ...q, gas: gasFor(w, token.chain) };
}
export function transactionGas(w: World, chain: ChainId): Atom {
  const multiplier = w.config.regime === "stress" ? 3n : 1n;
  const variant = w.config.marketVariant ?? "standard";
  const base =
    w.config.assessmentVersion === "process-v2-trading"
      ? { solana: 50n, bnb: 20n, base: 4n }[chain]
      : n(chainSpec(chain).gas);
  return str((base * multiplier * (variant === "busy" ? 4n : variant === "costly" ? 3n : 2n)) / 2n);
}
export function gasFor(w: World, chain: ChainId): Atom {
  return transactionGas(w, chain);
}
/** Explicit teaching service: same-chain stable pays service fee and bank-sponsored gas. */
export function quoteGasTopup(w: World, chain: ChainId, amount: Atom): GasTopupQuote {
  const empty: GasTopupQuote = {
    ok: false,
    amountUsd: amount,
    nativeOut: ZERO,
    serviceFeeUsd: ZERO,
    gasNative: ZERO,
    gasUsd: ZERO,
    totalFeeUsd: ZERO,
  };
  if (!CHAINS.some((item) => item.id === chain)) return { ...empty, error: "不支持的补 gas 链" };
  if (!validAmount(amount)) return { ...empty, error: "请输入有效的稳定资产总额" };
  const gross = n(amount),
    calculatedFee = (gross * 50n) / BPS,
    serviceFee = calculatedFee > 20000n ? calculatedFee : 20000n;
  const gas = gasFor(w, chain),
    gasUsd = usd(gas, w.fx[chain]),
    totalFee = serviceFee + n(gasUsd);
  const quoted = {
    ...empty,
    serviceFeeUsd: str(serviceFee),
    gasNative: gas,
    gasUsd,
    totalFeeUsd: str(totalFee),
  };
  if (gross <= totalFee) return { ...quoted, error: "稳定资产总额不足以覆盖服务费和链费" };
  const fx = n(a(w.fx[chain]));
  if (fx <= 0n) return { ...quoted, error: "当前模拟汇率无效" };
  const out = ((gross - totalFee) * SCALE) / fx;
  if (out <= 0n) return { ...quoted, error: "扣费后不足一个原生币教学精度单位" };
  const result = { ...quoted, nativeOut: str(out) };
  if (n(w.wallet[chain].stable) < gross) return { ...result, error: "本链稳定资产余额不足" };
  if (n(w.bank[chain].native) < out + n(gas))
    return { ...result, error: "补 gas 服务储备不足，未提供免费垫付" };
  return { ...result, ok: true };
}
function executionDelay(w: World, chain: ChainId) {
  return chainSpec(chain).blockSeconds * (w.config.marketVariant === "busy" ? 3 : 1);
}

function movePool(w: World, token: Token, side: Side, amount: Atom, q: Quote) {
  const p = token.pool;
  const external = n(q.externalFee ?? q.fee);
  if (side === "buy") {
    p.token = str(n(p.token) - n(q.amountOut));
    p.quote = str(n(p.quote) + n(amount) - external);
  } else {
    p.token = str(n(p.token) + n(amount));
    p.quote = str(n(p.quote) - n(q.amountOut) - external);
  }
  // Platform and applicable tax fees leave the pool; input-side LP fee remains in reserves.
  addTo(w.treasury[token.chain], "native", external);
  token.trades++;
  token.lastTradeAt = w.now;
  if (token.status === "dormant") token.status = p.kind === "curve" ? "curve" : "pool";
  token.volume += nativeUsd(
    w,
    token.chain,
    side === "buy" ? amount : str(n(q.amountOut) + external),
  );
  token.peakPrice = Math.max(token.peakPrice, tokenPrice(token));
  if (p.kind === "curve" && n(p.quote) >= (n(p.targetQuote) * 995n) / 1000n) {
    token.status = "migrating";
    p.migratedAt = w.now + chainSpec(token.chain).blockSeconds * 3;
    emit(w, "migration_pending", `${token.symbol} 曲线完成，进入迁池队列`, {
      tokenId: token.id,
      chain: token.chain,
    });
  }
}

function migrate(w: World, token: Token) {
  if (
    token.pool.kind !== "curve" ||
    token.status !== "migrating" ||
    !token.pool.migratedAt ||
    token.pool.migratedAt > w.now
  )
    return;
  const p = token.pool,
    realQuote = n(p.quote),
    realToken = n(p.token);
  const X = realToken + n(p.virtualToken),
    Y = realQuote + n(p.virtualQuote);
  if (realQuote <= 0n || Y <= 0n) {
    token.status = "dormant";
    return;
  }
  // Use only real quote; match the last marginal price using real token inventory.
  const migrationTokens = min(realToken, (realQuote * X) / Y);
  if (migrationTokens <= 0n) {
    token.status = "dormant";
    return;
  }
  w.lockedTokens[token.id] = str(n(w.lockedTokens[token.id] ?? ZERO) + realToken - migrationTokens);
  p.token = str(migrationTokens);
  p.virtualToken = ZERO;
  p.virtualQuote = ZERO;
  p.kind = "cpmm";
  p.feeBps = platformSpec(token.platformId).feeBps * (w.config.marketVariant === "costly" ? 2 : 1);
  p.lpFeeBps = 30;
  token.status = "pool";
  emit(
    w,
    "migrated",
    `${token.symbol} 已迁入教学 CPMM，${p.lpLocked ? "LP 锁定或销毁" : "LP 仍由创建者控制"}`,
    { tokenId: token.id, chain: token.chain },
  );
}

function spawnToken(w: World, index: number) {
  const seed = marketSeed(w);
  const mixed = w.config.generationProfile === "mixed-v1";
  const easterEgg = mixed ? EASTER_EGG_ASSETS[index] : undefined;
  const chain = easterEgg?.chain ?? CHAINS[index % CHAINS.length].id;
  const available = PLATFORMS.filter((p) => p.chain === chain || p.chain === "all");
  const platform = easterEgg
    ? platformSpec("open-market")
    : index < 6
      ? available[Math.floor(index / 3) % available.length]
      : pick(available, seed, "platform", index);
  const identity = deriveIdentity(w.config.seed, index);
  const id = `${w.id}-t${index}`;
  const liquidityScale = w.config.marketVariant === "thin" ? 0.4 : 1;
  const eggAllocation = easterEgg
    ? mixedEasterEgg(w.config.seed, index, w.fx[chain], liquidityScale)
    : undefined;
  const allocation = eggAllocation ?? (mixed ? mixedSupply(w.config.seed, index) : undefined);
  const supply = allocation?.supply ?? atoms("1000000000");
  const realToken = allocation?.poolTokens ?? atoms("700000000");
  const creatorTokens = allocation?.creatorTokens ?? atoms("100000000");
  const mixedLiquidity =
    Math.pow(10, 2 + random(seed, "launch-liquidity", index) * 2.3) * liquidityScale;
  const virtualQuote = a(
    (mixed ? mixedLiquidity : (200 + random(seed, "virtual", index) * 1000) * liquidityScale) /
      w.fx[chain],
  );
  const directQuote =
    eggAllocation?.quote ??
    (platform.mechanism === "direct"
      ? a(
          (mixed
            ? mixedLiquidity
            : (100 + random(seed, "seed-liquidity", index) * 400) * liquidityScale) / w.fx[chain],
        )
      : ZERO);
  if (n(w.treasury[chain].native) < n(directQuote)) return;
  w.lockedTokens[id] = allocation?.lockedTokens ?? atoms("200000000");
  spend(w.treasury[chain], "native", n(directQuote));
  const creatorId = `creator-${index % 24}`;
  if (!w.participants.some((p) => p.id === creatorId))
    w.participants.push({
      id: creatorId,
      style: "whale",
      balances: record(() => ZERO),
      tokens: {},
    });
  const creator = w.participants.find((p) => p.id === creatorId)!;
  const creationFund = n(a(easterEgg ? 0 : 0.1));
  if (n(w.treasury[chain].native) >= creationFund) {
    spend(w.treasury[chain], "native", creationFund);
    creator.balances[chain] = str(n(creator.balances[chain]) + creationFund);
  }
  const canPull = !platform.lockedLp;
  const roll = random(seed, "intent", index);
  let intent: Token["latent"]["intent"] = "honest";
  if (!easterEgg) {
    if (roll < 0.18) intent = "dump";
    else if (roll < 0.25 && canPull) intent = "pull";
    else if (roll < 0.31 && platform.allowFreeze) intent = "freeze";
    else if (roll < 0.37 && platform.allowTax) intent = "tax";
    else if (roll < 0.42 && platform.allowMint) intent = "mint";
  }
  const t: Token = {
    id,
    chain,
    platformId: platform.id,
    name: easterEgg?.name ?? identity.name,
    symbol: easterEgg?.symbol ?? identity.symbol,
    address: `SIM:${chain}:${hash(`${seed}:${index}`).toString(16).padStart(8, "0")}`,
    narrative: easterEgg
      ? "彩蛋资产：教学链上的虚构模拟映射；价格与供应是 seeded 游戏设定，非实时行情，也不代表真实资产。"
      : identity.narrative,
    ...(easterEgg ? { easterEgg: easterEgg.id } : {}),
    bornAt: w.now,
    supply,
    creatorId,
    creatorTokens,
    pool: {
      kind: platform.mechanism === "curve" ? "curve" : "cpmm",
      token: realToken,
      quote: directQuote,
      virtualToken: platform.mechanism === "curve" ? creatorTokens : ZERO,
      virtualQuote: platform.mechanism === "curve" ? virtualQuote : ZERO,
      targetQuote: a(
        (mixed
          ? mixedLiquidity * (1.5 + random(seed, "launch-target", index) * 2.5)
          : (400 + random(seed, "target", index) * 1200) * liquidityScale) / w.fx[chain],
      ),
      feeBps: platform.feeBps * (w.config.marketVariant === "costly" ? 2 : 1),
      lpFeeBps: platform.mechanism === "direct" ? 30 : 0,
      lpLocked: easterEgg ? true : platform.lockedLp,
    },
    status: platform.mechanism === "curve" ? "curve" : "pool",
    holders: easterEgg ? 0 : 1,
    volume: 0,
    mintAuthority: !easterEgg && platform.allowMint && random(seed, "mint-right", index) < 0.7,
    freezeAuthority:
      !easterEgg && platform.allowFreeze && random(seed, "freeze-right", index) < 0.7,
    taxMutable: !easterEgg && platform.allowTax && random(seed, "tax-right", index) < 0.7,
    sellTaxBps: 0,
    frozen: false,
    history: [],
    initialPrice: 0,
    peakPrice: 0,
    trades: 0,
    latent: {
      intent,
      incidentAt: w.now + 180 + Math.floor(random(seed, "incident", index) * 1800),
      fired: false,
      appeal: easterEgg
        ? 0.75 + random(seed, "appeal", index) * 0.25
        : 0.15 + random(seed, "appeal", index) * 0.85,
      momentum: random(seed, "momentum", index),
    },
  };
  if (intent === "mint" && !t.mintAuthority) t.latent.intent = "dump";
  if (intent === "freeze" && !t.freezeAuthority) t.latent.intent = "dump";
  if (intent === "tax" && !t.taxMutable) t.latent.intent = "dump";
  t.initialPrice = tokenPrice(t);
  t.peakPrice = t.initialPrice;
  t.history.push({ t: w.now, price: t.initialPrice, volume: 0 });
  w.tokens.push(t);
  emit(w, "token_born", `${t.symbol} 在${platform.name}发射`, { tokenId: id, chain });
}

function npcTrade(w: World, npc: Participant, token: Token, side: Side, amount: Atom) {
  if (side === "buy" && token.pool.kind === "curve") {
    const capacity = n(token.pool.targetQuote) - n(token.pool.quote);
    const grossCapacity = (capacity * BPS) / (BPS - BigInt(token.pool.feeBps));
    if (n(amount) > grossCapacity) amount = str(grossCapacity);
  }
  const q = poolQuote(token, side, amount);
  if (!q.ok) return;
  const chain = token.chain,
    gas = n(gasFor(w, chain));
  const balance = n(npc.balances[chain]);
  if (side === "buy") {
    if (balance < n(amount) + gas) return;
    npc.balances[chain] = str(balance - n(amount) - gas);
    npc.tokens[token.id] = str(n(npc.tokens[token.id] ?? ZERO) + n(q.amountOut));
  } else {
    if (n(npc.tokens[token.id] ?? ZERO) < n(amount) || balance < gas) return;
    npc.tokens[token.id] = str(n(npc.tokens[token.id]) - n(amount));
    npc.balances[chain] = str(balance - gas + n(q.amountOut));
  }
  w.burnt[chain] = str(n(w.burnt[chain]) + gas);
  movePool(w, token, side, amount, q);
}

function background(w: World) {
  const seed = marketSeed(w);
  const mixed = w.config.generationProfile === "mixed-v1";
  const active = w.tokens.filter((t) => t.status !== "dead" && t.status !== "migrating");
  if (!active.length) return;
  const ordinary = w.participants.filter((p) => !p.id.startsWith("creator-"));
  const attention = mixed
    ? new Map(
        active.map((t) => [
          t.id,
          t.easterEgg ? 1 : mixedAttention(w.config.seed, t.address, w.now - t.bornAt),
        ]),
      )
    : undefined;
  const activity = w.config.regime === "inflow" ? 4 : w.config.regime === "outflow" ? 2 : 3;
  for (let j = 0; j < activity; j++) {
    const index = `${w.now}:${j}`;
    const npc = pick(ordinary, seed, "npc", index);
    // Attention stays finite: younger active projects compete for the same wallets.
    const recent = active.slice(-160);
    const candidates = mixed
      ? [...active.filter((t) => t.easterEgg && !recent.includes(t)), ...recent]
      : recent;
    const owned = active.filter((t) => n(npc.tokens[t.id] ?? ZERO) > 0n);
    const bias = w.config.regime === "inflow" ? 0.68 : w.config.regime === "outflow" ? 0.28 : 0.5;
    const selling = owned.length > 0 && random(seed, "portfolio-exit", index) > bias;
    // Sell from actual inventory instead of almost never revisiting a randomly selected old asset.
    // Buy-side attention competes over three sampled projects; latent appeal is noisy, not a price oracle.
    const shortlist = [0, 1, 2].map((k) => pick(candidates, seed, `attention-${k}`, index));
    const t = selling
      ? pick(owned, seed, "exit-attention", index)
      : shortlist.reduce((best, item) =>
          item.latent.appeal *
            (attention?.get(item.id) ?? 1) *
            (0.5 + random(seed, "interest-noise", `${index}:${item.address}`)) >
          best.latent.appeal *
            (attention?.get(best.id) ?? 1) *
            (0.5 + random(seed, "interest-noise", `${index}:${best.address}`))
            ? item
            : best,
        );
    if (mixed && random(seed, "attention-return", index) > (attention?.get(t.id) ?? 1)) continue;
    const held = n(npc.tokens[t.id] ?? ZERO);
    const age = w.now - t.bornAt;
    const trend = t.initialPrice > 0 ? tokenPrice(t) / t.initialPrice : 1;
    const buyChance = Math.max(
      0.08,
      Math.min(
        0.88,
        bias +
          (t.latent.appeal - 0.5) * 0.2 -
          (age > 1800 ? 0.2 : 0) +
          (npc.style === "momentum" && trend > 1.4 ? 0.08 : 0),
      ),
    );
    if (held > 0n && (selling || random(seed, "npc-side", index) > buyChance)) {
      const fraction = 20n + BigInt(Math.floor(random(seed, "npc-sell-size", index) * 61));
      npcTrade(w, npc, t, "sell", str((held * fraction) / 100n));
    } else if (random(seed, "npc-participation", index) < t.latent.appeal) {
      const spendUsd =
        (npc.style === "whale" ? 50 : 3) +
        random(seed, "npc-size", index) * (npc.style === "whale" ? 150 : 30);
      npcTrade(w, npc, t, "buy", a(spendUsd / w.fx[t.chain]));
    }
  }
}

function incidents(w: World) {
  for (const t of w.tokens) {
    migrate(w, t);
    if (t.latent.fired || t.latent.intent === "honest" || w.now < t.latent.incidentAt) continue;
    if (t.status === "migrating") continue;
    t.latent.fired = true;
    const p = t.pool,
      spec = platformSpec(t.platformId),
      creator = w.participants.find((x) => x.id === t.creatorId)!;
    if (t.latent.intent === "pull" && !p.lpLocked && !spec.lockedLp && n(p.quote) > 0n) {
      const before = p.quote;
      const withdrawn = (n(p.quote) * 95n) / 100n;
      p.quote = str(n(p.quote) - withdrawn);
      creator.balances[t.chain] = str(n(creator.balances[t.chain]) + withdrawn);
      const tokenWithdraw = (n(p.token) * 95n) / 100n;
      p.token = str(n(p.token) - tokenWithdraw);
      t.creatorTokens = str(n(t.creatorTokens) + tokenWithdraw);
      emit(w, "liquidity_removed", `${t.symbol} 可撤 LP 被创建者取回，退出深度骤降`, {
        tokenId: t.id,
        chain: t.chain,
        ...(w.config.assessmentVersion
          ? { effect: { field: "pool_quote" as const, before, after: p.quote } }
          : {}),
      });
    } else if (t.latent.intent === "freeze" && spec.allowFreeze && t.freezeAuthority) {
      t.frozen = true;
      emit(w, "permission_used", `${t.symbol} 冻结权限已被启用，卖出受阻`, {
        tokenId: t.id,
        chain: t.chain,
        ...(w.config.assessmentVersion
          ? { effect: { field: "frozen" as const, before: "0", after: "1" } }
          : {}),
      });
    } else if (t.latent.intent === "tax" && spec.allowTax && t.taxMutable) {
      const before = String(t.sellTaxBps);
      t.sellTaxBps = 9500;
      emit(w, "tax_changed", `${t.symbol} 卖出税变为 95%`, {
        tokenId: t.id,
        chain: t.chain,
        ...(w.config.assessmentVersion
          ? { effect: { field: "sell_tax_bps" as const, before, after: "9500" } }
          : {}),
      });
    } else if (t.latent.intent === "mint" && spec.allowMint && t.mintAuthority) {
      const before = t.supply;
      const minted = n(t.supply) / 2n;
      t.supply = str(n(t.supply) + minted);
      t.creatorTokens = str(n(t.creatorTokens) + minted);
      emit(w, "supply_changed", `${t.symbol} 有效铸币权限被使用，供应增加 50%`, {
        tokenId: t.id,
        chain: t.chain,
        ...(w.config.assessmentVersion
          ? { effect: { field: "supply" as const, before, after: t.supply } }
          : {}),
      });
      creatorDump(w, t, creator);
    } else {
      creatorDump(w, t, creator);
    }
  }
}
function creatorDump(w: World, t: Token, creator: Participant) {
  const before = t.creatorTokens;
  const amount = str((n(t.creatorTokens) * 80n) / 100n),
    q = poolQuote(t, "sell", amount);
  const gas = n(gasFor(w, t.chain));
  if (!q.ok || n(creator.balances[t.chain]) < gas) return;
  t.creatorTokens = str(n(t.creatorTokens) - n(amount));
  creator.balances[t.chain] = str(n(creator.balances[t.chain]) + n(q.amountOut) - gas);
  w.burnt[t.chain] = str(n(w.burnt[t.chain]) + gas);
  movePool(w, t, "sell", amount, q);
  emit(w, "large_holder_sell", `${t.symbol} 创建者大额卖出；锁 LP 并不能阻止持币人抛售`, {
    tokenId: t.id,
    chain: t.chain,
    ...(w.config.assessmentVersion
      ? { effect: { field: "creator_tokens" as const, before, after: t.creatorTokens } }
      : {}),
  });
}

function baselineValue(w: World): number {
  return CHAINS.reduce(
    (sum, c) =>
      sum + units(w.initialWallet[c.id].stable) + nativeUsd(w, c.id, w.initialWallet[c.id].native),
    0,
  );
}
function walletValue(w: World) {
  return CHAINS.reduce(
    (sum, c) => sum + units(w.wallet[c.id].stable) + nativeUsd(w, c.id, w.wallet[c.id].native),
    0,
  );
}

/** Executable liquidation; clone pool state so multiple routes never reuse imaginary reserves. */
export function liquidationValue(w: World): number {
  const wallet = copy(w.wallet);
  const scratch = copy(w.tokens.filter((t) => n(w.positions[t.id]?.quantity ?? ZERO) > 0n));
  for (const id of Object.keys(w.positions).sort()) {
    const p = w.positions[id],
      t = scratch.find((x) => x.id === id);
    if (!t || n(p.quantity) <= 0n) continue;
    const gas = n(gasFor(w, t.chain));
    if (n(wallet[t.chain].native) < gas) continue;
    const q = poolQuote(t, "sell", p.quantity);
    if (!q.ok) continue;
    // Do not pay more gas than this holding can return; retain its zero recoverable tail.
    if (n(q.amountOut) <= gas) continue;
    spend(wallet[t.chain], "native", gas);
    addTo(wallet[t.chain], "native", n(q.amountOut));
    if (t.pool.quote !== ZERO) {
      t.pool.quote = str(n(t.pool.quote) - n(q.amountOut) - n(q.externalFee ?? q.fee));
      t.pool.token = str(n(t.pool.token) + n(p.quantity));
    }
  }
  let value = CHAINS.reduce(
    (sum, c) => sum + units(wallet[c.id].stable) + nativeUsd(w, c.id, wallet[c.id].native),
    0,
  );
  for (const b of w.bridges) if (b.status === "in_transit") value += units(b.amount);
  return rounded(value);
}

function sampleEquity(w: World) {
  const equity = liquidationValue(w);
  w.highWater = Math.max(w.highWater, equity);
  const dd = w.highWater > 0 ? ((w.highWater - equity) / w.highWater) * 100 : 0;
  w.maxDrawdownPct = Math.max(w.maxDrawdownPct, dd);
  if (w.now % 86400 === 0) {
    w.dayStartEquity = equity;
    w.stopUntil = 0;
  }
  if (w.config.protection && equity < w.dayStartEquity * 0.97 && w.stopUntil <= w.now) {
    w.stopUntil = (Math.floor(w.now / 86400) + 1) * 86400;
    emit(w, "daily_stop", "达到本场 3% 日停止线；只允许减险，暂停到下个模拟日");
  }
  if (w.now % 15 === 0 || w.phase === "completed") {
    w.equity.push({ t: w.now, equity, baseline: rounded(baselineValue(w)) });
    if (w.equity.length > 6000) w.equity.splice(1, w.equity.length - 6000);
  }
}

export function createWorld(config: WorldConfig): World {
  if (config.generationProfile !== undefined && config.generationProfile !== "mixed-v1")
    throw new Error("不支持的市场生成版本");
  if (
    config.assessmentVersion !== undefined &&
    config.assessmentVersion !== "process-v1" &&
    config.assessmentVersion !== "process-v2-trading"
  )
    throw new Error("不支持的过程评分版本");
  if (
    config.generationProfile === "mixed-v1" &&
    config.mode !== "free" &&
    config.assessmentVersion !== "process-v1" &&
    config.assessmentVersion !== "process-v2-trading"
  )
    throw new Error("混合市场生成仅用于自由练习；考核保持原生成版本");
  const clean: WorldConfig = {
    ...config,
    seed: String(config.seed || "training-world").slice(0, 120),
    marketVariant: config.marketVariant ?? "standard",
    duration:
      config.mode === "exam"
        ? 7200
        : Math.max(120, Math.min(86400 * 7, Math.floor(config.duration || 7200))),
    spawnPerMinute: Math.max(0.1, Math.min(12, config.spawnPerMinute || 6)),
    protection: config.mode === "exam" ? true : config.protection,
  };
  const fx = record((id) => chainSpec(id).initialUsd);
  const wallet = record<Balance>((id) => ({
    native: a(100 / fx[id]),
    stable: atoms(id === "base" ? "3233.333334" : "3233.333333"),
  }));
  const w: World = {
    version: 1,
    engineVersion: clean.generationProfile === "mixed-v1" ? MIXED_ENGINE_VERSION : ENGINE_VERSION,
    id: `world-${hash(clean.seed).toString(16)}${clean.generationProfile === "mixed-v1" ? "-mixed-v1" : ""}${clean.assessmentVersion === "process-v2-trading" ? "-trading-v2" : ""}${clean.runId ? `-${hash(clean.runId).toString(16)}` : ""}`,
    config: clean,
    now: -120,
    nextId: 1,
    phase: "running",
    tokens: [],
    wallet,
    initialWallet: copy(wallet),
    fx,
    initialFx: copy(fx),
    positions: {},
    participants: [],
    treasury: record(() => ({ native: atoms("10000"), stable: atoms("1000000") })),
    bank: record(() => ({ native: atoms("100000"), stable: atoms("10000000") })),
    burnt: record(() => ZERO),
    lockedTokens: {},
    transactions: [],
    bridges: [],
    events: [],
    riskEvidence: [],
    equity: [],
    feesUsd: 0,
    initialEquity: 10000,
    highWater: 10000,
    maxDrawdownPct: 0,
    realizedUsd: ZERO,
    processedCommands: [],
    stopUntil: 0,
    dayStartEquity: 10000,
  };
  for (let i = 0; i < 90; i++)
    w.participants.push({
      id: `npc-${i}`,
      style: (["community", "momentum", "whale", "noise"] as const)[i % 4],
      balances: record((id) => a((i % 4 === 2 ? 25000 : 5000) / fx[id])),
      tokens: {},
    });
  if (clean.generationProfile === "mixed-v1") {
    const births = mixedBirthSchedule(clean.seed);
    let index = 0;
    for (let at = -MIXED_BOOTSTRAP_SECONDS; at <= 0; at++) {
      w.now = at;
      fxTick(w);
      incidents(w);
      while (index < births.length && births[index] === at) spawnToken(w, index++);
      background(w);
      if (at % 15 === 0) history(w);
    }
    // The player arrives now: fund the advertised entry budget using bank transfers.
    // NPC history, pool reserves, fee receipts and burned gas remain untouched.
    for (const c of CHAINS) {
      const b = w.wallet[c.id];
      const native = a(100 / w.fx[c.id]);
      const stable = str(
        n(atoms(c.id === "base" ? "3333.333334" : "3333.333333")) - n(usd(native, w.fx[c.id])),
      );
      for (const key of ["native", "stable"] as const) {
        const target = key === "native" ? native : stable;
        addTo(w.bank[c.id], key, n(b[key]) - n(target));
        b[key] = target;
      }
    }
    w.initialWallet = copy(w.wallet);
    w.initialFx = copy(w.fx);
  } else {
    for (let i = 0; i < 36; i++) spawnToken(w, i);
    for (let i = -119; i <= 0; i++) {
      w.now = i;
      background(w);
      if (i % 15 === 0) history(w);
    }
  }
  w.now = 0;
  w.initialEquity = rounded(walletValue(w));
  w.highWater = w.initialEquity;
  w.dayStartEquity = w.initialEquity;
  w.equity = [{ t: 0, equity: liquidationValue(w), baseline: rounded(baselineValue(w)) }];
  emit(
    w,
    "world_started",
    "三条教学链已开市。行情由有限资金和池子交易形成，所有资产均为虚构模拟。",
  );
  return w;
}

function history(w: World) {
  for (const t of w.tokens) {
    const point = { t: w.now, price: tokenPrice(t), volume: rounded(t.volume) };
    if (t.history.at(-1)?.t === w.now) t.history[t.history.length - 1] = point;
    else t.history.push(point);
    if (t.history.length > 240) t.history.splice(0, t.history.length - 240);
    t.holders =
      (n(t.creatorTokens) > 0n ? 1 : 0) +
      w.participants.filter((p) => n(p.tokens[t.id] ?? ZERO) > 0n).length +
      (n(w.positions[t.id]?.quantity ?? ZERO) > 0n ? 1 : 0);
    if (
      t.status !== "migrating" &&
      t.status !== "dead" &&
      w.now - (t.lastTradeAt ?? t.bornAt) > 1200
    )
      t.status = "dormant";
    if (t.pool.kind === "cpmm" && n(t.pool.quote) === 0n && t.status !== "dead") {
      t.status = "dead";
      emit(w, "pool_exhausted", `${t.symbol} 真实报价储备耗尽；保留历史与残余持仓`, {
        tokenId: t.id,
        chain: t.chain,
      });
    }
  }
}

function violation(w: World, id: string, code: string, message: string) {
  w.riskEvidence.push({ at: w.now, commandId: id, code, message });
  emit(w, "risk_violation", message, { commandId: id, violation: true });
}
export function riskCheck(w: World, t: Token, amount: Atom, id = "preview"): string | null {
  if (!w.config.protection) return null;
  const equity = Math.max(1, liquidationValue(w));
  if (w.stopUntil > w.now) return "本模拟日已达到停止线，请等待或只做退出";
  const value = nativeUsd(w, t.chain, str(n(amount) + n(gasFor(w, t.chain))));
  let existing = units(w.positions[t.id]?.costUsd ?? ZERO);
  for (const pending of w.transactions)
    if (
      pending.status === "pending" &&
      pending.type === "buy" &&
      pending.id !== id &&
      pending.tokenId === t.id
    )
      existing += nativeUsd(w, t.chain, str(n(pending.amount) + n(gasFor(w, t.chain))));
  if (value + existing > equity * 0.01 + 0.000001) return "确认投入超过本场单项目 1% 全损预算";
  let total = 0,
    cluster = 0;
  for (const p of Object.values(w.positions)) {
    total += units(p.costUsd);
    if (w.tokens.find((x) => x.id === p.tokenId)?.creatorId === t.creatorId)
      cluster += units(p.costUsd);
  }
  for (const tx of w.transactions.filter(
    (tx) => tx.status === "pending" && tx.type === "buy" && tx.id !== id,
  )) {
    const token = w.tokens.find((x) => x.id === tx.tokenId);
    if (!token) continue;
    const pending = nativeUsd(w, token.chain, str(n(tx.amount) + n(gasFor(w, token.chain))));
    total += pending;
    if (token.creatorId === t.creatorId) cluster += pending;
  }
  if (total + value > equity * 0.1 + 0.000001) return "确认投入超过总新币风险资金 10%";
  if (cluster + value > equity * 0.03 + 0.000001) return "确认投入超过同创建者项目簇 3%";
  void id;
  return null;
}

export function applyCommand(input: World, command: WorldCommand): CommandResult {
  if (input.processedCommands.includes(command.id)) return { world: input, ok: true };
  if (input.phase === "completed")
    return { world: input, ok: false, error: "本场已经结算，请创建新世界" };
  if (
    !command.id ||
    command.id.length > 180 ||
    !/^[A-Za-z0-9:_\-.]+$/.test(command.id) ||
    ["__proto__", "prototype", "constructor"].includes(command.id)
  )
    return { world: input, ok: false, error: "无效命令编号" };
  const w = copy(input);
  const reject = (error: string, save = false): CommandResult => ({
    world: save ? w : input,
    ok: false,
    error,
  });
  if (command.type === "extend") {
    if (w.config.mode !== "free" || w.phase !== "running")
      return reject("只有尚未结算的自由世界可续接，请在到期前操作");
    if (w.config.duration >= 86400 * 7)
      return reject("本地世界最多续接7个模拟日，请保留备份后开启新世界");
    w.config.duration = Math.min(86400 * 7, w.config.duration + 86400);
    w.processedCommands.push(command.id);
    emit(
      w,
      "world_extended",
      "本世界续接24模拟小时，保留资金、持仓和全部风险证据；浏览器预算最多7天",
      { commandId: command.id },
    );
    return { world: w, ok: true };
  }
  if (command.type === "abandon") {
    w.processedCommands.push(command.id);
    w.settlementStartedAt = w.now;
    for (const tx of w.transactions)
      if (tx.status === "pending") {
        tx.status = "cancelled";
        tx.result = "用户主动弃考或结束，未执行订单已取消";
      }
    emit(w, "abandoned", "用户主动放弃本场，保留全部尝试及残余资产，不计有效考核", {
      commandId: command.id,
    });
    finalize(w, false);
    return { world: w, ok: true };
  }
  if (command.type === "finish") {
    if (w.config.mode === "exam" && w.now < w.config.duration)
      return reject("正式世界不能提前结算，可暂停后继续");
    w.processedCommands.push(command.id);
    return { world: settleWorld(w), ok: true };
  }
  if (command.type === "wait") {
    const note = command.note.trim();
    if (!note) return reject("请写下等待或重评条件");
    w.processedCommands.push(command.id);
    emit(w, "wait", note.slice(0, 300), { commandId: command.id });
    return { world: w, ok: true };
  }
  if (command.type === "protect") {
    const p = w.positions[command.tokenId],
      t = w.tokens.find((x) => x.id === command.tokenId);
    if (!p || !t || n(p.quantity) <= 0n) return reject("没有可保护的持仓");
    const price = tokenPrice(t);
    if (
      command.stopPrice !== undefined &&
      (!Number.isFinite(command.stopPrice) || command.stopPrice <= 0 || command.stopPrice >= price)
    )
      return reject("止损触发参考价需在当前价格下方");
    if (
      command.targetPrice !== undefined &&
      (!Number.isFinite(command.targetPrice) || command.targetPrice <= price)
    )
      return reject("止盈触发参考价需高于当前价格");
    if (
      w.config.mode === "exam" &&
      p.stopPrice &&
      (command.stopPrice === undefined || command.stopPrice < p.stopPrice)
    ) {
      violation(w, command.id, "WIDEN_PROTECTION", "确认取消或扩大已冻结的保护风险");
      w.processedCommands.push(command.id);
      return reject("考核中不允许扩大已冻结的保护风险", true);
    }
    p.stopPrice = command.stopPrice;
    p.targetPrice = command.targetPrice;
    if (w.config.assessmentVersion === "process-v2-trading") p.protectionSource = "user";
    w.processedCommands.push(command.id);
    emit(w, "protection_set", "应用侧退出规则已保存，触发后仍可能排队或执行失败", {
      tokenId: t.id,
      chain: t.chain,
      commandId: command.id,
    });
    return { world: w, ok: true };
  }
  if (!validAmount(command.amount)) return reject("请输入有效的正数金额");
  if (command.type === "buy" || command.type === "sell") {
    const t = w.tokens.find((x) => x.id === command.tokenId);
    if (!t) return reject("找不到该代币");
    const q = quoteTrade(w, t.id, command.type, command.amount);
    if (!q.ok) return reject(q.error ?? "无法报价");
    if (!/^(0|[1-9]\d*)$/.test(command.minOut) || n(command.minOut) > 10n ** 28n)
      return reject("最少到手数量无效");
    const deadline = command.deadline ?? w.now + 120;
    if (!Number.isSafeInteger(deadline) || deadline <= w.now || deadline > w.now + 3600)
      return reject("订单有效期应为未来1至3600个模拟秒");
    if (command.type === "buy" && n(w.wallet[t.chain].native) < n(command.amount) + n(q.gas))
      return reject(`本链${chainSpec(t.chain).native}余额不足，买入还需预留 gas`);
    if (command.type === "sell" && n(w.positions[t.id]?.quantity ?? ZERO) < n(command.amount))
      return reject("卖出数量超过当前持仓");
    if (n(w.wallet[t.chain].native) < n(q.gas))
      return reject("本链原生 gas 不足，不能从其他链自动扣除");
    const trading = w.config.assessmentVersion === "process-v2-trading";
    const note =
      command.note?.trim() ||
      (trading ? (command.type === "buy" ? "自主买入（交易训练）" : "自主卖出（交易训练）") : "");
    if (!note) return reject("先写一句本次决定的理由");
    if (command.type === "buy") {
      if (w.config.assessmentVersion === "process-v1" && w.config.mode === "exam" && !command.plan)
        return reject("正式训练需在提交前冻结数值交易计划");
      if (command.plan && !validateTradePlan(command.plan, q.price))
        return reject("交易计划无效，请核对预算、失效价、目标价、持有时间和公开检查项");
      const issue = riskCheck(w, t, command.amount, command.id);
      if (issue) {
        violation(w, command.id, "EXPOSURE_BUDGET", issue);
        w.processedCommands.push(command.id);
        return reject(issue, true);
      }
      if (
        command.stopPrice !== undefined &&
        (!Number.isFinite(command.stopPrice) ||
          command.stopPrice <= 0 ||
          command.stopPrice >= q.price)
      )
        return reject("止损触发参考价应低于当前价格");
      if (
        command.targetPrice !== undefined &&
        (!Number.isFinite(command.targetPrice) || command.targetPrice <= q.price)
      )
        return reject("止盈触发参考价应高于当前价格");
    }
    if (w.phase === "settling" && command.type === "buy") return reject("结算阶段只允许减险");
    const processEvidence =
      command.type === "buy" && w.config.assessmentVersion
        ? captureTradeProcess(w, t, q, liquidationValue(w), (chain) => gasFor(w, chain))
        : undefined;
    const tx: InternalTx = {
      id: command.id,
      type: command.type,
      tokenId: t.id,
      chain: t.chain,
      amount: command.amount,
      minOut: command.minOut,
      note: note.slice(0, 300),
      submittedAt: w.now,
      executeAt: w.now + executionDelay(w, t.chain),
      deadline,
      status: "pending",
      stopPrice:
        trading && command.type === "buy" ? processEvidence?.guide?.stopPrice : command.stopPrice,
      targetPrice:
        trading && command.type === "buy"
          ? processEvidence?.guide?.targetPrice
          : command.targetPrice,
      ...(trading ? { source: "manual" as const } : {}),
      ...(command.type === "buy" && command.plan ? { plan: copy(command.plan) } : {}),
      ...(processEvidence ? { process: processEvidence } : {}),
    };
    w.transactions.push(tx);
    if (command.type === "sell") markProcessExit(w, t.id, tx.id);
    w.processedCommands.push(command.id);
    emit(
      w,
      "submitted",
      `${command.type === "buy" ? "买入" : "卖出"} ${t.symbol} 已提交，等待下一合格区块`,
      { tokenId: t.id, chain: t.chain, commandId: command.id },
    );
    return { world: w, ok: true };
  }
  if (command.type === "gas_topup") {
    if (w.phase === "settling") return reject("结算阶段不再新增补 gas 服务");
    const q = quoteGasTopup(w, command.chain, command.amount);
    if (!q.ok) return reject(q.error ?? "补 gas 服务不可用");
    w.transactions.push({
      id: command.id,
      type: "gas_topup",
      chain: command.chain,
      amount: command.amount,
      minOut: ZERO,
      note: command.note.slice(0, 300),
      submittedAt: w.now,
      executeAt: w.now + executionDelay(w, command.chain),
      status: "pending",
    });
    w.processedCommands.push(command.id);
    emit(w, "gas_topup_submitted", "已请求同链稳定资产补 gas，服务费和代付链费均在总额内扣除", {
      chain: command.chain,
      commandId: command.id,
      amountUsd: units(command.amount),
    });
    return { world: w, ok: true };
  }
  if (command.type === "swap") {
    const c = command.chain;
    if (!CHAINS.some((x) => x.id === c)) return reject("不支持的链");
    const key = command.direction === "to_native" ? "stable" : "native";
    if (n(w.wallet[c][key]) < n(command.amount)) return reject("兑换余额不足");
    if (n(w.wallet[c].native) < n(gasFor(w, c)) + (key === "native" ? n(command.amount) : 0n))
      return reject("兑换需保留本链 gas");
    const tx: InternalTx = {
      id: command.id,
      type: "swap",
      chain: c,
      amount: command.amount,
      minOut: ZERO,
      note: command.note,
      submittedAt: w.now,
      executeAt: w.now + executionDelay(w, c),
      status: "pending",
      direction: command.direction,
    };
    w.transactions.push(tx);
    w.processedCommands.push(command.id);
    return { world: w, ok: true };
  }
  if (command.type === "bridge") {
    if (command.from === command.to) return reject("请选择不同的目标链");
    if (!CHAINS.some((c) => c.id === command.from) || !CHAINS.some((c) => c.id === command.to))
      return reject("不支持的桥路线");
    if (n(w.wallet[command.from].stable) < n(command.amount)) return reject("源链稳定币余额不足");
    if (n(w.wallet[command.from].native) < n(gasFor(w, command.from)))
      return reject("源链 gas 不足");
    w.transactions.push({
      id: command.id,
      type: "bridge",
      chain: command.from,
      toChain: command.to,
      amount: command.amount,
      minOut: ZERO,
      note: command.note,
      submittedAt: w.now,
      executeAt: w.now + executionDelay(w, command.from),
      status: "pending",
    });
    w.processedCommands.push(command.id);
    return { world: w, ok: true };
  }
  return reject("不支持的命令");
}

function chargeGas(w: World, tx: Transaction): boolean {
  const gas = n(gasFor(w, tx.chain));
  if (n(w.wallet[tx.chain].native) < gas) {
    tx.status = "dropped";
    tx.result = "缺少本链 gas，未进入执行，不扣费";
    return false;
  }
  spend(w.wallet[tx.chain], "native", gas);
  w.burnt[tx.chain] = str(n(w.burnt[tx.chain]) + gas);
  const cost = nativeUsd(w, tx.chain, str(gas));
  w.feesUsd += cost;
  tx.feeUsd = cost;
  return true;
}
function failTx(w: World, tx: Transaction, message: string) {
  tx.status = "reverted";
  tx.result = message;
  recordFailedTradingExit(w, tx);
  emit(w, "reverted", `${message}；仅保留已发生链费`, {
    tokenId: tx.tokenId,
    chain: tx.chain,
    commandId: tx.id,
  });
}

function executeTx(w: World, tx: InternalTx) {
  if (tx.type === "gas_topup") {
    const q = quoteGasTopup(w, tx.chain, tx.amount);
    if (!q.ok) {
      tx.status = "reverted";
      tx.result = `补 gas 未执行：${q.error}；钱包与服务方均未扣款`;
      emit(w, "gas_topup_reverted", tx.result, { chain: tx.chain, commandId: tx.id });
      return;
    }
    const c = tx.chain;
    spend(w.wallet[c], "stable", n(tx.amount));
    addTo(w.bank[c], "stable", n(tx.amount) - n(q.serviceFeeUsd));
    addTo(w.treasury[c], "stable", n(q.serviceFeeUsd));
    spend(w.bank[c], "native", n(q.nativeOut) + n(q.gasNative));
    addTo(w.wallet[c], "native", n(q.nativeOut));
    w.burnt[c] = str(n(w.burnt[c]) + n(q.gasNative));
    tx.gasService = {
      serviceFeeUsd: q.serviceFeeUsd,
      gasNative: q.gasNative,
      gasUsd: q.gasUsd,
      exchangeRate: w.fx[c],
    };
    tx.out = q.nativeOut;
    tx.feeUsd = units(q.totalFeeUsd);
    w.feesUsd += tx.feeUsd;
    tx.status = "confirmed";
    tx.result = "同链稳定资产补 gas 已到账；服务方支付链费，费用已从稳定资产总额扣除";
    emit(w, "gas_topup", tx.result, { chain: c, commandId: tx.id, amountUsd: units(tx.amount) });
    return;
  }
  if (!chargeGas(w, tx)) return;
  const c = tx.chain;
  if (tx.type === "buy" || tx.type === "sell") {
    const t = w.tokens.find((x) => x.id === tx.tokenId);
    if (!t) {
      failTx(w, tx, "代币不存在");
      return;
    }
    const q = quoteTrade(w, t.id, tx.type, tx.amount);
    if (!q.ok) {
      failTx(w, tx, q.error ?? "执行失败");
      return;
    }
    if (n(q.amountOut) < n(tx.minOut)) {
      failTx(w, tx, "实际到账低于 minOut，交换及平台费全部回滚");
      return;
    }
    if (tx.type === "buy") {
      if (n(w.wallet[c].native) < n(tx.amount)) {
        failTx(w, tx, "排队后可用余额不足");
        return;
      }
      // Recheck at execution without scoring market-caused rejections as user misconduct.
      if (w.config.protection && riskCheck(w, t, tx.amount, tx.id)) {
        failTx(w, tx, "执行时风险预算已变化，订单未增加暴露");
        return;
      }
      const price = q.price;
      if (
        (tx.stopPrice !== undefined && tx.stopPrice >= price) ||
        (tx.targetPrice !== undefined && tx.targetPrice <= price)
      ) {
        failTx(w, tx, "价格变化导致原计划失效");
        return;
      }
      spend(w.wallet[c], "native", n(tx.amount));
      movePool(w, t, "buy", tx.amount, q);
      const p = w.positions[t.id] ?? {
        tokenId: t.id,
        quantity: ZERO,
        costUsd: ZERO,
        realizedUsd: ZERO,
        firstAt: w.now,
      };
      p.quantity = str(n(p.quantity) + n(q.amountOut));
      p.costUsd = str(n(p.costUsd) + n(usd(tx.amount, w.fx[c])) + n(a(tx.feeUsd ?? 0)));
      if (w.config.assessmentVersion !== "process-v2-trading" || p.protectionSource !== "user") {
        if (tx.stopPrice !== undefined) p.stopPrice = tx.stopPrice;
        if (tx.targetPrice !== undefined) p.targetPrice = tx.targetPrice;
        if (w.config.assessmentVersion === "process-v2-trading")
          p.protectionSource = "training-preset";
      }
      w.positions[t.id] = p;
    } else {
      const p = w.positions[t.id];
      if (!p || n(p.quantity) < n(tx.amount)) {
        failTx(w, tx, "持仓已变化或已被其他保护单退出");
        return;
      }
      const before = n(p.quantity),
        sold = n(tx.amount);
      const basis = sold === before ? n(p.costUsd) : (n(p.costUsd) * sold) / before;
      movePool(w, t, "sell", tx.amount, q);
      addTo(w.wallet[c], "native", n(q.amountOut));
      const realized = n(usd(q.amountOut, w.fx[c])) - basis - n(a(tx.feeUsd ?? 0));
      p.quantity = str(before - sold);
      p.costUsd = str(n(p.costUsd) - basis);
      p.realizedUsd = str(n(p.realizedUsd) + realized);
      w.realizedUsd = str(n(w.realizedUsd) + realized);
      if (p.quantity === ZERO) {
        delete p.stopPrice;
        delete p.targetPrice;
        if (w.config.assessmentVersion === "process-v2-trading") delete p.protectionSource;
      }
    }
    recordProcessFill(w, tx, q, tx.feeUsd ?? 0);
    const fee = nativeUsd(w, c, q.fee);
    w.feesUsd += fee;
    tx.feeUsd = (tx.feeUsd ?? 0) + fee;
    tx.out = q.amountOut;
    tx.status = "confirmed";
    tx.result = "已按执行时池储备成交";
    emit(w, "fill", `${tx.type === "buy" ? "买入" : "卖出"} ${t.symbol} 已确认`, {
      tokenId: t.id,
      chain: c,
      commandId: tx.id,
      amountUsd: nativeUsd(w, c, tx.type === "buy" ? tx.amount : q.amountOut),
    });
    return;
  }
  if (tx.type === "swap") {
    const direction = tx.direction ?? "to_native",
      fee = (n(tx.amount) * 30n) / BPS,
      net = n(tx.amount) - fee;
    const fx = n(a(w.fx[c]));
    if (direction === "to_native") {
      const out = (net * SCALE) / fx;
      if (n(w.wallet[c].stable) < n(tx.amount) || n(w.bank[c].native) < out) {
        failTx(w, tx, "兑换资金池或余额不足");
        return;
      }
      spend(w.wallet[c], "stable", n(tx.amount));
      addTo(w.bank[c], "stable", net);
      addTo(w.treasury[c], "stable", fee);
      spend(w.bank[c], "native", out);
      addTo(w.wallet[c], "native", out);
      tx.out = str(out);
      w.feesUsd += units(str(fee));
      tx.feeUsd = (tx.feeUsd ?? 0) + units(str(fee));
    } else {
      const out = (net * fx) / SCALE;
      if (n(w.wallet[c].native) < n(tx.amount) || n(w.bank[c].stable) < out) {
        failTx(w, tx, "兑换资金池或余额不足");
        return;
      }
      spend(w.wallet[c], "native", n(tx.amount));
      addTo(w.bank[c], "native", net);
      addTo(w.treasury[c], "native", fee);
      spend(w.bank[c], "stable", out);
      addTo(w.wallet[c], "stable", out);
      tx.out = str(out);
      const feeUsd = nativeUsd(w, c, str(fee));
      w.feesUsd += feeUsd;
      tx.feeUsd = (tx.feeUsd ?? 0) + feeUsd;
    }
    tx.status = "confirmed";
    tx.result = "兑换完成，资金未跨链";
    emit(w, "swap", "本链兑换已确认", { chain: c, commandId: tx.id });
    return;
  }
  if (tx.type === "bridge" && tx.toChain) {
    const fee = (n(tx.amount) * 20n) / BPS,
      net = n(tx.amount) - fee,
      to = tx.toChain;
    if (n(w.wallet[c].stable) < n(tx.amount) || n(w.bank[to].stable) < net) {
      failTx(w, tx, "桥储备或源链余额不足");
      return;
    }
    spend(w.wallet[c], "stable", n(tx.amount));
    addTo(w.treasury[c], "stable", fee);
    addTo(w.bank[c], "stable", net);
    spend(w.bank[to], "stable", net);
    const delay =
      30 +
      Math.floor(random(marketSeed(w), "bridge-delay", tx.id) * 90) +
      (w.config.regime === "stress" ? 90 : 0);
    w.bridges.push({
      id: tx.id,
      from: c,
      to,
      amount: str(net),
      fee: str(fee),
      dueAt: w.now + delay,
      status: "in_transit",
    });
    w.feesUsd += units(str(fee));
    tx.feeUsd = (tx.feeUsd ?? 0) + units(str(fee));
    tx.status = "confirmed";
    tx.result = "源链已确认，目标链仍在途";
    emit(w, "bridge_started", `稳定资产已进入桥托管，预计 ${delay} 秒后到账；不会变成目标链 gas`, {
      chain: c,
      commandId: tx.id,
    });
  }
}

function queuedTransactions(w: World) {
  for (const tx of w.transactions as InternalTx[]) {
    if (tx.status !== "pending") continue;
    if (tx.deadline !== undefined && w.now > tx.deadline) {
      tx.status = "expired";
      tx.result = "订单截止前未被包含，已过期且未收执行费";
      emit(w, "order_expired", tx.result, {
        tokenId: tx.tokenId,
        chain: tx.chain,
        commandId: tx.id,
      });
      continue;
    }
    if (tx.executeAt > w.now) continue;
    if (
      w.phase === "settling" &&
      (tx.type === "buy" || tx.type === "swap" || tx.type === "gas_topup")
    ) {
      tx.status = "cancelled";
      tx.result = "结算取消新增风险命令，未收执行费";
      continue;
    }
    if (
      w.config.regime === "stress" &&
      w.now - tx.submittedAt < 20 &&
      random(marketSeed(w), "congestion", `${tx.id}:${w.now}`) < 0.7
    )
      continue;
    executeTx(w, tx);
  }
}
function bridges(w: World) {
  for (const b of w.bridges) {
    if (b.status !== "in_transit" || b.dueAt > w.now) continue;
    addTo(w.wallet[b.to], "stable", n(b.amount));
    b.status = "completed";
    emit(w, "bridge_completed", "目标链稳定资产到账；交易仍需目标链原生 gas", {
      chain: b.to,
      commandId: b.id,
    });
  }
}

function protections(w: World) {
  for (const p of Object.values(w.positions)) {
    if (n(p.quantity) <= 0n) continue;
    const t = w.tokens.find((x) => x.id === p.tokenId);
    if (!t) continue;
    const price = tokenPrice(t);
    const guided =
      w.config.assessmentVersion === "process-v2-trading"
        ? w.transactions.find((tx) => {
            const e = tx.process;
            return (
              tx.type === "buy" &&
              tx.tokenId === t.id &&
              e?.guide &&
              BigInt(e.remaining ?? "0") > 0n &&
              e.automaticExitAt === undefined &&
              ((p.protectionSource !== "user" && e.trigger !== undefined) ||
                w.now >= (e.confirmedAt ?? tx.executeAt) + e.guide.maxHoldSeconds)
            );
          })?.process
        : undefined;
    const trigger =
      p.stopPrice !== undefined && price <= p.stopPrice
        ? "止损"
        : p.targetPrice !== undefined && price >= p.targetPrice
          ? "止盈"
          : guided
            ? p.protectionSource === "user" || guided.trigger === "timeout"
              ? "最长持有时间"
              : guided.trigger === "stop"
                ? "止损"
                : "止盈"
            : w.config.assessmentVersion === "process-v1" &&
                w.transactions.some(
                  (tx) =>
                    tx.type === "buy" &&
                    tx.tokenId === t.id &&
                    tx.process?.trigger === "timeout" &&
                    tx.process.exitAttemptAt === undefined &&
                    BigInt(tx.process.remaining ?? "0") > 0n,
                )
              ? "最长持有时间"
              : null;
    if (!trigger) continue;
    if (
      w.transactions.some(
        (tx) => tx.status === "pending" && tx.type === "sell" && tx.tokenId === p.tokenId,
      )
    )
      continue;
    const id = `auto-${w.id}-${p.tokenId}-${w.now}`;
    // Even an impossible exit is attempted as an application-side transaction; not a guaranteed fill.
    w.transactions.push({
      id,
      type: "sell",
      tokenId: p.tokenId,
      chain: t.chain,
      amount: p.quantity,
      minOut: ZERO,
      note: `应用侧${trigger}自动提交`,
      submittedAt: w.now,
      executeAt: w.now + executionDelay(w, t.chain),
      deadline: w.now + 120,
      status: "pending",
      automatic: true,
      ...(w.config.assessmentVersion === "process-v2-trading" ? { source: "safety" as const } : {}),
    } as InternalTx);
    markProcessExit(w, t.id, id);
    delete p.stopPrice;
    delete p.targetPrice;
    emit(w, "protection_triggered", `${trigger}条件触发，已排队尝试卖出；仍可能失败`, {
      tokenId: t.id,
      chain: t.chain,
      commandId: id,
    });
  }
}
function fxTick(w: World) {
  if (w.now % 60 !== 0) return;
  const drift =
    w.config.regime === "inflow" ? 0.00005 : w.config.regime === "outflow" ? -0.00005 : 0;
  const common = (random(marketSeed(w), "macro", w.now) - 0.5) * 0.001;
  for (const c of CHAINS) {
    const local = (random(marketSeed(w), `fx-${c.id}`, w.now) - 0.5) * 0.0005;
    w.fx[c.id] = Math.max(c.initialUsd * 0.2, rounded(w.fx[c.id] * (1 + common + local + drift)));
  }
}

function tick(w: World) {
  w.now++;
  fxTick(w);
  incidents(w);
  if (w.phase !== "settling") {
    const alive = w.tokens.filter((t) => t.status !== "dead" && t.status !== "dormant").length;
    if (alive >= 200) {
      const old = w.tokens.find(
        (t) =>
          w.now - t.bornAt > 600 &&
          !t.easterEgg &&
          n(w.positions[t.id]?.quantity ?? ZERO) === 0n &&
          t.status !== "migrating" &&
          t.status !== "dead" &&
          t.status !== "dormant",
      );
      if (old) old.status = "dormant";
    }
    const spawnChance =
      (w.config.spawnPerMinute / 60) *
      (w.config.regime === "outflow" ? 0.6 : w.config.regime === "inflow" ? 1.3 : 1);
    if (random(marketSeed(w), "birth-clock", w.now) < spawnChance && w.tokens.length < 15000)
      spawnToken(w, w.tokens.length);
    if (w.tokens.length >= 15000 && !w.events.some((e) => e.type === "birth_budget"))
      emit(
        w,
        "birth_budget",
        "达到浏览器15000项目预算，暂停新增发射但保留全部资产与交易；请备份结算后开启新世界",
      );
    background(w);
  }
  queuedTransactions(w);
  bridges(w);
  trackProcessTriggers(w);
  protections(w);
  if (w.now % 15 === 0) {
    history(w);
    sampleEquity(w);
  }
}

export function stepWorld(input: World, seconds: number): World {
  if (input.phase === "completed" || input.phase === "paused") return input;
  const w = copy(input),
    count = Math.max(0, Math.min(3600, Math.floor(seconds)));
  for (let i = 0; i < count; i++) {
    if (w.phase === "running" && w.now >= w.config.duration) beginSettlement(w);
    tick(w);
    if (w.phase === "settling") {
      queueFinalExits(w);
      if (w.now >= (w.settlementStartedAt ?? w.now) + 120) {
        finalize(w);
        break;
      }
    }
  }
  return w;
}

function beginSettlement(w: World) {
  if (w.phase === "settling" || w.phase === "completed") return;
  w.phase = "settling";
  w.settlementStartedAt = w.now;
  for (const tx of w.transactions)
    if (
      tx.status === "pending" &&
      (tx.type === "buy" || tx.type === "swap" || tx.type === "gas_topup")
    ) {
      tx.status = "cancelled";
      tx.result = "结算开始，取消新增风险命令";
    }
  emit(w, "settlement_started", "停止新开仓，开始固定 120 秒结算；不可卖持仓不会伪造成交");
}
function queueFinalExits(w: World) {
  if (w.now >= (w.settlementStartedAt ?? w.now) + 120) return;
  for (const p of Object.values(w.positions)) {
    if (
      n(p.quantity) <= 0n ||
      w.transactions.some(
        (tx) => tx.status === "pending" && tx.type === "sell" && tx.tokenId === p.tokenId,
      )
    )
      continue;
    const t = w.tokens.find((x) => x.id === p.tokenId);
    if (!t) continue;
    const q = poolQuote(t, "sell", p.quantity);
    if (!q.ok || n(q.amountOut) <= n(gasFor(w, t.chain))) continue;
    const id = `final-${w.id}-${p.tokenId}-${w.now}`;
    w.transactions.push({
      id,
      type: "sell",
      tokenId: t.id,
      chain: t.chain,
      amount: p.quantity,
      minOut: ZERO,
      note: "系统期末退出，非用户违规",
      submittedAt: w.now,
      executeAt: w.now + executionDelay(w, t.chain),
      deadline: (w.settlementStartedAt ?? w.now) + 120,
      status: "pending",
      ...(w.config.assessmentVersion === "process-v2-trading"
        ? { source: "settlement" as const }
        : {}),
    });
  }
}
function finalize(w: World, completedOverride?: boolean) {
  for (const tx of w.transactions)
    if (tx.status === "pending") {
      tx.status = "dropped";
      tx.result = "固定结算窗口已结束，未继续等待有利价格";
    }
  const residual =
    Object.values(w.positions).filter((p) => n(p.quantity) > 0n).length +
    w.bridges.filter((b) => b.status === "in_transit").length;
  // Illiquid positions and still-in-flight bridges are conservatively zero-valued at the deadline.
  const final = rounded(walletValue(w));
  const baseline = baselineValue(w);
  w.phase = "completed";
  const trades = w.transactions.filter(
    (t) => t.status === "confirmed" && (t.type === "buy" || t.type === "sell"),
  ).length;
  const confirmedBuys = w.transactions.filter((t) => t.status === "confirmed" && t.type === "buy");
  const noted = confirmedBuys.filter((t) => t.note.trim().length >= 4).length;
  const report: WorldReport = {
    worldId: w.id,
    seed: w.config.seed,
    regime: w.config.regime,
    mode: w.config.mode,
    elapsed: Math.min(w.config.duration, w.settlementStartedAt ?? w.now),
    completed:
      completedOverride ??
      (w.config.mode !== "exam" || (w.settlementStartedAt ?? 0) >= w.config.duration),
    initial: w.initialEquity,
    final,
    pnl: rounded(final - w.initialEquity),
    returnPct: rounded((final / w.initialEquity - 1) * 100),
    baselineReturnPct: rounded((baseline / w.initialEquity - 1) * 100),
    excessPct: rounded(((final - baseline) / w.initialEquity) * 100),
    fees: rounded(w.feesUsd),
    trades,
    violations: w.riskEvidence.length,
    maxDrawdownPct: rounded(w.maxDrawdownPct),
    residual,
    discipline: {
      risk: Math.max(0, 100 - w.riskEvidence.length * 25),
      execution: confirmedBuys.length ? Math.round((noted / confirmedBuys.length) * 100) : 80,
      review: 0,
    },
    events: copy(w.events),
  };
  report.marketVariant = w.config.marketVariant ?? "standard";
  if (w.config.assessmentVersion) {
    report.assessmentVersion = w.config.assessmentVersion;
    report.generationProfile = w.config.generationProfile;
    report.process = buildProcessReport(w);
    report.outcomes = classifyTokenOutcomes(w, (token, amount) => ({
      ...poolQuote(token, "sell", amount),
      gas: gasFor(w, token.chain),
    }));
    report.discipline.execution = report.process.score;
  }
  w.report = report;
  sampleEquity(w);
  emit(w, "settled", `世界已结算，残余不可回收项目 ${residual} 个，报告不代表真实盈利能力`);
}
export function settleWorld(input: World): World {
  if (input.phase === "completed") return input;
  if (input.config.mode === "exam" && input.now < input.config.duration) return input;
  const w = copy(input);
  beginSettlement(w);
  for (let i = 0; i < 120; i++) {
    queueFinalExits(w);
    tick(w);
  }
  finalize(w);
  return w;
}

export interface Observation {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "muted";
  source: string;
  observedAt: number;
  freshness: "current" | "stale";
  confidence: number;
  status: "confirmed" | "inferred" | "unknown" | "expired";
}
export function publicObservations(w: World, tokenId: string): Observation[] {
  const t = w.tokens.find((x) => x.id === tokenId);
  if (!t) return [];
  const concentration = (Number(n(t.creatorTokens)) / Number(n(t.supply))) * 100;
  const observations: Omit<
    Observation,
    "source" | "observedAt" | "freshness" | "confidence" | "status"
  >[] = [
    {
      label: "LP 份额",
      value: t.pool.lpLocked
        ? "对应份额已锁定或销毁；不防大户卖币"
        : "创建者可控制 LP，存在撤资能力",
      tone: t.pool.lpLocked ? "ok" : "warn",
    },
    {
      label: "铸币权限",
      value: t.mintAuthority ? "有效，供应可增加" : "已撤销此项权限",
      tone: t.mintAuthority ? "warn" : "muted",
    },
    {
      label: "冻结权限",
      value: t.freezeAuthority ? "有效，转账可能受限" : "无此项权限",
      tone: t.freezeAuthority ? "warn" : "muted",
    },
    {
      label: "税费权限",
      value: t.taxMutable ? `可变；当前卖出税 ${t.sellTaxBps / 100}%` : "本模板不支持可变税",
      tone: t.sellTaxBps > 0 ? "bad" : t.taxMutable ? "warn" : "muted",
    },
    {
      label: "创建者持币",
      value: `${concentration.toFixed(1)}% 的当前供应；关联关系并非全知`,
      tone: concentration > 20 ? "warn" : "muted",
    },
    {
      label: "信息时间",
      value: `模拟 ${Math.floor(w.now / 60)} 分钟已确认快照；未来行为未知`,
      tone: "muted",
    },
  ];
  return observations.map((item) => ({
    ...item,
    source: item.label === "创建者持币" ? "模拟创建事件与可见钱包余额" : "模拟链状态快照",
    observedAt: w.now,
    freshness: "current",
    confidence: item.label === "信息时间" ? 0 : 1,
    status: item.label === "信息时间" ? "unknown" : "confirmed",
  }));
}
