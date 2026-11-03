import { z } from "zod";
import { EASTER_EGG_ASSETS, ENGINE_VERSION, MIXED_ENGINE_VERSION, PLATFORMS } from "./config.ts";
import { atoms, SCALE, units, usd } from "./amount.ts";
import { gasFor, poolQuote } from "./engine.ts";
import { buildProcessReport, classifyTokenOutcomes, validateTradePlan } from "./process.ts";
import type { World, WorldReport } from "./types.ts";

const MAX_AMOUNT = 10n ** 30n;
const integer = z
  .string()
  .regex(/^(0|[1-9]\d{0,30})$/)
  .refine((s) => /^\d+$/.test(s) && BigInt(s) <= MAX_AMOUNT, "金额超出账本范围");
const signed = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,30})$/)
  .refine((s) => {
    if (!/^-?\d+$/.test(s)) return false;
    const n = BigInt(s);
    return n >= -MAX_AMOUNT && n <= MAX_AMOUNT;
  });
const id = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9:_\-.]+$/)
  .refine((s) => !["__proto__", "prototype", "constructor"].includes(s));
const chain = z.enum(["solana", "bnb", "base"]);
const marketVariant = z.enum(["standard", "thin", "busy", "costly"]);
const assessmentVersion = z.enum(["process-v1", "process-v2-trading"]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const time = z
  .number()
  .int()
  .min(-86400)
  .max(86400 * 8);
const finite = z.number().finite().min(-1e24).max(1e24);
const nonnegative = z.number().finite().min(0).max(1e24);
const price = z.number().finite().min(0).max(1e12);
const balance = z.object({ native: integer, stable: integer }).strict();
const chains = z.object({ solana: balance, bnb: balance, base: balance }).strict();
const nativeBalances = z.object({ solana: integer, bnb: integer, base: integer }).strict();
const fx = z
  .object({
    solana: z.number().positive().max(1e9),
    bnb: z.number().positive().max(1e9),
    base: z.number().positive().max(1e9),
  })
  .strict();
const config = z
  .object({
    seed: z.string().min(1).max(150),
    runId: z.string().max(150).optional(),
    mode: z.enum(["free", "practice", "exam"]),
    regime: z.enum(["inflow", "rotation", "outflow", "stress"]),
    marketVariant: marketVariant.optional(),
    generationProfile: z.literal("mixed-v1").optional(),
    assessmentVersion: assessmentVersion.optional(),
    spawnPerMinute: z.number().finite().min(0.1).max(12),
    protection: z.boolean(),
    duration: z
      .number()
      .int()
      .min(120)
      .max(86400 * 7),
    label: z.string().max(200).optional(),
  })
  .passthrough();
const poolSchema = z
  .object({
    kind: z.enum(["curve", "cpmm"]),
    token: integer,
    quote: integer,
    virtualToken: integer,
    virtualQuote: integer,
    targetQuote: integer,
    feeBps: z.number().int().min(0).max(3000),
    lpFeeBps: z.number().int().min(0).max(3000).optional(),
    lpLocked: z.boolean(),
    migratedAt: time.optional(),
  })
  .passthrough();
const tokenSchema = z
  .object({
    id,
    chain,
    platformId: id,
    name: z.string().min(1).max(200),
    symbol: z.string().min(1).max(80),
    address: id,
    narrative: z.string().max(500),
    easterEgg: z.enum(["btc", "eth", "sol", "doge"]).optional(),
    bornAt: time,
    supply: integer,
    creatorId: id,
    creatorTokens: integer,
    pool: poolSchema,
    status: z.enum(["curve", "migrating", "pool", "dormant", "dead"]),
    holders: count,
    volume: nonnegative,
    mintAuthority: z.boolean(),
    freezeAuthority: z.boolean(),
    taxMutable: z.boolean(),
    sellTaxBps: z.number().int().min(0).max(10000),
    frozen: z.boolean(),
    history: z.array(z.object({ t: time, price, volume: nonnegative }).strict()).max(5000),
    initialPrice: price,
    peakPrice: price,
    trades: count,
    lastTradeAt: time.optional(),
    latent: z
      .object({
        intent: z.enum(["honest", "dump", "pull", "freeze", "tax", "mint"]),
        incidentAt: time,
        fired: z.boolean(),
        appeal: z.number().finite().min(0).max(1),
        momentum: z.number().finite().min(0).max(1),
      })
      .strict(),
  })
  .passthrough();
const positionSchema = z
  .object({
    tokenId: id,
    quantity: integer,
    costUsd: integer,
    realizedUsd: signed,
    firstAt: time,
    stopPrice: price.optional(),
    targetPrice: price.optional(),
    protectionSource: z.enum(["training-preset", "user"]).optional(),
  })
  .passthrough();
const participantSchema = z
  .object({
    id,
    style: z.enum(["community", "momentum", "whale", "noise"]),
    balances: nativeBalances,
    tokens: z.record(id, integer),
  })
  .passthrough();
export const tradePlanSchema = z
  .object({
    version: z.literal("plan-v1"),
    thesis: z.enum(["flow", "probe", "scale"]),
    maxLossUsd: z.number().finite().positive().max(1e12),
    invalidationPrice: price.positive(),
    targetPrice: price.positive(),
    maxHoldSeconds: z.number().int().min(30).max(3600),
    maxImpactPct: z.number().positive().max(20),
    evidence: z
      .array(z.enum(["lp", "permissions", "liquidity", "concentration", "momentum"]))
      .min(1)
      .max(5)
      .refine((keys) => new Set(keys).size === keys.length),
  })
  .strict();
const tradeProcessSchema = z
  .object({
    version: assessmentVersion,
    origin: z.literal("automatic-snapshot").optional(),
    guide: z
      .object({
        origin: z.literal("training-preset"),
        version: z.literal("guide-v1"),
        stopPrice: price.positive(),
        targetPrice: price.positive(),
        maxHoldSeconds: z.literal(900),
      })
      .strict()
      .optional(),
    exposure: z
      .object({ projectUsd: nonnegative, clusterUsd: nonnegative, totalUsd: nonnegative })
      .strict()
      .optional(),
    at: time,
    price: price.positive(),
    equityUsd: nonnegative,
    amountUsd: nonnegative,
    impactPct: nonnegative,
    liquidityUsd: nonnegative,
    creatorPct: z.number().finite().min(0).max(100),
    holders: count,
    momentumPct: finite,
    existingQuantity: integer,
    sellable: z.boolean(),
    permissions: z
      .object({
        lpLocked: z.boolean(),
        mint: z.boolean(),
        freeze: z.boolean(),
        mutableTax: z.boolean(),
      })
      .strict(),
    confirmedAt: time.optional(),
    filledCostUsd: nonnegative.optional(),
    filledImpactPct: nonnegative.optional(),
    quantity: integer.optional(),
    remaining: integer.optional(),
    triggerAt: time.optional(),
    trigger: z.enum(["stop", "target", "timeout"]).optional(),
    exitAttemptAt: time.optional(),
    exitTransactionId: id.optional(),
    closedAt: time.optional(),
    closedBy: z.enum(["manual", "safety", "settlement"]).optional(),
    automaticExitAt: time.optional(),
    automaticExitTransactionId: id.optional(),
    buyFeesUsd: nonnegative.optional(),
    sellFeesUsd: nonnegative.optional(),
    manualReduced: integer.optional(),
    manualExitConfirmedAt: time.optional(),
    manualExitConfirmedId: id.optional(),
  })
  .strict();
const processCheckSchema = z
  .object({
    id: z.string().max(500),
    label: z.string().max(100),
    passed: z.boolean().nullable(),
    detail: z.string().max(1500),
    weight: z.number().int().min(0).max(100),
    transactionId: id.optional(),
    eventIds: z.array(id).max(100000),
  })
  .strict();
const processReportSchema = z
  .object({
    version: assessmentVersion,
    score: z.number().int().min(0).max(100),
    decisions: count,
    checks: z.array(processCheckSchema).max(600000),
    weaknesses: z.array(z.string().max(1000)).max(30),
  })
  .strict();
const outcomeSchema = z
  .object({
    tokenId: id,
    symbol: z.string().max(80),
    classification: z.enum(["quality", "speculative", "rug", "dump", "inactive", "insufficient"]),
    label: z.string().max(100),
    reason: z.string().max(12000),
    returnPct: finite,
    peakReturnPct: finite,
    ageSeconds: count,
    liquidityUsd: nonnegative,
    standardExitUsd: nonnegative,
    sellable: z.boolean(),
    eventIds: z.array(id).max(100000),
  })
  .strict();
const transactionSchema = z
  .object({
    id,
    type: z.enum(["buy", "sell", "swap", "bridge", "gas_topup"]),
    tokenId: id.optional(),
    chain,
    toChain: chain.optional(),
    amount: integer,
    minOut: integer,
    note: z.string().max(1000),
    submittedAt: time,
    executeAt: time,
    deadline: time.optional(),
    status: z.enum(["pending", "confirmed", "reverted", "dropped", "cancelled", "expired"]),
    result: z.string().max(1500).optional(),
    feeUsd: nonnegative.optional(),
    out: integer.optional(),
    direction: z.enum(["to_native", "to_stable"]).optional(),
    stopPrice: price.optional(),
    targetPrice: price.optional(),
    automatic: z.boolean().optional(),
    plan: tradePlanSchema.optional(),
    process: tradeProcessSchema.optional(),
    source: z.enum(["manual", "safety", "settlement"]).optional(),
    gasService: z
      .object({
        serviceFeeUsd: integer,
        gasNative: integer,
        gasUsd: integer,
        exchangeRate: z.number().finite().positive().max(1e9),
      })
      .strict()
      .optional(),
  })
  .passthrough();
const bridgeSchema = z
  .object({
    id,
    from: chain,
    to: chain,
    amount: integer,
    fee: integer,
    dueAt: time,
    status: z.enum(["in_transit", "completed", "refunded"]),
  })
  .strict();
const eventSchema = z
  .object({
    id,
    seq: count,
    at: time,
    type: z.string().min(1).max(100),
    message: z.string().max(1500),
    tokenId: id.optional(),
    chain: chain.optional(),
    commandId: id.optional(),
    amountUsd: finite.optional(),
    violation: z.boolean().optional(),
    effect: z
      .object({
        field: z.enum(["pool_quote", "frozen", "sell_tax_bps", "supply", "creator_tokens"]),
        before: integer,
        after: integer,
      })
      .strict()
      .optional(),
  })
  .passthrough();
export const reportSchema = z
  .object({
    worldId: id,
    seed: z.string().min(1).max(150),
    regime: z.enum(["inflow", "rotation", "outflow", "stress"]),
    mode: z.enum(["free", "practice", "exam"]),
    marketVariant: marketVariant.optional(),
    assessmentVersion: assessmentVersion.optional(),
    generationProfile: z.literal("mixed-v1").optional(),
    process: processReportSchema.optional(),
    outcomes: z.array(outcomeSchema).max(15000).optional(),
    elapsed: z
      .number()
      .int()
      .min(0)
      .max(86400 * 7),
    completed: z.boolean(),
    initial: z.number().positive().max(1e24),
    final: nonnegative,
    pnl: finite,
    returnPct: finite,
    baselineReturnPct: finite,
    excessPct: finite,
    fees: nonnegative,
    trades: count,
    violations: count,
    maxDrawdownPct: z.number().finite().min(0).max(100),
    residual: count,
    discipline: z
      .object({
        risk: z.number().min(0).max(100),
        execution: z.number().min(0).max(100),
        review: z.number().min(0).max(100),
      })
      .strict(),
    events: z.array(eventSchema).max(100000),
  })
  .passthrough()
  .superRefine((r, ctx) => {
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.00002;
    if (
      !near(r.pnl, r.final - r.initial) ||
      !near(r.returnPct, (r.final / r.initial - 1) * 100) ||
      !near(r.excessPct, r.returnPct - r.baselineReturnPct)
    )
      ctx.addIssue({ code: "custom", message: "报告收益字段不一致" });
    if (r.completed && r.mode === "exam" && r.elapsed !== 7200)
      ctx.addIssue({ code: "custom", message: "正式报告未走满120模拟分钟" });
    if (
      r.assessmentVersion
        ? !r.process ||
          !r.outcomes ||
          r.process.version !== r.assessmentVersion ||
          r.discipline.execution !== r.process.score
        : r.process !== undefined || r.outcomes !== undefined
    )
      ctx.addIssue({ code: "custom", message: "过程评分版本与报告不一致" });
  });
const worldBase = z
  .object({
    version: z.literal(1),
    engineVersion: z.enum([ENGINE_VERSION, MIXED_ENGINE_VERSION]),
    id,
    config,
    now: z
      .number()
      .int()
      .min(0)
      .max(86400 * 7 + 120),
    nextId: count,
    phase: z.enum(["running", "paused", "settling", "completed"]),
    wallet: chains,
    initialWallet: chains,
    fx,
    initialFx: fx,
    tokens: z.array(tokenSchema).max(15000),
    positions: z.record(id, positionSchema),
    participants: z.array(participantSchema).max(1000),
    treasury: chains,
    bank: chains,
    burnt: nativeBalances,
    lockedTokens: z.record(id, integer),
    transactions: z.array(transactionSchema).max(100000),
    bridges: z.array(bridgeSchema).max(100000),
    events: z.array(eventSchema).max(100000),
    riskEvidence: z
      .array(
        z
          .object({
            at: time,
            code: z.string().max(100),
            message: z.string().max(1500),
            commandId: id,
          })
          .strict(),
      )
      .max(100000),
    equity: z
      .array(z.object({ t: time, equity: nonnegative, baseline: nonnegative }).strict())
      .max(10000),
    feesUsd: nonnegative,
    initialEquity: z.number().positive().max(1e24),
    highWater: nonnegative,
    maxDrawdownPct: z.number().finite().min(0).max(100),
    realizedUsd: signed,
    processedCommands: z.array(id).max(100000),
    stopUntil: time,
    dayStartEquity: nonnegative,
    settlementStartedAt: time.optional(),
    report: reportSchema.optional(),
  })
  .passthrough();
function unique(values: string[]) {
  return new Set(values).size === values.length;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function semanticIssues(w: World): string[] {
  const errors: string[] = [],
    tokenMap = new Map(w.tokens.map((t) => [t.id, t])),
    participantIds = new Set(w.participants.map((p) => p.id));
  if (
    w.engineVersion !==
      (w.config.generationProfile === "mixed-v1" ? MIXED_ENGINE_VERSION : ENGINE_VERSION) ||
    (w.config.generationProfile === "mixed-v1" &&
      w.config.mode !== "free" &&
      !w.config.assessmentVersion)
  )
    errors.push("生成版本与世界模式不匹配");
  if (
    !unique(w.tokens.map((t) => t.id)) ||
    !unique(w.tokens.filter((t) => t.easterEgg).map((t) => t.easterEgg!)) ||
    !unique(w.tokens.map((t) => `${t.chain}:${t.address}`)) ||
    !unique(w.participants.map((p) => p.id)) ||
    !unique(w.transactions.map((t) => t.id)) ||
    !unique(w.bridges.map((b) => b.id)) ||
    !unique(w.events.map((e) => e.id)) ||
    !unique(w.processedCommands)
  )
    errors.push("实体或命令编号重复");
  if (w.now > w.config.duration + 120) errors.push("模拟时间超出结算窗口");
  if (
    w.config.mode === "exam" &&
    (!w.config.protection || w.config.duration !== 7200 || w.config.spawnPerMinute !== 6)
  )
    errors.push("正式世界参数被改变");
  if (w.phase === "completed" && !w.report) errors.push("已结束世界缺少报告");
  if (w.phase !== "completed" && w.report) errors.push("未结束世界不能带终局报告");
  if (w.phase === "settling" && w.settlementStartedAt === undefined)
    errors.push("结算缺少起始时间");
  if (
    w.settlementStartedAt !== undefined &&
    (w.settlementStartedAt < 0 || w.settlementStartedAt > w.now)
  )
    errors.push("结算起始时间无效");
  if (
    w.events.some((e, i) => e.at > w.now || (i > 0 && e.seq <= w.events[i - 1].seq)) ||
    w.events.some((e) => e.seq >= w.nextId)
  )
    errors.push("事件时序无效");
  if (w.equity.some((e, i) => e.t > w.now || (i > 0 && e.t < w.equity[i - 1].t)))
    errors.push("权益采样时序无效");
  for (const [key, p] of Object.entries(w.positions)) {
    if (key !== p.tokenId || !tokenMap.has(key) || p.firstAt > w.now)
      errors.push("持仓引用不存在的资产");
    if (p.protectionSource !== undefined && w.config.assessmentVersion !== "process-v2-trading")
      errors.push("旧版持仓混入新版保护来源");
    if (
      p.protectionSource === "user" &&
      !w.events.some((event) => event.type === "protection_set" && event.tokenId === key)
    )
      errors.push("自定义保护缺少用户设置事件");
  }
  for (const p of w.participants)
    for (const key of Object.keys(p.tokens))
      if (!tokenMap.has(key)) errors.push("NPC引用不存在的资产");
  for (const key of Object.keys(w.lockedTokens))
    if (!tokenMap.has(key)) errors.push("锁仓引用不存在的资产");
  for (const tx of w.transactions) {
    if (
      tx.submittedAt > w.now ||
      tx.submittedAt < 0 ||
      tx.executeAt < tx.submittedAt ||
      BigInt(tx.amount) <= 0n
    )
      errors.push("交易数量或时间无效");
    if (
      tx.deadline !== undefined &&
      (tx.deadline <= tx.submittedAt || tx.deadline > tx.submittedAt + 3600)
    )
      errors.push("订单截止时间无效");
    if (tx.type === "buy" || tx.type === "sell") {
      const token = tx.tokenId ? tokenMap.get(tx.tokenId) : undefined;
      if (!token || token.chain !== tx.chain) errors.push("交易链与代币身份不一致");
    }
    if (tx.process) {
      const e = tx.process;
      if (
        !w.config.assessmentVersion ||
        e.version !== w.config.assessmentVersion ||
        tx.type !== "buy" ||
        e.at !== tx.submittedAt ||
        e.at < 0 ||
        e.at > w.now ||
        (tx.plan && !validateTradePlan(tx.plan, e.price))
      )
        errors.push("冻结计划与提交证据不一致");
      if (w.config.assessmentVersion === "process-v1" && w.config.mode === "exam" && !tx.plan)
        errors.push("新版正式买单缺少冻结计划");
      if (
        tx.status !== "confirmed" &&
        [
          e.confirmedAt,
          e.filledCostUsd,
          e.filledImpactPct,
          e.quantity,
          e.remaining,
          e.triggerAt,
          e.trigger,
          e.exitAttemptAt,
          e.exitTransactionId,
          e.closedAt,
          e.closedBy,
          e.automaticExitAt,
          e.automaticExitTransactionId,
          e.buyFeesUsd,
          e.sellFeesUsd,
          e.manualReduced,
          e.manualExitConfirmedAt,
          e.manualExitConfirmedId,
        ].some((value) => value !== undefined)
      )
        errors.push("未成交买单不能带有持仓执行证据");
      if (
        e.confirmedAt !== undefined &&
        (tx.status !== "confirmed" ||
          e.confirmedAt < tx.submittedAt ||
          e.confirmedAt > w.now ||
          !e.quantity ||
          !e.remaining ||
          e.quantity !== tx.out ||
          BigInt(e.remaining) > BigInt(e.quantity))
      )
        errors.push("过程成交证据不一致");
      if (
        tx.status === "confirmed" &&
        (e.confirmedAt === undefined ||
          e.filledCostUsd === undefined ||
          e.filledImpactPct === undefined)
      )
        errors.push("已成交买单缺少过程证据");
      if (
        (e.triggerAt === undefined) !== (e.trigger === undefined) ||
        (e.triggerAt !== undefined &&
          (e.triggerAt < (e.confirmedAt ?? w.now) || e.triggerAt > w.now))
      )
        errors.push("计划触发时间无效");
      if (
        (e.exitAttemptAt === undefined) !== (e.exitTransactionId === undefined) ||
        (e.exitAttemptAt !== undefined &&
          !w.transactions.some(
            (exit) =>
              exit.id === e.exitTransactionId &&
              exit.type === "sell" &&
              exit.tokenId === tx.tokenId &&
              exit.submittedAt === e.exitAttemptAt &&
              (e.version === "process-v2-trading"
                ? exit.source === "manual"
                : !exit.id.startsWith(`final-${w.id}-`)),
          ))
      )
        errors.push("计划退出缺少真实提交证据");
      if (
        e.closedAt !== undefined &&
        (e.remaining !== "0" || e.closedAt < (e.confirmedAt ?? w.now) || e.closedAt > w.now)
      )
        errors.push("计划平仓时间无效");
      if (e.version === "process-v2-trading") {
        const guide = e.guide;
        const near = (x: number, y: number) =>
          Math.abs(x - y) <= Math.max(1e-15, Math.abs(y) * 1e-12);
        if (
          e.origin !== "automatic-snapshot" ||
          !guide ||
          !near(guide.stopPrice, e.price * 0.85) ||
          !near(guide.targetPrice, e.price * 1.3) ||
          guide.maxHoldSeconds !== 900 ||
          !e.exposure ||
          e.exposure.projectUsd < e.amountUsd ||
          e.exposure.clusterUsd < e.amountUsd ||
          e.exposure.totalUsd < e.amountUsd
        )
          errors.push("自动交易快照或教学指导来源无效");
        if (tx.status === "confirmed" && e.buyFeesUsd === undefined)
          errors.push("交易快照缺少真实买入费用");
        if (
          e.automaticExitAt !== undefined &&
          !w.transactions.some(
            (exit) =>
              exit.id === e.automaticExitTransactionId &&
              exit.source === "safety" &&
              exit.type === "sell" &&
              exit.tokenId === tx.tokenId &&
              exit.submittedAt === e.automaticExitAt,
          )
        )
          errors.push("自动保护缺少来源证据");
        if ((e.automaticExitAt === undefined) !== (e.automaticExitTransactionId === undefined))
          errors.push("自动保护时间与来源不一致");
        if (
          e.manualReduced !== undefined &&
          (!e.quantity || BigInt(e.manualReduced) > BigInt(e.quantity) - BigInt(e.remaining ?? "0"))
        )
          errors.push("自主减仓数量与实际持仓不一致");
        if (
          e.manualExitConfirmedAt !== undefined &&
          !w.transactions.some(
            (exit) =>
              exit.id === e.manualExitConfirmedId &&
              exit.source === "manual" &&
              exit.type === "sell" &&
              exit.tokenId === tx.tokenId &&
              exit.status === "confirmed" &&
              w.events.some(
                (event) =>
                  event.commandId === exit.id &&
                  event.type === "fill" &&
                  event.at === e.manualExitConfirmedAt,
              ),
          )
        )
          errors.push("自主卖出缺少真实成交证据");
        if (
          (e.manualExitConfirmedAt === undefined) !== (e.manualExitConfirmedId === undefined) ||
          (BigInt(e.manualReduced ?? "0") > 0n && e.manualExitConfirmedAt === undefined)
        )
          errors.push("自主卖出时间或数量缺失");
        if (e.closedBy !== undefined && e.closedAt === undefined)
          errors.push("平仓来源缺少平仓时刻");
      } else if (
        [
          e.origin,
          e.guide,
          e.exposure,
          e.closedBy,
          e.automaticExitAt,
          e.automaticExitTransactionId,
          e.buyFeesUsd,
          e.sellFeesUsd,
          e.manualReduced,
          e.manualExitConfirmedAt,
          e.manualExitConfirmedId,
        ].some((value) => value !== undefined)
      )
        errors.push("旧版过程证据混入新版交易字段");
    } else if (w.config.assessmentVersion && tx.type === "buy") errors.push("新版买单缺少提交快照");
    if (
      w.config.assessmentVersion === "process-v2-trading" &&
      (tx.type === "buy" || tx.type === "sell")
    ) {
      if (!tx.source) errors.push("新版交易缺少操作来源");
      if (tx.type === "buy" && tx.source !== "manual") errors.push("新版买入不是自主操作");
      if (tx.source === "manual" && tx.automatic === true) errors.push("自动保护不能冒充自主卖出");
      if (
        tx.source === "safety" &&
        (!tx.automatic ||
          !w.events.some(
            (event) => event.type === "protection_triggered" && event.commandId === tx.id,
          ))
      )
        errors.push("保护卖出缺少系统来源");
      if (
        tx.source === "settlement" &&
        (w.settlementStartedAt === undefined ||
          tx.submittedAt < w.settlementStartedAt ||
          !tx.id.startsWith(`final-${w.id}-`))
      )
        errors.push("结算卖出来源无效");
    } else if (tx.source !== undefined) errors.push("旧版或资金交易混入自主交易来源");
    if (tx.type === "bridge" && (!tx.toChain || tx.chain === tx.toChain)) errors.push("桥路线无效");
    if (tx.type === "gas_topup") {
      if (
        tx.tokenId !== undefined ||
        tx.toChain !== undefined ||
        tx.minOut !== "0" ||
        tx.deadline !== undefined ||
        tx.plan !== undefined ||
        tx.process !== undefined
      )
        errors.push("补 gas 服务携带无效交易字段");
      if (tx.status === "confirmed") {
        const service = tx.gasService,
          gross = BigInt(tx.amount),
          fee = (gross * 50n) / 10000n > 20000n ? (gross * 50n) / 10000n : 20000n;
        if (
          !service ||
          !tx.out ||
          service.serviceFeeUsd !== fee.toString() ||
          service.gasNative !== gasFor(w, tx.chain) ||
          service.gasUsd !== usd(service.gasNative, service.exchangeRate) ||
          Math.abs((tx.feeUsd ?? -1) - units((fee + BigInt(service.gasUsd)).toString())) >
            0.000001 ||
          gross <= fee + BigInt(service.gasUsd) ||
          BigInt(tx.out) !==
            ((gross - fee - BigInt(service.gasUsd)) * SCALE) /
              BigInt(atoms(service.exchangeRate.toFixed(6)))
        )
          errors.push("补 gas 执行报价或费用证据不一致");
        if (
          !w.events.some(
            (event) =>
              event.type === "gas_topup" &&
              event.commandId === tx.id &&
              event.chain === tx.chain &&
              event.amountUsd === units(tx.amount),
          )
        )
          errors.push("补 gas 服务缺少到账事件");
      } else if (tx.gasService !== undefined || tx.out !== undefined || tx.feeUsd !== undefined)
        errors.push("未执行补 gas 服务不能扣费或产生资产");
    } else if (tx.gasService !== undefined) errors.push("普通交易不能携带补 gas 服务执行凭证");
  }
  for (const b of w.bridges)
    if (
      b.from === b.to ||
      !w.transactions.some(
        (tx) =>
          tx.id === b.id &&
          tx.type === "bridge" &&
          tx.status === "confirmed" &&
          tx.chain === b.from &&
          tx.toChain === b.to,
      )
    )
      errors.push("桥缺少一致源链确认");
  for (const t of w.tokens) {
    if (t.easterEgg) {
      const index = EASTER_EGG_ASSETS.findIndex((item) => item.id === t.easterEgg);
      const egg = EASTER_EGG_ASSETS[index];
      if (
        !egg ||
        w.config.generationProfile !== "mixed-v1" ||
        (w.config.mode !== "free" && !w.config.assessmentVersion) ||
        t.id !== `${w.id}-t${index}` ||
        t.chain !== egg.chain ||
        t.symbol !== egg.symbol ||
        t.name !== egg.name ||
        t.bornAt >= 0 ||
        t.supply !== atoms(egg.supply) ||
        t.creatorId !== `creator-${index}` ||
        t.creatorTokens !== "0" ||
        t.platformId !== "open-market" ||
        t.pool.kind !== "cpmm" ||
        !t.pool.lpLocked ||
        t.mintAuthority ||
        t.freezeAuthority ||
        t.taxMutable ||
        t.sellTaxBps !== 0 ||
        t.frozen ||
        t.latent.intent !== "honest" ||
        t.latent.fired
      )
        errors.push("彩蛋映射资产身份或权限无效");
    }
    const spec = PLATFORMS.find((p) => p.id === t.platformId);
    if (!spec || (spec.chain !== "all" && spec.chain !== t.chain)) {
      errors.push("平台与链不匹配");
      continue;
    }
    if (t.bornAt > w.now || !participantIds.has(t.creatorId))
      errors.push("项目出生或创建者引用无效");
    if (
      (t.mintAuthority && !spec.allowMint) ||
      (t.freezeAuthority && !spec.allowFreeze) ||
      (t.taxMutable && !spec.allowTax) ||
      (spec.lockedLp && !t.pool.lpLocked)
    )
      errors.push("代币突破平台权限");
    if ((t.frozen && !t.freezeAuthority) || (t.sellTaxBps > 0 && !t.taxMutable))
      errors.push("风险状态无权限依据");
    if (
      (t.latent.intent === "pull" && t.pool.lpLocked) ||
      (t.latent.intent === "mint" && !t.mintAuthority) ||
      (t.latent.intent === "freeze" && !t.freezeAuthority) ||
      (t.latent.intent === "tax" && !t.taxMutable)
    )
      errors.push("隐藏事件突破平台能力");
    if (
      (t.pool.kind === "curve" && spec.mechanism !== "curve") ||
      (t.status === "curve" && t.pool.kind !== "curve") ||
      (t.status === "pool" && t.pool.kind !== "cpmm") ||
      (t.status === "migrating" && (t.pool.kind !== "curve" || t.pool.migratedAt === undefined))
    )
      errors.push("项目阶段与池不一致");
    if (t.pool.kind === "cpmm" && (t.pool.virtualToken !== "0" || t.pool.virtualQuote !== "0"))
      errors.push("真实池混入虚拟储备");
    if (t.history.some((h, i) => h.t > w.now || (i > 0 && h.t <= t.history[i - 1].t)))
      errors.push("代币历史时间无效");
    if (t.lastTradeAt !== undefined && t.lastTradeAt > w.now) errors.push("最后成交时间无效");
    const held =
      BigInt(t.pool.token) +
      BigInt(t.creatorTokens) +
      BigInt(w.lockedTokens[t.id] ?? "0") +
      BigInt(w.positions[t.id]?.quantity ?? "0") +
      w.participants.reduce((s, p) => s + BigInt(p.tokens[t.id] ?? "0"), 0n);
    if (held !== BigInt(t.supply)) errors.push("总供应与全部持有量不守恒");
  }
  if (w.report) {
    const r = w.report;
    if (
      r.worldId !== w.id ||
      r.seed !== w.config.seed ||
      r.mode !== w.config.mode ||
      r.regime !== w.config.regime ||
      (r.marketVariant ?? "standard") !== (w.config.marketVariant ?? "standard") ||
      r.assessmentVersion !== w.config.assessmentVersion ||
      Math.abs(r.initial - w.initialEquity) > 0.000001 ||
      r.elapsed > Math.min(w.now, w.config.duration)
    )
      errors.push("报告与世界身份不一致");
    if (
      r.completed &&
      r.mode === "exam" &&
      ((w.settlementStartedAt ?? -1) !== 7200 || w.now < 7320)
    )
      errors.push("正式报告缺少固定结算窗口");
    if (r.violations !== w.riskEvidence.length) errors.push("风险证据数量不一致");
    if (w.config.assessmentVersion) {
      if (
        r.generationProfile !== w.config.generationProfile ||
        canonical(r.process) !== canonical(buildProcessReport(w)) ||
        canonical(r.outcomes) !==
          canonical(
            classifyTokenOutcomes(w, (token, amount) => ({
              ...poolQuote(token, "sell", amount),
              gas: gasFor(w, token.chain),
            })),
          )
      )
        errors.push("过程评分或项目归因与原始世界证据不一致");
    }
    if (
      r.events.some(
        (e) =>
          !w.events.some(
            (source) =>
              source.id === e.id &&
              source.seq === e.seq &&
              source.type === e.type &&
              source.message === e.message,
          ),
      )
    )
      errors.push("报告引用不存在的世界事件");
  }
  return errors;
}
export const worldSchema = worldBase.superRefine((candidate, ctx) => {
  try {
    for (const message of semanticIssues(candidate as unknown as World))
      ctx.addIssue({ code: "custom", message });
  } catch {
    ctx.addIssue({ code: "custom", message: "金额或关联数据无效" });
  }
});
export function validateWorld(value: unknown): value is World {
  return worldSchema.safeParse(value).success;
}
export type Checkpoint = {
  version: 1;
  world: World | null;
  reports: WorldReport[];
  speed: number;
  selectedId: string | null;
  revision: number;
  archives?: World[];
};
const checkpointSchema = z
  .object({
    version: z.literal(1),
    world: worldSchema.nullable(),
    reports: z.array(reportSchema).max(1000),
    speed: z.union([z.literal(1), z.literal(10), z.literal(30), z.literal(60)]),
    selectedId: id.nullable(),
    revision: count,
    archives: z.array(worldSchema).max(1000).optional(),
  })
  .passthrough();
export function validateCheckpoint(value: unknown): value is Checkpoint {
  const parsed = checkpointSchema.safeParse(value);
  if (!parsed.success) return false;
  const cp = parsed.data;
  if (
    !unique(cp.reports.map((r) => r.worldId)) ||
    (cp.archives && !unique(cp.archives.map((w) => w.id)))
  )
    return false;
  if (cp.archives) {
    const evidence = new Map(cp.archives.map((w) => [w.id, w]));
    if (cp.world?.report) {
      const archived = evidence.get(cp.world.id);
      if (archived?.report && canonical(archived.report) !== canonical(cp.world.report))
        return false;
      evidence.set(cp.world.id, cp.world);
    }
    for (const r of cp.reports) {
      const w = evidence.get(r.worldId);
      if (!w?.report || canonical(r) !== canonical(w.report)) return false;
    }
  }
  return true;
}
export function compactArchive(world: World): World {
  return {
    ...world,
    tokens: world.tokens.map((t) => ({ ...t, history: t.history.slice(-2) })),
    equity: world.equity.filter((_, i) => i % 4 === 0 || i === world.equity.length - 1),
  };
}
let dbPromise: Promise<IDBDatabase> | null = null;
export function worldDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("此浏览器不支持本地训练存储"));
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("td-market-world", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["state", "history", "imports"])
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error("无法打开训练存储"));
      };
      request.onblocked = () => reject(new Error("请关闭旧版训练标签后重试"));
    });
  return dbPromise;
}
export async function readRecord<T>(store: string, key: string): Promise<T | undefined> {
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error ?? new Error("训练记录读取失败"));
  });
}
export async function writeRecord(store: string, key: string, data: unknown): Promise<void> {
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("训练记录写入中断"));
    tx.onabort = () => reject(tx.error ?? new Error("写入中断"));
  });
}
export async function deleteRecord(store: string, key: string): Promise<void> {
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("训练记录删除中断"));
  });
}
export async function readArchives(): Promise<World[]> {
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("history", "readonly").objectStore("history").getAll();
    r.onsuccess = () => {
      const data = r.result as unknown[];
      if (data.some((w) => !validateWorld(w))) {
        reject(new Error("历史训练世界损坏，未静默丢弃任何世界，请保留数据后恢复"));
        return;
      }
      resolve(data as World[]);
    };
    r.onerror = () => reject(r.error ?? new Error("历史训练记录读取失败"));
  });
}
/** Read the state and every archive from the same IDB transaction/revision. */
export async function readConsistentSnapshot(): Promise<Checkpoint | undefined> {
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "history"], "readonly"),
      state = tx.objectStore("state").get("current"),
      history = tx.objectStore("history").getAll();
    tx.oncomplete = () => {
      const archives = history.result as unknown[];
      if (state.result === undefined) {
        if (archives.length) {
          reject(new Error("历史存在但当前检查点缺失，请保留数据后恢复"));
          return;
        }
        resolve(undefined);
        return;
      }
      const snapshot = { ...(state.result as Record<string, unknown>), archives };
      if (!validateCheckpoint(snapshot)) {
        reject(new Error("完整训练快照校验失败，未忽略坏档或缺失证据"));
        return;
      }
      resolve(snapshot);
    };
    tx.onerror = () => reject(tx.error ?? new Error("训练快照读取失败"));
    tx.onabort = () => reject(tx.error ?? new Error("训练快照读取中断"));
  });
}
export async function saveCheckpoint(state: Checkpoint, previousRevision: number): Promise<void> {
  if (!validateCheckpoint(state)) throw new Error("拒绝保存无效训练检查点，已保留原数据");
  if (
    !Number.isSafeInteger(previousRevision) ||
    previousRevision < 0 ||
    state.revision !== previousRevision + 1
  )
    throw new Error("检查点版本无效");
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "history"], "readwrite");
    const table = tx.objectStore("state");
    const r = table.get("current");
    r.onsuccess = () => {
      const prior = r.result as Checkpoint | undefined;
      if (prior ? prior.revision !== previousRevision : previousRevision !== 0) {
        tx.abort();
        return;
      }
      const { archives, ...checkpoint } = state;
      table.put(checkpoint, "current");
      const history = tx.objectStore("history");
      if (archives) {
        history.clear();
        for (const archived of archives) history.put(compactArchive(archived), archived.id);
      }
      if (state.world?.report) history.put(compactArchive(state.world), state.world.id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("检查点写入中断，原存档保持不变"));
    tx.onabort = () => reject(new Error("本地状态已变化，请重新载入或接管训练"));
  });
}

export type RawWorldSnapshot = {
  current: unknown;
  history: { key: IDBValidKey; value: unknown }[];
};
/** Preserve broken records byte-for-byte at the structured-clone level. */
export async function readRawWorldSnapshot(): Promise<RawWorldSnapshot> {
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "history"], "readonly");
    const current = tx.objectStore("state").get("current"),
      keys = tx.objectStore("history").getAllKeys(),
      values = tx.objectStore("history").getAll();
    tx.oncomplete = () =>
      resolve({
        current: current.result,
        history: keys.result.map((key, i) => ({ key, value: values.result[i] })),
      });
    tx.onerror = () => reject(tx.error ?? new Error("原存档读取中断"));
    tx.onabort = () => reject(tx.error ?? new Error("原存档读取中断"));
  });
}
/** Internal rollback only; raw records must never be used as accepted training evidence. */
export async function restoreRawWorldSnapshot(raw: RawWorldSnapshot): Promise<void> {
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "history"], "readwrite"),
      state = tx.objectStore("state"),
      history = tx.objectStore("history");
    if (raw.current === undefined) state.delete("current");
    else state.put(raw.current, "current");
    history.clear();
    for (const item of raw.history) history.put(item.value, item.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("原存档回滚中断"));
    tx.onabort = () => reject(tx.error ?? new Error("原存档回滚中断"));
  });
}
/** Only used after the old data and both databases have been quarantined. */
export async function writeRecoveredCheckpoint(data: Checkpoint): Promise<Checkpoint> {
  if (!validateCheckpoint(data)) throw new Error("恢复数据无效，未写入");
  const db = await worldDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "history"], "readwrite"),
      state = tx.objectStore("state"),
      history = tx.objectStore("history"),
      prior = state.get("current");
    let saved: Checkpoint;
    prior.onsuccess = () => {
      const n = (prior.result as { revision?: unknown } | undefined)?.revision;
      const revision =
        typeof n === "number" &&
        Number.isSafeInteger(n) &&
        n >= 0 &&
        n < Number.MAX_SAFE_INTEGER - 1
          ? n + 1
          : 1;
      saved = { ...data, revision };
      const { archives, ...checkpoint } = saved;
      state.put(checkpoint, "current");
      history.clear();
      for (const archive of archives ?? []) history.put(compactArchive(archive), archive.id);
      if (saved.world?.report) history.put(compactArchive(saved.world), saved.world.id);
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(tx.error ?? new Error("有效备份写入中断"));
    tx.onabort = () => reject(tx.error ?? new Error("有效备份写入中断"));
  });
}
