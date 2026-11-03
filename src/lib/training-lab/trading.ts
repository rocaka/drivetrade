import { z } from "zod";
import * as legacy from "./legacy.ts";
import type {
  LabAction,
  LabChallenge,
  LabCheck,
  LabEntry,
  LabResult,
  LabState,
  LabToken,
  LabTradePlan,
} from "./types.ts";

const lessonIds = [
  ...[4, 7, 10, 11, 3, 14, 18, 20, 7, 15, 17, 24].map((n) => `trade-lesson-${n}`),
  ...[3, 8, 9, 2].map((n) => `profit-lesson-${n}`),
];
const specs = [
  [
    "先定仓位",
    "用小仓位开始，给退出留余地。",
    "本关最多投入8美元。小额买入，再卖出，感受费用对结果的影响。",
    1,
  ],
  [
    "等到入场区",
    "涨起来时，仍然按自己的价位等。",
    "别追着上涨买。等价格回到画出的买入区，再买入和卖出。",
    2,
  ],
  [
    "失效就离场",
    "计划可以亏，退出不能凭情绪改。",
    "开场已有仓位。跌到画出的撤退价，就在下一步观察前卖出。",
    7,
  ],
  [
    "分批兑现",
    "到目标先兑现一部分，再处理余仓。",
    "开场已有仓位。到画出的目标先卖一部分，再处理剩下的仓位。",
    8,
  ],
  [
    "等值得做的机会",
    "有利润空间，才值得付出风险。",
    "现在的位置不划算。等回到买入区，再用小额买入和卖出。",
    6,
  ],
  [
    "成本决定能不能做",
    "同样的金额，先比较两种报价。",
    "同样买4美元，先看看预计到手和费用，选更划算的一项买入再卖出。",
    5,
  ],
  [
    "连亏之后停手",
    "下一笔没有义务替上一笔回本。",
    "开场已经触发日停止线。减掉已有仓位，观察四步，保持不加码。",
    15,
  ],
  [
    "把共同风险加起来",
    "三笔仓位，也可能只有一种风险。",
    "三个关联项目合计投入24美元；实际减仓至关联成本不超过10美元。",
    11,
  ],
  [
    "挑机会，也放弃机会",
    "只做满足条件的那一笔。",
    "有的涨得急，有的在走弱。先观察，再选一项更平稳、费用更低的机会交易。",
    4,
  ],
  [
    "等订单给出结果",
    "还没成交，就先别再按一次。",
    "开场已有一笔未成交买单。先等它出结果，再决定下一笔买入和卖出。",
    13,
  ],
  [
    "连续两笔守同一规则",
    "把一次做对，练成可以重复的流程。",
    "先把A项目买入并卖完，再对B项目重复一次，不同时越买越多。",
    12,
  ],
  [
    "用记录检验自己",
    "回到当时的计划，核对实际发生了什么。",
    "完成一次小额买入和卖出，回看入场、退出和扣费后的真实结果。",
    16,
  ],
  // Advanced track: optional, scored separately from the 12 required exercises.
  [
    "按 1R 算仓位",
    "风险预算决定买多少，不是心情。",
    "本关每笔最多承担 $1 风险：投入 × 跌到先撤价的跌幅 + 往返费用 ≤ $1。按这个算出金额买入，再卖出。",
    3,
  ],
  [
    "保本保护余仓",
    "目标先兑现一部分，余仓不让它变亏。",
    "开场已有仓位。到目标先卖一部分；之后若回落到成本附近，就把余仓卖掉，别让盈利单变成亏损单。",
    8,
  ],
  [
    "时间止损",
    "该动没动，就按时离场。",
    "买入后最多持有 4 步（2分钟）。行情横着不动、没到目标，就按时卖出，不硬等。",
    9,
  ],
  [
    "三笔同样的风险",
    "止损远就买少，每笔风险一样大。",
    "A、B、C 三个项目的先撤价远近不同。依次各做一笔，每笔风险控制在 $0.5–$1，做完一笔再做下一笔。",
    2,
  ],
] as const;
/** Exercise 16: stop distance per project (8%, 15%, 25%). */
const EQUAL_RISK_STOPS: Record<string, number> = { "token-a": 0.92, "token-b": 0.85 };
/** Exercises 1–12 count toward the practice requirement; 13+ are the advanced track. */
export const REQUIRED_LAB_COUNT = 12;
/** Most a single advanced trade may lose at the given stop, fees included. */
export const ADVANCED_RISK_CENTS = 100;
function labRules(i: number) {
  const budget =
    i === 7
      ? "关联持仓总投入上限 $10"
      : i === 12 || i === 15
        ? "每笔风险 ≤ $1：投入 × 跌到先撤价的跌幅 + 往返费用"
        : "单项目新增投入上限 $8（包含执行费）";
  return [
    budget,
    i === 14
      ? "买入后最多持有 4 步；到时没到目标就卖出"
      : "买入区、撤退价和目标由本关给出，不需要填写表格",
    "每步30模拟秒；成绩看实际交易行为，不要求每笔赚钱",
  ];
}
const ALL_TRADING_LABS: LabChallenge[] = specs.map((x, i) => ({
  id: `trade-practice-${i + 1}`,
  title: x[0],
  summary: x[1],
  goal: x[2],
  lessonId: lessonIds[i],
  maxSteps: 12,
  targetId: i === 5 || i === 8 ? "token-b" : "token-a",
  rules: labRules(i),
}));
export const TRADING_LAB_CHALLENGES = ALL_TRADING_LABS.slice(0, REQUIRED_LAB_COUNT);
export const ADVANCED_LAB_CHALLENGES = ALL_TRADING_LABS.slice(REQUIRED_LAB_COUNT);
const SCALE = 1_000_000,
  GAS = 10;
const clone = <T>(x: T): T => structuredClone(x);
const index = (s: LabState) => Number(s.challengeId.split("-").at(-1)) - 1;
const def = (id: string) => {
  const found = ALL_TRADING_LABS.find((c) => c.id === id);
  if (!found) throw new Error("交易实操关卡不存在");
  return found;
};
function emit(s: LabState, type: string, message: string, tokenId?: string, cents?: number) {
  s.events.push({
    step: s.step,
    type,
    message,
    ...(tokenId ? { tokenId } : {}),
    ...(cents === undefined ? {} : { cents }),
  });
}
function failure(s: LabState, message: string, tokenId?: string, breach = false) {
  s.facts.failedAttempts++;
  if (breach) s.trading!.riskBreaches.push(message);
  emit(s, "rejected", message, tokenId);
}
function baseToken(s: LabState, id: string, name: string, symbol: string, cash = 100000) {
  const source = clone(s.tokens[0]),
    p = legacy.labPrice(source);
  source.id = id;
  source.name = name;
  source.symbol = symbol;
  source.chain = "solana";
  source.address = `SIM-${id}`;
  source.cluster = "shared-theme";
  source.poolCash = cash;
  source.poolUnits = Math.floor((cash / (p * 100)) * SCALE);
  source.npcUnits = source.poolUnits * 4;
  source.initialPoolUnits = source.poolUnits * 5;
  source.initialPrice = legacy.labPrice(source);
  source.history = [{ step: 0, price: source.initialPrice }];
  source.curveRemainingCents = null;
  source.frozen = false;
  source.lockedLP = true;
  source.hype = 20;
  return source;
}
function npcMove(s: LabState, t: LabToken, targetPrice: number) {
  const ratio = targetPrice / legacy.labPrice(t);
  if (ratio > 1) {
    const cash = Math.min(
      s.marketCash[t.chain],
      Math.max(0, Math.floor(t.poolCash * (Math.sqrt(ratio) - 1))),
    );
    const units = Math.floor((t.poolUnits * cash) / (t.poolCash + cash));
    s.marketCash[t.chain] -= cash;
    t.poolCash += cash;
    t.poolUnits -= units;
    t.npcUnits += units;
  } else if (ratio > 0) {
    const units = Math.min(
      t.npcUnits,
      Math.max(0, Math.floor(t.poolUnits * (1 / Math.sqrt(ratio) - 1))),
    );
    const cash = Math.floor((t.poolCash * units) / (t.poolUnits + units));
    t.npcUnits -= units;
    t.poolUnits += units;
    t.poolCash -= cash;
    s.marketCash[t.chain] += cash;
  }
}
function seedHolding(s: LabState, t: LabToken, cents: number) {
  const units = Math.floor((t.poolUnits * cents) / (t.poolCash + cents));
  s.cash[t.chain] -= cents;
  t.poolCash += cents;
  t.poolUnits -= units;
  s.positions[t.id] = { units, costCents: cents };
}
export function createTradingLab(id: string, seed: string): LabState {
  def(id);
  const i = Number(id.split("-").at(-1)) - 1;
  const s = legacy.createLab("practice-1", seed);
  s.version = "lab-v2-trading";
  s.challengeId = id;
  s.cash = { solana: 99600, base: 0 };
  s.gas = { solana: 400, base: 0 };
  s.tokens = [baseToken(s, "token-a", "月面电台", "MOON", i === 5 || i === 8 ? 2000 : 100000)];
  if ([5, 7, 8, 10, 15].includes(i)) s.tokens.push(baseToken(s, "token-b", "松果计划", "PINE"));
  if (i === 7 || i === 8 || i === 15) s.tokens.push(baseToken(s, "token-c", "纸飞机", "PAPER"));
  s.trading = {
    actionCount: 0,
    plans: {},
    entries: [],
    exits: [],
    journals: [],
    skipped: [],
    riskBreaches: [],
    stopAt: {},
    targetAt: {},
    dailyStopped: i === 6,
    peakPositions: 0,
  };
  if (i === 1) {
    npcMove(s, s.tokens[0], s.tokens[0].initialPrice * 1.08);
    s.tokens[0].history.push({ step: -1, price: legacy.labPrice(s.tokens[0]) });
    npcMove(s, s.tokens[0], s.tokens[0].initialPrice * 1.18);
    s.tokens[0].history.push({ step: 0, price: legacy.labPrice(s.tokens[0]) });
  }
  if ([2, 3, 6, 13].includes(i)) seedHolding(s, s.tokens[0], 800);
  if (i === 7) for (const t of s.tokens) seedHolding(s, t, 800);
  if (i === 8) {
    npcMove(s, s.tokens[2], s.tokens[2].initialPrice * 0.84);
    s.tokens[2].history.push({ step: 0, price: legacy.labPrice(s.tokens[2]) });
    s.tokens[0].hype = 98;
  }
  if (i === 6) {
    s.cash.solana -= 3000;
    s.marketCash.solana += 3000;
    emit(s, "daily-stop", "开场条件：连续亏损后，日停止线已经触发。现在只允许减险与等待。");
  }
  for (const t of s.tokens) {
    if (i !== 1 && i !== 8) t.history = [{ step: 0, price: legacy.labPrice(t) }];
  }
  if (i === 9) {
    const q = tradingBuyQuote(s, s.tokens[0].id, 400);
    s.orders = [
      {
        id: 1,
        tokenId: s.tokens[0].id,
        cents: 400,
        minUnits: Math.floor(q.units * 0.995),
        dueStep: 2,
        deadline: 5,
        status: "pending",
        message: "开场已有挂单：等待市场给出执行结果",
      },
    ];
    emit(s, "queued", "开场挂单未执行；先等结果，再决定下一笔。", s.tokens[0].id);
  }
  for (const token of s.tokens) {
    const current = legacy.labPrice(token);
    const base = token.initialPrice;
    let entryPrice = current * 1.01,
      stopPrice = current * 0.88,
      targetPrice = current * 1.25;
    if (i === 1) {
      entryPrice = base * 0.98;
      stopPrice = base * 0.84;
      targetPrice = base * 1.25;
    }
    if (i === 3) targetPrice = current * 1.2;
    if (i === 4) {
      entryPrice = base * 0.96;
      stopPrice = base * 0.9;
      targetPrice = base * 1.3;
    }
    if (i === 9) {
      entryPrice = base * 2;
      stopPrice = base * 0.7;
      targetPrice = base * 2.5;
    }
    if (i === 12) {
      stopPrice = current * 0.8;
      targetPrice = current * 1.5;
    }
    if (i === 13) targetPrice = current * 1.2;
    if (i === 14) {
      stopPrice = current * 0.85;
      targetPrice = current * 1.3;
    }
    // Different stop distances, so equal risk needs different amounts.
    if (i === 15) stopPrice = current * (EQUAL_RISK_STOPS[token.id] ?? 0.75);
    s.trading.plans[token.id] = {
      entryPrice,
      stopPrice,
      targetPrice,
      maxCents: 800,
      maxHoldSteps: i === 14 ? 4 : 6,
      frozenAt: 0,
      actionIndex: 0,
      source: "system",
    };
  }
  s.trading.peakPositions = Object.values(s.positions).filter((p) => p.units > 0).length;
  s.initialEquityCents = legacy.labEquity(s);
  s.initialConservation = legacy.labConservation(s);
  return s;
}
export function tradingBuyQuote(s: LabState, tokenId: string, cents: number) {
  const t = s.tokens.find((t) => t.id === tokenId);
  if (!t || !Number.isInteger(cents) || cents <= 0)
    return { units: 0, impactPct: 0, cycleCostCents: 0 };
  const fee = Math.max(1, Math.ceil(cents * 0.0025)),
    net = cents - fee,
    units = Math.floor((t.poolUnits * net) / (t.poolCash + net));
  const average = units > 0 ? net / 100 / (units / SCALE) : Infinity;
  const impactPct = Math.max(0, (average / legacy.labPrice(t) - 1) * 100);
  const cashAfter = t.poolCash + net,
    unitsAfter = t.poolUnits - units,
    returned = Math.floor((cashAfter * units) / (unitsAfter + units));
  const exitFee = Math.max(1, Math.ceil(returned * 0.0025));
  return { units, impactPct, cycleCostCents: cents - Math.max(0, returned - exitFee) + GAS * 2 };
}
export function planRiskReward(
  plan: Pick<LabTradePlan, "entryPrice" | "stopPrice" | "targetPrice">,
  cents: number,
  cycleCostCents: number,
) {
  const risk = (cents * (plan.entryPrice - plan.stopPrice)) / plan.entryPrice + cycleCostCents,
    reward = (cents * (plan.targetPrice - plan.entryPrice)) / plan.entryPrice - cycleCostCents;
  return risk > 0 ? Math.max(0, reward / risk) : 0;
}
function delegated(s: LabState, action: LabAction) {
  const result = legacy.applyLabAction(
    { ...s, version: "lab-v1", challengeId: "practice-8" },
    action,
  );
  result.version = "lab-v2-trading";
  result.challengeId = s.challengeId;
  return result;
}
function entryCheck(s: LabState, t: LabToken, cents: number, fromQueue = false) {
  const e = s.trading!,
    plan = e.plans[t.id];
  if (e.dailyStopped) {
    s.facts.addedAfterStop = true;
    failure(s, "停止窗口仍在生效，下一笔先不做。", t.id, true);
    return false;
  }
  if (!plan) {
    failure(s, "本关交易条件尚未准备好，请返回重新进入。", t.id, true);
    return false;
  }
  if (cents + GAS > plan.maxCents || (s.positions[t.id]?.costCents ?? 0) + cents + GAS > 800) {
    failure(s, "这笔投入加费用超过本关额度，金额再小一点。", t.id, true);
    return false;
  }
  if (!fromQueue && legacy.labPrice(t) > plan.entryPrice * 1.000001) {
    failure(s, "现在还在买入区上方，先观察，别急着追。", t.id, true);
    return false;
  }
  if (legacy.labPrice(t) <= plan.stopPrice) {
    failure(s, "交易条件已经失效，不再新开仓。", t.id, true);
    return false;
  }
  return true;
}
function actualBuy(s: LabState, t: LabToken, cents: number, fromQueue = false) {
  if (!entryCheck(s, t, cents, fromQueue)) return s;
  const quote = tradingBuyQuote(s, t.id, cents),
    price = legacy.labPrice(t),
    before = s.facts.buyCount,
    plan = clone(s.trading!.plans[t.id]);
  const context = fromQueue
    ? {
        ...s,
        orders: s.orders.map((order) => ({
          ...order,
          status: order.status === "pending" ? ("expired" as const) : order.status,
        })),
      }
    : s;
  const next = delegated(context, {
    type: "buy",
    tokenId: t.id,
    cents,
    slippageBps: 500,
    ttlSteps: 6,
  });
  if (fromQueue) next.orders = clone(s.orders);
  if (next.facts.buyCount > before) {
    next.trading!.entries.push({
      tokenId: t.id,
      step: next.step,
      actionIndex: next.trading!.actionCount,
      cents,
      price,
      impactPct: quote.impactPct,
      estimatedCostCents: quote.cycleCostCents,
      riskReward: planRiskReward(plan, cents, quote.cycleCostCents),
      plan,
    });
    next.trading!.peakPositions = Math.max(
      next.trading!.peakPositions,
      Object.values(next.positions).filter((p) => p.units > 0).length,
    );
  }
  return next;
}
function advance(s: LabState): LabState {
  s.step++;
  const i = index(s);
  for (const t of s.tokens) {
    const base = t.initialPrice;
    if (i === 1 && t.id === "token-a" && s.step === 1) npcMove(s, t, base * 1.3);
    else if (i === 1 && t.id === "token-a" && s.step === 2) npcMove(s, t, base * 0.96);
    else if (i === 2 && s.step === 2) npcMove(s, t, base * 0.72);
    else if (i === 3 && s.step === 2) npcMove(s, t, base * 1.35);
    else if (i === 4 && s.step === 2) npcMove(s, t, base * 0.94);
    else if (i === 4 && s.step === 4) npcMove(s, t, base * 1.22);
    else if (i === 9 && s.step === 1) npcMove(s, t, base * 1.5);
    else if (i === 13 && [2, 4, 6, 7, 8].includes(s.step))
      npcMove(s, t, base * { 2: 1.3, 4: 1.45, 6: 1.08, 7: 0.9, 8: 0.8 }[s.step]!);
    else {
      const stable = 1 + (s.step % 2 ? -0.0015 : 0.001);
      npcMove(s, t, legacy.labPrice(t) * stable);
    }
    t.history.push({ step: s.step, price: legacy.labPrice(t) });
    const p = s.trading!.plans[t.id];
    if (p && (s.positions[t.id]?.units ?? 0) > 0) {
      if (legacy.labPrice(t) <= p.stopPrice && s.trading!.stopAt[t.id] === undefined) {
        s.trading!.stopAt[t.id] = s.step;
        emit(s, "stop-trigger", "已经跌到本关撤退价，先处理手里的仓位。", t.id);
      }
      if (legacy.labPrice(t) >= p.targetPrice && s.trading!.targetAt[t.id] === undefined) {
        s.trading!.targetAt[t.id] = s.step;
        emit(s, "target-trigger", "已经涨到本关目标，可以先卖一部分。", t.id);
      }
    }
  }
  for (const order of s.orders.filter((o) => o.status === "pending")) {
    if (s.step > order.deadline) {
      order.status = "expired";
      order.message = "订单过期，没有新增持仓，也未扣执行费";
      emit(s, "expired", order.message, order.tokenId);
    } else if (s.step >= order.dueStep) {
      const t = s.tokens.find((t) => t.id === order.tokenId)!,
        q = tradingBuyQuote(s, t.id, order.cents);
      if (q.units < order.minUnits) {
        order.status = "reverted";
        order.message = "执行价已偏离原条件；订单回退并记录0.10美元费用";
        if (s.gas[t.chain] >= GAS) {
          s.gas[t.chain] -= GAS;
          s.feesCents += GAS;
        }
        emit(s, "reverted", order.message, t.id);
      } else {
        const before = s.facts.buyCount;
        s = actualBuy(s, t, order.cents, true);
        const current = s.orders.find((o) => o.id === order.id)!;
        current.status = s.facts.buyCount > before ? "confirmed" : "reverted";
        current.message =
          current.status === "confirmed" ? "按新条件实际成交" : "执行条件未满足，未增加持仓";
      }
    }
  }
  if (s.step >= def(s.challengeId).maxSteps) s.finished = true;
  return s;
}
export function applyTradingLabAction(input: LabState, action: LabAction): LabState {
  if (input.finished) return input;
  let s = clone(input);
  const i = index(s),
    e = s.trading!;
  e.actionCount++;
  const t = "tokenId" in action ? s.tokens.find((t) => t.id === action.tokenId) : undefined;
  if ("tokenId" in action && !t) {
    failure(s, "项目不存在。");
    return s;
  }
  if (action.type === "trade-plan") {
    failure(s, "本关已经给出参考价位，只需选择金额、买入、卖出或观察。", t!.id);
  } else if (action.type === "journal") {
    if (!action.note.trim() || action.note.length > 240) {
      failure(s, "用一句自己的话记录当时计划或执行差异。");
      return s;
    }
    e.journals.push({
      phase: action.phase,
      note: action.note.trim(),
      step: s.step,
      actionIndex: e.actionCount,
      equityCents: legacy.labEquity(s),
      positionUnits: Object.values(s.positions).reduce((n, p) => n + p.units, 0),
      buyCount: s.facts.buyCount,
      sellCount: s.facts.sellCount,
    });
    emit(
      s,
      "journal",
      action.phase === "before"
        ? "交易前记录与当时账户快照已冻结。"
        : "交易后记录与实际执行快照已冻结。",
    );
  } else if (action.type === "skip") {
    if (!e.skipped.includes(t!.id)) e.skipped.push(t!.id);
    emit(s, "skipped", "这次机会先不做，保留资金和观察条件。", t!.id);
  } else if (action.type === "buy") {
    if (s.orders.some((o) => o.status === "pending")) {
      s.facts.duplicatePending = true;
      failure(s, "已有未执行订单，先等结果，不重复加单。", t!.id, true);
      return s;
    }
    if (!Number.isInteger(action.cents) || action.cents < 20) {
      failure(s, "请输入至少0.20美元的有效投入。");
      return s;
    }
    if (i === 9) {
      if (!entryCheck(s, t!, action.cents)) return s;
      const q = tradingBuyQuote(s, t!.id, action.cents);
      s.orders.push({
        id: s.orders.length + 1,
        tokenId: t!.id,
        cents: action.cents,
        minUnits: Math.floor(q.units * (1 - action.slippageBps / 10000)),
        dueStep: s.step + 2,
        deadline: s.step + action.ttlSteps,
        status: "pending",
        message: "新订单已确认，等待实际执行",
      });
      emit(s, "queued", "按本次计划提交，接下来观察执行结果。", t!.id);
    } else s = actualBuy(s, t!, action.cents);
  } else if (action.type === "sell") {
    const before = s.facts.sellCount,
      price = legacy.labPrice(t!),
      q = legacy.labSellQuote(s, t!.id, action.percent),
      p = e.plans[t!.id];
    s = delegated(s, action);
    if (s.facts.sellCount > before)
      s.trading!.exits.push({
        tokenId: t!.id,
        step: s.step,
        actionIndex: s.trading!.actionCount,
        percent: action.percent,
        remainingUnits: s.positions[t!.id]?.units ?? 0,
        price,
        netCents: q.netCents,
        targetReached: !!p && price >= p.targetPrice,
        stopReached: !!p && price <= p.stopPrice,
      });
  } else if (action.type === "wait") {
    if (!Number.isInteger(action.steps) || action.steps < 1 || action.steps > 4) {
      failure(s, "每次观察1到4步。");
      return s;
    }
    for (let n = 0; n < action.steps && !s.finished; n++) s = advance(s);
  } else if (action.type === "finish") {
    s.finished = true;
    emit(s, "finished", "实际交易过程已封存。");
  } else if (action.type === "plan") {
    failure(s, "本关价位已经给出，只需买入、卖出或继续观察。");
  } else s = delegated(s, action);
  return s;
}
/** Loss if the entry is sold at its stop, including the estimated round-trip cost. */
export function entryRiskCents(
  entry: Pick<LabEntry, "cents" | "price" | "estimatedCostCents" | "plan">,
) {
  if (!entry.plan || entry.price <= 0) return Infinity;
  return (
    (entry.cents * Math.max(0, entry.price - entry.plan.stopPrice)) / entry.price +
    entry.estimatedCostCents
  );
}
function check(id: string, title: string, passed: boolean, detail: string): LabCheck {
  return { id, title, passed, detail };
}
export function tradingLabResult(s: LabState): LabResult {
  const e = s.trading!,
    i = index(s),
    held = Object.values(s.positions).reduce((n, p) => n + p.units, 0),
    round = e.entries.length > 0 && e.exits.length > 0 && held === 0,
    entries = e.entries,
    primary = s.tokens.find((t) => t.id === def(s.challengeId).targetId)!;
  const budget =
    !s.facts.oversized &&
    !s.facts.addedAfterStop &&
    !s.facts.duplicatePending &&
    e.riskBreaches.length === 0;
  const checks = [
    check(
      "risk",
      "守住这关的额度与条件",
      budget,
      "仓位、入场条件、停止线和未成交订单都属于自己的执行边界。",
    ),
  ];
  let task = false,
    taskTitle = "",
    detail = "";
  if (i === 0) {
    task =
      round &&
      entries.every((x) => !!x.plan && x.cents + GAS <= x.plan.maxCents && x.plan.maxCents <= 800);
    taskTitle = "按给定额度完成一笔交易";
    detail = "投入和费用合计不超过8美元，并实际卖出。";
  }
  if (i === 1) {
    task = round && entries.every((x) => x.step >= 2 && x.price <= x.plan!.entryPrice * 1.000001);
    taskTitle = "实际等到自己的入场区";
    detail = "先观察回调，回到本关给出的买入区再下单。";
  }
  if (i === 2) {
    const at = e.stopAt[primary.id];
    task =
      at !== undefined &&
      e.exits.some((x) => x.tokenId === primary.id && x.step >= at && x.step - at <= 1) &&
      held === 0 &&
      !!e.plans[primary.id] &&
      e.plans[primary.id].frozenAt < at;
    taskTitle = "失效后一步内实际退出";
    detail = "参考撤退价触发后，下一步观察前卖出已有仓位。";
  }
  if (i === 3) {
    task =
      e.exits.some(
        (x) =>
          x.tokenId === primary.id && x.targetReached && x.percent < 100 && x.remainingUnits > 0,
      ) && held === 0;
    taskTitle = "到目标先兑现一部分";
    detail = "目标到达后先卖25%或50%，再处理剩余仓位。";
  }
  if (i === 4) {
    task = round && entries.every((x) => x.riskReward >= 2);
    taskTitle = "等到费用之后仍值得做的位置";
    detail = "价位更合适时再买，别被眼前涨幅催着下单。参考条件已经包含交易费用。";
  }
  if (i === 5) {
    task = round && entries.every((x) => x.tokenId === "token-b" && x.impactPct <= 2);
    taskTitle = "用实际报价选择低成本机会";
    detail = "同样的金额，选预计到手更划算、也更容易退出的一项。";
  }
  if (i === 6) {
    task = held === 0 && s.facts.sellCount > 0 && entries.length === 0 && s.step >= 4;
    taskTitle = "连续亏损后执行停止窗口";
    detail = "减掉已有风险并观察四步，不用下一笔追偿。";
  }
  if (i === 7) {
    task =
      Object.values(s.positions).reduce((sum, p) => sum + p.costCents, 0) <= 1000 &&
      e.exits.length > 0 &&
      entries.length === 0;
    taskTitle = "把关联总投入实际降回预算";
    detail = "合计成本降至10美元以内，不能只换项目名字。";
  }
  if (i === 8) {
    task = round && entries.every((x) => x.tokenId === "token-b") && s.step >= 1;
    taskTitle = "跳过差机会，只执行满足条件的一笔";
    detail = "高冲击和走弱项目先不做；对条件合适的B项目完成计划与退出。";
  }
  if (i === 9) {
    task =
      round &&
      s.orders.some((o) => o.id === 1 && (o.status === "reverted" || o.status === "expired")) &&
      s.orders.some((o) => o.id > 1 && o.status === "confirmed");
    taskTitle = "先核对挂单，再确认下一笔";
    detail = "等原单结果后，再按新条件确认并完成退出。";
  }
  if (i === 10) {
    const first = entries.find((x) => x.tokenId === "token-a"),
      second = entries.find((x) => x.tokenId === "token-b");
    task =
      round &&
      !!first &&
      !!second &&
      e.peakPositions <= 1 &&
      e.exits.some(
        (x) =>
          x.tokenId === "token-a" && x.remainingUnits === 0 && x.actionIndex < second.actionIndex,
      );
    taskTitle = "连续两笔都遵守同一流程";
    detail = "先完成A的退出，再对B重复计划与成交，不叠加持仓。";
  }
  if (i === 11) {
    task =
      round &&
      entries.every((x) => x.plan?.source === "system") &&
      e.exits.every((x) => Number.isInteger(x.netCents));
    taskTitle = "留下一笔完整的交易记录";
    detail =
      "系统自动记录当时买价、卖价、数量和实际费用；完成买入并全部卖出。文字笔记可选，不参与成绩。";
  }
  if (i === 12) {
    task =
      round &&
      entries.every((x) => {
        const risk = entryRiskCents(x);
        return risk <= ADVANCED_RISK_CENTS && risk >= ADVANCED_RISK_CENTS / 2;
      });
    taskTitle = "仓位由 1R 风险算出";
    detail = "每笔风险在 $0.5–$1 之间：不超预算，也别小到失去意义。";
  }
  if (i === 13) {
    const costPrice = primary.initialPrice;
    task =
      held === 0 &&
      e.exits.some(
        (x) =>
          x.tokenId === primary.id && x.targetReached && x.percent < 100 && x.remainingUnits > 0,
      ) &&
      e.exits.some(
        (x) => x.tokenId === primary.id && x.remainingUnits === 0 && x.price >= costPrice,
      );
    taskTitle = "先兑现一部分，余仓在成本之上离场";
    detail = "到目标先卖25%或50%；回落时在跌破开场成本价之前卖完余仓。";
  }
  if (i === 14) {
    task =
      round &&
      entries.every((x) => {
        const last = e.exits.find(
          (y) => y.tokenId === x.tokenId && y.actionIndex > x.actionIndex && y.remainingUnits === 0,
        );
        return !!last && last.step - x.step >= 2 && !last.targetReached;
      });
    taskTitle = "给足机会，到时间就走";
    detail = "买入后至少观察2步；没到目标就在第4步内卖出。";
  }
  if (i === 15) {
    const tokens = new Set(entries.map((x) => x.tokenId));
    task =
      round &&
      tokens.size === 3 &&
      entries.length === 3 &&
      e.peakPositions <= 1 &&
      entries.every((x) => {
        const risk = entryRiskCents(x);
        return risk <= ADVANCED_RISK_CENTS && risk >= ADVANCED_RISK_CENTS / 2;
      });
    taskTitle = "三笔风险一样大";
    detail = "A、B、C 各一笔，每笔风险 $0.5–$1；先撤价越远，买入金额越小。";
  }
  checks.push(check("competency", taskTitle, task, detail));
  const plansOkay =
    entries.length > 0
      ? entries.every((x) => x.plan !== null)
      : [2, 3].includes(i)
        ? !!e.plans[primary.id]
        : true;
  const timely = entries.every((x) => {
    const last = e.exits.find(
      (y) => y.tokenId === x.tokenId && y.actionIndex > x.actionIndex && y.remainingUnits === 0,
    );
    return !!last && last.step - x.step <= x.plan!.maxHoldSteps;
  });
  checks.push(
    check(
      "plan",
      "及时处理自己的仓位",
      plansOkay && timely,
      "按照本关给出的价位练习，买入后不要无限拖延，六步内处理完仓位。",
    ),
  );
  checks.push(
    check("sealed", "保存完整交易过程", s.finished, "完成后封存；失败尝试、费用和等待都保留。"),
  );
  return {
    score: Math.round((checks.filter((c) => c.passed).length / checks.length) * 100),
    passed: checks.every((c) => c.passed),
    checks,
    pnlCents: legacy.labEquity(s) - s.initialEquityCents,
    feesCents: s.feesCents,
    completed: s.finished,
  };
}
export const tradingExtraActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("trade-plan"),
      tokenId: z.enum(["token-a", "token-b", "token-c"]),
      entryPrice: z.number().finite().positive().max(10000),
      stopPrice: z.number().finite().positive().max(10000),
      targetPrice: z.number().finite().positive().max(10000),
      maxCents: z.number().int().min(30).max(800),
      maxHoldSteps: z.number().int().min(1).max(12),
    })
    .strict(),
  z
    .object({
      type: z.literal("journal"),
      phase: z.enum(["before", "after"]),
      note: z.string().min(1).max(240),
    })
    .strict(),
  z
    .object({ type: z.literal("skip"), tokenId: z.enum(["token-a", "token-b", "token-c"]) })
    .strict(),
]);
