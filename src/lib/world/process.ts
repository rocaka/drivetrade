import { units } from "./amount.ts";
import type {
  Atom,
  ProcessCheck,
  ProcessReport,
  Quote,
  Token,
  TokenOutcome,
  TradePlan,
  TradeProcessEvidence,
  Transaction,
  World,
} from "./types.ts";

export const PLAN_EVIDENCE = [
  "lp",
  "permissions",
  "liquidity",
  "concentration",
  "momentum",
] as const;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
function price(token: Token) {
  const x =
    BigInt(token.pool.token) + (token.pool.kind === "curve" ? BigInt(token.pool.virtualToken) : 0n);
  const y =
    BigInt(token.pool.quote) + (token.pool.kind === "curve" ? BigInt(token.pool.virtualQuote) : 0n);
  return x > 0n ? Number(y) / Number(x) : 0;
}
export function validateTradePlan(plan: TradePlan, currentPrice: number): boolean {
  return (
    !!plan &&
    plan.version === "plan-v1" &&
    ["flow", "probe", "scale"].includes(plan.thesis) &&
    [
      plan.maxLossUsd,
      plan.invalidationPrice,
      plan.targetPrice,
      plan.maxHoldSeconds,
      plan.maxImpactPct,
    ].every(Number.isFinite) &&
    plan.maxLossUsd > 0 &&
    plan.maxLossUsd <= 1e12 &&
    plan.invalidationPrice > 0 &&
    plan.invalidationPrice < currentPrice &&
    plan.targetPrice > currentPrice &&
    plan.targetPrice <= 1e12 &&
    Number.isInteger(plan.maxHoldSeconds) &&
    plan.maxHoldSeconds >= 30 &&
    plan.maxHoldSeconds <= 3600 &&
    plan.maxImpactPct > 0 &&
    plan.maxImpactPct <= 20 &&
    Array.isArray(plan.evidence) &&
    plan.evidence.length >= 1 &&
    plan.evidence.length <= PLAN_EVIDENCE.length &&
    new Set(plan.evidence).size === plan.evidence.length &&
    plan.evidence.every((key) => PLAN_EVIDENCE.includes(key as (typeof PLAN_EVIDENCE)[number]))
  );
}
export function captureTradeProcess(
  w: World,
  token: Token,
  quote: Quote,
  equityUsd: number,
  gasForChain?: (chain: Token["chain"]) => Atom,
): TradeProcessEvidence {
  const current = price(token);
  const earlier = token.history.filter((sample) => sample.t <= w.now - 60).at(-1);
  const evidence: TradeProcessEvidence = {
    version:
      w.config.assessmentVersion === "process-v2-trading" ? "process-v2-trading" : "process-v1",
    at: w.now,
    price: current,
    equityUsd,
    amountUsd: (units(quote.amountIn) + units(quote.gas)) * w.fx[token.chain],
    impactPct: quote.impactPct,
    liquidityUsd: units(token.pool.quote) * w.fx[token.chain],
    creatorPct:
      (Number(BigInt(token.creatorTokens)) / Math.max(1, Number(BigInt(token.supply)))) * 100,
    holders: token.holders,
    momentumPct: earlier && earlier.price > 0 ? (current / earlier.price - 1) * 100 : 0,
    existingQuantity: w.positions[token.id]?.quantity ?? "0",
    sellable: !token.frozen && token.status !== "dead" && BigInt(token.pool.quote) > 0n,
    permissions: {
      lpLocked: token.pool.lpLocked,
      mint: token.mintAuthority,
      freeze: token.freezeAuthority,
      mutableTax: token.taxMutable,
    },
  };
  if (w.config.assessmentVersion === "process-v2-trading") {
    let projectUsd = evidence.amountUsd,
      clusterUsd = evidence.amountUsd,
      totalUsd = evidence.amountUsd;
    for (const position of Object.values(w.positions)) {
      const value = units(position.costUsd);
      totalUsd += value;
      if (position.tokenId === token.id) projectUsd += value;
      if (w.tokens.find((item) => item.id === position.tokenId)?.creatorId === token.creatorId)
        clusterUsd += value;
    }
    for (const pending of w.transactions)
      if (pending.type === "buy" && pending.status === "pending") {
        const value =
          (units(pending.amount) + units(gasForChain?.(pending.chain) ?? quote.gas)) *
          w.fx[pending.chain];
        totalUsd += value;
        if (pending.tokenId === token.id) projectUsd += value;
        if (w.tokens.find((item) => item.id === pending.tokenId)?.creatorId === token.creatorId)
          clusterUsd += value;
      }
    evidence.origin = "automatic-snapshot";
    evidence.guide = {
      origin: "training-preset",
      version: "guide-v1",
      stopPrice: current * 0.85,
      targetPrice: current * 1.3,
      maxHoldSeconds: 900,
    };
    evidence.exposure = { projectUsd, clusterUsd, totalUsd };
  }
  return evidence;
}
export function markProcessExit(w: World, tokenId: string, exitId: string) {
  const trading = w.config.assessmentVersion === "process-v2-trading";
  const exit = trading ? w.transactions.find((tx) => tx.id === exitId) : undefined;
  if (trading ? exit?.source === "settlement" : exitId.startsWith(`final-${w.id}-`)) return;
  for (const tx of w.transactions) {
    const evidence = tx.process;
    if (
      tx.type === "buy" &&
      tx.tokenId === tokenId &&
      evidence?.remaining &&
      BigInt(evidence.remaining) > 0n &&
      (trading ? true : evidence.exitAttemptAt === undefined)
    ) {
      if (trading && exit?.source === "safety") {
        if (evidence.automaticExitAt === undefined) {
          evidence.automaticExitAt = w.now;
          evidence.automaticExitTransactionId = exitId;
        }
        continue;
      }
      if (trading && exit?.source !== "manual") continue;
      if (evidence.exitAttemptAt !== undefined) continue;
      evidence.exitAttemptAt = w.now;
      evidence.exitTransactionId = exitId;
    }
  }
}
export function recordProcessFill(w: World, tx: Transaction, quote: Quote, gasUsd: number) {
  if (tx.type === "buy" && tx.process) {
    Object.assign(tx.process, {
      confirmedAt: w.now,
      filledCostUsd: units(tx.amount) * w.fx[tx.chain] + gasUsd,
      filledImpactPct: quote.impactPct,
      quantity: quote.amountOut,
      remaining: quote.amountOut,
    });
    if (tx.process.version === "process-v2-trading")
      tx.process.buyFeesUsd = gasUsd + units(quote.fee) * w.fx[tx.chain];
  } else if (tx.type === "sell") {
    let left = BigInt(tx.amount);
    for (const lot of w.transactions) {
      const evidence = lot.process;
      if (lot.type !== "buy" || lot.tokenId !== tx.tokenId || !evidence?.remaining || left <= 0n)
        continue;
      const quantity = BigInt(evidence.remaining),
        used = quantity < left ? quantity : left;
      evidence.remaining = (quantity - used).toString();
      left -= used;
      if (used > 0n && evidence.version === "process-v2-trading") {
        evidence.sellFeesUsd =
          (evidence.sellFeesUsd ?? 0) +
          ((gasUsd + units(quote.fee) * w.fx[tx.chain]) * Number(used)) / Number(BigInt(tx.amount));
        if (tx.source === "manual") {
          evidence.manualReduced = (BigInt(evidence.manualReduced ?? "0") + used).toString();
          if (evidence.manualExitConfirmedAt === undefined) {
            evidence.manualExitConfirmedAt = w.now;
            evidence.manualExitConfirmedId = tx.id;
          }
        }
      }
      if (used > 0n && evidence.remaining === "0") {
        evidence.closedAt = w.now;
        if (evidence.version === "process-v2-trading") evidence.closedBy = tx.source;
      }
    }
  }
}
export function recordFailedTradingExit(w: World, tx: Transaction) {
  if (
    w.config.assessmentVersion !== "process-v2-trading" ||
    tx.type !== "sell" ||
    !(tx.feeUsd && tx.feeUsd > 0)
  )
    return;
  const lots = w.transactions.filter(
    (lot) =>
      lot.type === "buy" &&
      lot.tokenId === tx.tokenId &&
      lot.status === "confirmed" &&
      lot.process?.version === "process-v2-trading" &&
      BigInt(lot.process.quantity ?? "0") > 0n,
  );
  const total = lots.reduce((sum, lot) => sum + Number(BigInt(lot.process!.quantity!)), 0);
  for (const lot of lots)
    lot.process!.sellFeesUsd =
      (lot.process!.sellFeesUsd ?? 0) +
      (tx.feeUsd * Number(BigInt(lot.process!.quantity!))) / total;
}
/** The exact simulated tick captures first crossing; later 15s chart sampling cannot erase it. */
export function trackProcessTriggers(w: World) {
  if (!w.config.assessmentVersion || w.phase === "settling") return;
  for (const tx of w.transactions) {
    const evidence = tx.process,
      plan = tx.plan;
    const guide = evidence?.version === "process-v2-trading" ? evidence.guide : undefined;
    if (
      tx.type !== "buy" ||
      (!plan && !guide) ||
      !evidence?.remaining ||
      BigInt(evidence.remaining) <= 0n ||
      evidence.triggerAt !== undefined
    )
      continue;
    const token = w.tokens.find((t) => t.id === tx.tokenId);
    if (!token) continue;
    const current = price(token);
    const trigger =
      current <= (guide?.stopPrice ?? plan!.invalidationPrice)
        ? "stop"
        : current >= (guide?.targetPrice ?? plan!.targetPrice)
          ? "target"
          : w.now >=
              (evidence.confirmedAt ?? tx.executeAt) +
                (guide?.maxHoldSeconds ?? plan!.maxHoldSeconds)
            ? "timeout"
            : undefined;
    if (trigger) {
      evidence.triggerAt = w.now;
      evidence.trigger = trigger;
      // A prior partial/failed reduction is not evidence of handling this later trigger.
      if (
        evidence.exitAttemptAt !== undefined &&
        evidence.exitAttemptAt < w.now &&
        !(evidence.version === "process-v2-trading" && BigInt(evidence.manualReduced ?? "0") > 0n)
      ) {
        delete evidence.exitAttemptAt;
        delete evidence.exitTransactionId;
      }
    }
  }
}
const corrections = {
  plan: "入场前冻结失效价、目标价与最长持有时间，不根据后来的涨跌改写计划。",
  budget: "按整笔投入加链费计算全损预算，控制在本场权益的1%以内。",
  evidence: "入场前核对权限、池深度和持币集中度，并保留当时的公开快照。",
  thesis: "让实际资金流、小额验证或已有持仓与选择的入场依据一致。",
  impact: "降低单笔规模，让真实成交冲击符合事先设定的上限。",
  exit: "失效、止盈或最长持有时间触发后及时提交退出，保留失败交易证据。",
} as const;
export function buildProcessReport(w: World): ProcessReport {
  if (w.config.assessmentVersion === "process-v2-trading") return buildTradingProcessReport(w);
  const decisions = w.transactions.filter((tx) => tx.type === "buy" && tx.status === "confirmed");
  const checks: ProcessCheck[] = [],
    weaknesses: string[] = [];
  for (const tx of decisions) {
    const plan = tx.plan,
      e = tx.process;
    const refs = w.events
      .filter((event) => event.commandId === tx.id || event.commandId === e?.exitTransactionId)
      .map((event) => event.id);
    const add = (
      kind: keyof typeof corrections,
      label: string,
      passed: boolean | null,
      detail: string,
      weight: number,
    ) => {
      checks.push({
        id: `${tx.id}:${kind}`,
        label,
        passed,
        detail,
        weight,
        transactionId: tx.id,
        eventIds: refs,
      });
      if (passed === false && !weaknesses.includes(corrections[kind]))
        weaknesses.push(corrections[kind]);
    };
    const valid = !!e && !!plan && validateTradePlan(plan, e.price);
    add(
      "plan",
      "冻结交易计划",
      valid,
      valid ? "提交前已冻结数值计划，保留原始报价与公开条件。" : "缺少可核对的原始交易计划。",
      15,
    );
    if (!valid || !plan || !e) {
      continue;
    }
    const cost = e.filledCostUsd ?? e.amountUsd;
    add(
      "budget",
      "全损预算",
      e.amountUsd <= Math.min(plan.maxLossUsd, e.equityUsd * 0.01) + 0.000002,
      `提交时投入及链费 $${e.amountUsd.toFixed(2)}；实际成交成本 $${cost.toFixed(2)}；冻结全损预算 $${plan.maxLossUsd.toFixed(2)}，入场权益1%为 $${(e.equityUsd * 0.01).toFixed(2)}。只评价实际冻结投入，排队后的汇率变化不作为主动越界。`,
      20,
    );
    const riskKeys =
      e.creatorPct > 20
        ? ["permissions", "liquidity", "concentration"]
        : ["permissions", "liquidity"];
    add(
      "evidence",
      "公开条件核对",
      plan.evidence.length >= 3 && riskKeys.every((key) => plan.evidence.includes(key)),
      `已冻结${plan.evidence.length}项检查；创建者占比 ${e.creatorPct.toFixed(1)}%，池深度 $${e.liquidityUsd.toFixed(2)}。这些不是安全保证。`,
      15,
    );
    const fits =
      plan.thesis === "probe"
        ? e.amountUsd <= e.equityUsd * 0.0025 + 0.000002
        : plan.thesis === "scale"
          ? BigInt(e.existingQuantity) > 0n
          : e.momentumPct > 0 && e.holders >= 3 && e.liquidityUsd >= e.amountUsd * 20;
    add(
      "thesis",
      "入场依据与事实",
      fits,
      plan.thesis === "probe"
        ? "小额验证要求整笔成本不超过入场权益的0.25%。"
        : plan.thesis === "scale"
          ? `提交前已有持仓 ${units(e.existingQuantity)}。`
          : `提交前60秒报价变化 ${e.momentumPct.toFixed(2)}%，持币地址 ${e.holders}，池深度/投入 ${(e.liquidityUsd / Math.max(0.000001, e.amountUsd)).toFixed(1)}倍。`,
      15,
    );
    add(
      "impact",
      "真实成交冲击",
      (e.filledImpactPct ?? e.impactPct) <= plan.maxImpactPct + 0.000001 && plan.maxImpactPct <= 5,
      `实际成交冲击 ${(e.filledImpactPct ?? e.impactPct).toFixed(2)}%；事先上限 ${plan.maxImpactPct}%，教学评分上限5%。`,
      15,
    );
    const exitOnTime =
      e.triggerAt === undefined
        ? e.exitAttemptAt === undefined
          ? null
          : true
        : e.exitAttemptAt !== undefined && e.exitAttemptAt <= e.triggerAt + 30;
    add(
      "exit",
      "退出计划执行",
      exitOnTime,
      e.triggerAt === undefined
        ? "观察窗口内未触发退出条件；系统期末平仓不充当主动执行证据。"
        : e.exitAttemptAt === undefined
          ? "退出条件已触发，但未及时提交退出；成交失败不等于没有尝试。"
          : `条件在 ${e.triggerAt} 秒触发，${e.exitAttemptAt} 秒已提交退出。只评价提交行为，权限或流动性造成的失败不扣执行分。`,
      20,
    );
  }
  if (!decisions.length) {
    checks.push({
      id: "no-decisions",
      label: "交易执行样本",
      passed: null,
      detail: "本场没有确认买入。等待可以是正确决定，但不能代替交易执行样本。",
      weight: 0,
      eventIds: [],
    });
    weaknesses.push("在预算内完成带冻结计划的买入和退出，积累可核对的执行样本。");
  }
  const applicable = checks.filter((check) => check.passed !== null);
  const denominator = decisions.length * 100;
  // Missing plans receive zero for the remaining dimensions as well.
  const earned = applicable
    .filter((check) => check.passed)
    .reduce((sum, check) => sum + check.weight, 0);
  const neutral = checks
    .filter((check) => check.passed === null)
    .reduce((sum, check) => sum + check.weight, 0);
  return {
    version: "process-v1",
    score: denominator > neutral ? Math.round((earned / (denominator - neutral)) * 100) : 0,
    decisions: decisions.length,
    checks,
    weaknesses,
  };
}

/** Fomo-style training: observe, choose size, buy and manage the position.
 * The snapshot/guide is generated by the simulator, never attributed to the user. */
function buildTradingProcessReport(w: World): ProcessReport {
  const decisions = w.transactions.filter((tx) => tx.type === "buy" && tx.status === "confirmed"),
    checks: ProcessCheck[] = [],
    weaknesses: string[] = [];
  const tips = {
    budget: "缩小买入金额，给单币和整个账户留出承受回撤的空间。",
    impact: "选流动性更充足的币，或减小金额，避免买入就产生过大价格冲击。",
    cost: "先看这笔交易的费用占比；小额频繁进出可能把涨幅都交给费用。",
    exit: "观察持仓后主动分批卖出；自动保护只负责兜底，不能代替自主交易。",
  };
  for (const tx of decisions) {
    const e = tx.process;
    const commandIds = new Set(
      [tx.id, e?.exitTransactionId, e?.manualExitConfirmedId, e?.automaticExitTransactionId].filter(
        (id): id is string => id !== undefined,
      ),
    );
    const refs = w.events
      .filter((event) => event.commandId !== undefined && commandIds.has(event.commandId))
      .map((event) => event.id);
    const add = (
      kind: keyof typeof tips,
      label: string,
      passed: boolean | null,
      detail: string,
      weight: number,
    ) => {
      checks.push({
        id: `${tx.id}:${kind}`,
        label,
        passed,
        detail,
        weight,
        transactionId: tx.id,
        eventIds: refs,
      });
      if (passed === false && !weaknesses.includes(tips[kind])) weaknesses.push(tips[kind]);
    };
    if (
      !e ||
      e.version !== "process-v2-trading" ||
      e.origin !== "automatic-snapshot" ||
      !e.exposure
    ) {
      add("budget", "买入金额", false, "缺少本次买入的自动报价快照。", 100);
      continue;
    }
    const exposure = e.exposure;
    add(
      "budget",
      "买入金额",
      exposure.projectUsd <= e.equityUsd * 0.01 + 0.000002 &&
        exposure.clusterUsd <= e.equityUsd * 0.03 + 0.000002 &&
        exposure.totalUsd <= e.equityUsd * 0.1 + 0.000002,
      `买入时单币总投入 $${exposure.projectUsd.toFixed(2)}；账户当时权益 $${e.equityUsd.toFixed(2)}。教学上限为单币1%、关联币3%、全账户新币10%，含待执行买单。`,
      35,
    );
    const impact = e.filledImpactPct ?? e.impactPct;
    add(
      "impact",
      "成交冲击",
      impact <= 5,
      `实际买入冲击 ${impact.toFixed(2)}%，教学参考上限5%。`,
      25,
    );
    const fees = (e.buyFeesUsd ?? 0) + (e.sellFeesUsd ?? 0),
      cost = e.filledCostUsd ?? e.amountUsd,
      feePct = cost > 0 ? (fees / cost) * 100 : 0;
    add(
      "cost",
      "真实费用",
      feePct <= 20,
      `这笔买入及已分摊卖出共计费用 $${fees.toFixed(2)}，占实际投入 ${feePct.toFixed(2)}%；教学参考上限20%。仅统计真实已付费用。`,
      20,
    );
    const manual = e.manualExitConfirmedId
      ? w.transactions.find(
          (exit) =>
            exit.id === e.manualExitConfirmedId &&
            exit.source === "manual" &&
            exit.status === "confirmed",
        )
      : undefined;
    const reduced = BigInt(e.manualReduced ?? "0") > 0n && !!manual;
    const timely =
      reduced && (e.triggerAt === undefined || manual!.submittedAt <= e.triggerAt + 30);
    add(
      "exit",
      "自主卖出",
      reduced ? timely : null,
      reduced
        ? `已自主减仓 ${units(e.manualReduced!)} 枚；${timely ? "在教学观察边界前或及时提交" : "提交晚于教学观察边界"}。`
        : e.automaticExitAt !== undefined || e.closedBy === "safety"
          ? "本次由系统教学保护尝试退出。安全网保留，但不计自主卖出能力。"
          : e.closedBy === "settlement"
            ? "本次由期末结算退出，不计自主卖出能力。"
            : "尚无已确认的自主减仓；权限或流动性导致的退出失败不当作个人违规。",
      20,
    );
    if (!reduced && !weaknesses.includes(tips.exit)) weaknesses.push(tips.exit);
  }
  if (!decisions.length) {
    checks.push({
      id: "no-decisions",
      label: "交易样本",
      passed: null,
      detail: "本场没有买入。等待可以是正确选择，后续通过真实买卖积累交易样本。",
      weight: 0,
      eventIds: [],
    });
    weaknesses.push("在愿意承受的模拟金额内，完成买入、观察与自主卖出。");
  }
  const neutral = checks
      .filter((check) => check.passed === null)
      .reduce((sum, check) => sum + check.weight, 0),
    denominator = decisions.length * 100 - neutral;
  const earned = checks
    .filter((check) => check.passed === true)
    .reduce((sum, check) => sum + check.weight, 0);
  return {
    version: "process-v2-trading",
    score: denominator > 0 ? Math.round((earned / denominator) * 100) : 0,
    decisions: decisions.length,
    checks,
    weaknesses,
  };
}
/** Settlement-only educational labels, based solely on executed events and public state. */
export function classifyTokenOutcomes(
  w: World,
  quoteSell: (token: Token, amount: Atom) => Quote,
): TokenOutcome[] {
  if (w.phase !== "completed") return [];
  const byToken = new Map<string, World["events"]>();
  for (const event of w.events)
    if (event.tokenId && event.at <= w.now) {
      const events = byToken.get(event.tokenId) ?? [];
      events.push(event);
      byToken.set(event.tokenId, events);
    }
  return w.tokens.map((token) => {
    const current = price(token),
      age = Math.max(0, w.now - token.bornAt),
      liquidity = units(token.pool.quote) * w.fx[token.chain];
    const returnPct = token.initialPrice > 0 ? (current / token.initialPrice - 1) * 100 : 0,
      peakReturnPct = token.initialPrice > 0 ? (token.peakPrice / token.initialPrice - 1) * 100 : 0;
    const events = byToken.get(token.id) ?? [];
    const attacks = events.filter((event) => {
      const effect = event.effect;
      if (!effect || !/^(0|[1-9]\d*)$/.test(effect.before) || !/^(0|[1-9]\d*)$/.test(effect.after))
        return false;
      const before = BigInt(effect.before),
        after = BigInt(effect.after);
      return (
        (event.type === "liquidity_removed" &&
          effect.field === "pool_quote" &&
          !token.pool.lpLocked &&
          before > 0n &&
          after <= before / 10n) ||
        (event.type === "permission_used" &&
          effect.field === "frozen" &&
          before === 0n &&
          after === 1n &&
          token.freezeAuthority &&
          token.frozen) ||
        (event.type === "tax_changed" &&
          effect.field === "sell_tax_bps" &&
          after > before &&
          after >= 9000n &&
          token.taxMutable &&
          token.sellTaxBps >= 9000) ||
        (event.type === "supply_changed" &&
          effect.field === "supply" &&
          after > before &&
          token.mintAuthority &&
          BigInt(token.supply) >= after)
      );
    });
    const quantity =
      current > 0 ? Math.min(units(token.supply), 100 / (current * w.fx[token.chain])) : 0;
    const amount =
      Number.isFinite(quantity) && quantity > 0
        ? BigInt(Math.floor(quantity * 1e6)).toString()
        : "0";
    const quote = quoteSell(token, amount);
    const standardExitUsd = quote.ok
      ? Math.max(0, (units(quote.amountOut) - units(quote.gas)) * w.fx[token.chain])
      : 0;
    const sellable = quote.ok && standardExitUsd > 0;
    let classification: TokenOutcome["classification"] = "insufficient",
      label = "观察不足",
      reason = "当前样本不足以判断长期质量，涨跌本身不能证明项目好坏。";
    if (attacks.length) {
      classification = "rug";
      label = "已发生权限／流动性攻击";
      reason = `已执行事件：${attacks.map((event) => event.message).join("；")}`;
    } else if (events.some((event) => event.type === "large_holder_sell") || returnPct <= -50) {
      classification = "dump";
      label = "大户抛售／大幅回撤";
      reason = "有实际大户卖出或显著回撤证据；不把普通下跌自动称为rug。";
    } else if (
      !token.easterEgg &&
      age >= 1800 &&
      returnPct >= 200 &&
      liquidity >= 5000 &&
      standardExitUsd >= 80 &&
      current >= token.peakPrice * 0.5
    ) {
      classification = "quality";
      label = "教学金狗样本";
      reason =
        "观察至少30分钟，当前涨幅≥200%、池深度≥$5,000，标准$100票面净退出≥$80，且未发生权限攻击。仅限本模型。";
    } else if (peakReturnPct >= 200) {
      classification = "speculative";
      label = "高波动投机样本";
      reason = "曾有较大涨幅，但持续性、深度、退出能力或当前回撤未满足教学质量条件。";
    } else if (
      token.trades <= 3 ||
      ((token.lastTradeAt ?? token.bornAt) < w.now - 900 && liquidity < 1000)
    ) {
      classification = "inactive";
      label = "低活跃样本";
      reason = "实际交易稀少或长时间缺少交易与有效深度。";
    }
    return {
      tokenId: token.id,
      symbol: token.symbol,
      classification,
      label,
      reason,
      returnPct: round(returnPct),
      peakReturnPct: round(peakReturnPct),
      ageSeconds: age,
      liquidityUsd: round(liquidity),
      standardExitUsd: round(standardExitUsd),
      sellable,
      eventIds: events
        .filter((event) =>
          attacks.length ? attacks.includes(event) : event.type === "large_holder_sell",
        )
        .map((event) => event.id),
    };
  });
}
