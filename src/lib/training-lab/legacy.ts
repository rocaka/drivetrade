import { z } from "zod";
import type {
  LabAction,
  LabChallenge,
  LabCheck,
  LabResult,
  LabRun,
  LabState,
  LabToken,
} from "./types.ts";
export type { LabAction, LabChallenge, LabCheck, LabResult, LabRun, LabState } from "./types.ts";

const titles = [
  "同名项目",
  "gas 空了",
  "曲线尾段",
  "锁 LP 的大跌",
  "可撤的池子",
  "卖出被限制",
  "热闹的假信号",
  "薄池高涨幅",
  "桥还在途中",
  "拥堵与回退",
  "一起下跌",
  "连亏后的选择",
];
const goals = [
  "核对链与地址，仅对 Solana 的 SIM-A01 完成一次预算内买入与退出。",
  "先用 Base 稳定资金补充链费，再卖出已有仓位。",
  "检查剩余曲线容量，小额交易或等待迁池后交易，再退出。",
  "先冻结失效价；观察价格，触发后两步内提交退出。",
  "核对 LP 和自己的退出报价，条件不满足时保持空仓，观察至少四步。",
  "先卖出25%验证；等待权限变化，保留一次失败退出的真实证据。",
  "核对真实深度，不因讨论热度追买，观察至少四步。",
  "小额买入并卖出，对照边际价格与真实净回款，承担真实费用。",
  "从 Solana 调度资金，等 Base 到账并补 gas，再完成小额买卖。",
  "等待原订单产生执行结果，再以新条件确认买入并退出。",
  "查看三个关联项目，减仓至关联投入不超过30美元。",
  "停止线已经触发：减掉现有仓位并观察四步，保持不新增风险。",
];
const lessons = [4, 5, 8, 10, 12, 15, 16, 23, 6, 14, 3, 22];
const summaries = [
  "核对链与地址，买入目标项目再退出。",
  "把本链资金换成 gas，再卖出现有仓位。",
  "核对曲线余量，在真实容量内完成买卖。",
  "冻结失效价，大户卖出后按计划减险。",
  "识别可撤 LP，在条件不足时保持空仓。",
  "小额验证退出，保留权限变化后的回退。",
  "对照讨论热度与池深，练习有依据地等待。",
  "小额往返交易，比较涨幅与真实净回款。",
  "跨链调度，等到账并补 gas 后再交易。",
  "核对旧单结果，再用新条件确认下一笔。",
  "合并关联持仓，把共同风险降回预算。",
  "触发停止线后减险，观察市场而不加码。",
];
export const LAB_CHALLENGES: LabChallenge[] = titles.map((title, i) => ({
  id: `practice-${i + 1}`,
  title,
  summary: summaries[i],
  goal: goals[i],
  lessonId: `lesson-${lessons[i]}`,
  maxSteps: 12,
  targetId: "token-a",
  rules: [
    i === 10 ? "关联投入上限 $30" : "新增单项目全损预算 $10（含已持有成本）",
    "每笔执行费 $0.10，交易费 0.25%",
    "每步30模拟秒；交易按真实池储备计算",
  ],
}));
const SCALE = 1_000_000,
  GAS = 10;
const clone = <T>(v: T): T => structuredClone(v);
function numberSeed(seed: string) {
  let x = 2166136261;
  for (const c of seed) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  return x >>> 0;
}
function challenge(id: string) {
  const c = LAB_CHALLENGES.find((x) => x.id === id);
  if (!c) throw new Error("实操关卡不存在");
  return c;
}
const indexOf = (s: LabState) => Number(s.challengeId.split("-")[1]) - 1;
function event(s: LabState, type: string, message: string, tokenId?: string, cents?: number) {
  s.events.push({
    step: s.step,
    type,
    message,
    ...(tokenId ? { tokenId } : {}),
    ...(cents !== undefined ? { cents } : {}),
  });
}
export function labPrice(t: LabToken) {
  return t.poolUnits > 0 ? ((t.poolCash / t.poolUnits) * SCALE) / 100 : 0;
}
export function labSellQuote(s: LabState, tokenId: string, percent = 100) {
  const t = s.tokens.find((x) => x.id === tokenId),
    p = s.positions[tokenId];
  if (!t || !p || p.units <= 0)
    return { ok: false, units: 0, grossCents: 0, feeCents: 0, netCents: 0, error: "没有可卖持仓" };
  const units = Math.floor((p.units * percent) / 100);
  const grossCents = Math.floor((t.poolCash * units) / (t.poolUnits + units));
  const feeCents = Math.max(1, Math.ceil(grossCents * 0.0025));
  const error = t.frozen
    ? "卖出权限已经限制"
    : s.gas[t.chain] < GAS
      ? "本链 gas 不足"
      : grossCents <= feeCents + GAS
        ? "净回款不足以覆盖费用"
        : undefined;
  return {
    ok: !error,
    units,
    grossCents,
    feeCents,
    netCents: t.frozen ? 0 : Math.max(0, grossCents - feeCents - GAS),
    error,
  };
}
export function labEquity(s: LabState) {
  return (
    Object.values(s.cash).reduce((a, b) => a + b, 0) +
    Object.values(s.gas).reduce((a, b) => a + b, 0) +
    (s.bridge?.status === "pending" ? s.bridge.cents : 0) +
    s.tokens.reduce((sum, t) => sum + labSellQuote(s, t.id).netCents, 0)
  );
}
export function labConservation(s: LabState) {
  return (
    Object.values(s.cash).reduce((a, b) => a + b, 0) +
    Object.values(s.gas).reduce((a, b) => a + b, 0) +
    Object.values(s.marketCash).reduce((a, b) => a + b, 0) +
    s.tokens.reduce((sum, t) => sum + t.poolCash, 0) +
    s.feesCents +
    (s.bridge?.status === "pending" ? s.bridge.cents : 0)
  );
}
function initToken(seed: string, id: string, chain: "solana" | "base", thin = false): LabToken {
  const salt = numberSeed(seed + id),
    cash = thin ? 1500 : 100000 + (salt % 20000),
    price = 0.6 + (salt % 90) / 100;
  const poolUnits = Math.floor((cash / (price * 100)) * SCALE);
  return {
    id,
    name: "月面电台",
    symbol: id === "token-a" ? "MOON" : id === "token-b" ? "MOON" : "ORBIT",
    chain,
    address: id === "token-a" ? "SIM-A01" : id === "token-b" ? "SIM-B01" : "SIM-C01",
    cluster: "cluster-1",
    poolCash: cash,
    poolUnits,
    npcUnits: poolUnits * 4,
    initialPoolUnits: poolUnits * 5,
    lockedLP: true,
    frozen: false,
    hype: 15,
    curveRemainingCents: null,
    initialPrice: ((cash / poolUnits) * SCALE) / 100,
    history: [{ step: 0, price: ((cash / poolUnits) * SCALE) / 100 }],
  };
}
function seedPosition(s: LabState, t: LabToken, cost: number) {
  const units = Math.floor((t.poolUnits * cost) / (t.poolCash + cost));
  s.cash[t.chain] -= cost;
  t.poolCash += cost;
  t.poolUnits -= units;
  s.positions[t.id] = { units, costCents: cost };
}
export function createLab(challengeId: string, seed: string): LabState {
  challenge(challengeId);
  if (!seed || seed.length > 120) throw new Error("种子无效");
  const i = Number(challengeId.split("-")[1]) - 1;
  const s: LabState = {
    version: "lab-v1",
    challengeId,
    seed,
    step: 0,
    finished: false,
    cash: { solana: 49600, base: 50000 },
    gas: { solana: 200, base: 200 },
    positions: {},
    tokens: [
      initToken(
        seed,
        "token-a",
        i === 0 || i === 2 || i === 3 || i === 7 ? "solana" : "base",
        i === 4 || i === 6 || i === 7,
      ),
    ],
    marketCash: { solana: 10_000_000, base: 10_000_000 },
    feesCents: 0,
    initialEquityCents: 100000,
    initialConservation: 0,
    bridge: null,
    orders: [],
    events: [],
    inspected: [],
    stopPlans: {},
    facts: {
      failedAttempts: 0,
      buyCount: 0,
      sellCount: 0,
      maxStakeCents: 0,
      wrongIdentity: false,
      addedAfterStop: false,
      duplicatePending: false,
      capacityViolation: false,
      oversized: false,
      stopTriggeredAt: null,
      stopExitedAt: null,
    },
  };
  const a = s.tokens[0];
  if (i === 0) {
    s.tokens.push(initToken(seed, "token-b", "base"));
    s.tokens[1].name = a.name;
  }
  if (i === 1) {
    s.cash.base += s.gas.base;
    s.gas.base = 0;
    seedPosition(s, a, 2000);
  }
  if (i === 2) a.curveRemainingCents = 600;
  if (i === 3) seedPosition(s, a, 2000);
  if (i === 4) a.lockedLP = false;
  if (i === 5) seedPosition(s, a, 2000);
  if (i === 6) a.hype = 98;
  if (i === 8) {
    s.cash.solana += s.cash.base + s.gas.base;
    s.cash.base = 0;
    s.gas.base = 0;
  }
  if (i === 9) {
    const fee = 2,
      units = Math.floor((a.poolUnits * (500 - fee)) / (a.poolCash + 500 - fee));
    s.orders.push({
      id: 1,
      tokenId: a.id,
      cents: 500,
      minUnits: Math.floor(units * 0.995),
      dueStep: 2,
      deadline: 4,
      status: "pending",
      message: "开场前已确认的买单，等待执行",
    });
    event(s, "queued", "已有 $5 买单，先等待执行结果", a.id);
  }
  if (i === 10) {
    s.tokens.push(initToken(seed, "token-b", "base"), initToken(seed, "token-c", "base"));
    for (const t of s.tokens) seedPosition(s, t, 2000);
  }
  if (i === 11) {
    s.cash.base -= 3000;
    s.marketCash.base += 3000;
    seedPosition(s, a, 1000);
    event(s, "daily-stop", "开场条件：模拟日停止新增风险线已触发");
  }
  for (const t of s.tokens) {
    t.initialPrice = labPrice(t);
    t.history = [{ step: 0, price: labPrice(t) }];
  }
  s.initialEquityCents = labEquity(s);
  s.initialConservation = labConservation(s);
  return s;
}
function reject(s: LabState, message: string, tokenId?: string) {
  s.facts.failedAttempts++;
  event(s, "rejected", message, tokenId);
}
function executeBuy(s: LabState, t: LabToken, cents: number, minUnits = 0) {
  const fee = Math.max(1, Math.ceil(cents * 0.0025)),
    net = cents - fee,
    out = Math.floor((t.poolUnits * net) / (t.poolCash + net));
  if (s.cash[t.chain] < cents) {
    reject(s, "本链可用资金不足", t.id);
    return false;
  }
  if (s.gas[t.chain] < GAS) {
    reject(s, "本链 gas 不足，请先补充", t.id);
    return false;
  }
  s.gas[t.chain] -= GAS;
  s.feesCents += GAS;
  if (out < minUnits) {
    event(s, "reverted", "执行报价低于原 minOut：资产交换回退，已消耗链费保留", t.id, GAS);
    return false;
  }
  if (out <= 0) {
    event(s, "reverted", "数量不足最小精度", t.id, GAS);
    return false;
  }
  s.cash[t.chain] -= cents;
  s.feesCents += fee;
  t.poolCash += net;
  t.poolUnits -= out;
  const p = s.positions[t.id] ?? { units: 0, costCents: 0 };
  p.units += out;
  p.costCents += cents + GAS;
  s.positions[t.id] = p;
  if (t.curveRemainingCents !== null)
    t.curveRemainingCents = Math.max(0, t.curveRemainingCents - cents);
  s.facts.buyCount++;
  s.facts.maxStakeCents = Math.max(s.facts.maxStakeCents, p.costCents);
  event(s, "bought", `买入已成交，投入 $${(cents / 100).toFixed(2)}，另扣链费`, t.id, cents);
  return true;
}
function npcBuy(s: LabState, t: LabToken, cents: number) {
  const v = Math.min(cents, s.marketCash[t.chain]);
  const out = Math.floor((t.poolUnits * v) / (t.poolCash + v));
  s.marketCash[t.chain] -= v;
  t.poolCash += v;
  t.poolUnits -= out;
  t.npcUnits += out;
}
function npcSell(s: LabState, t: LabToken, ratio: number) {
  const units = Math.min(t.npcUnits, Math.floor(t.poolUnits * ratio));
  const out = Math.floor((t.poolCash * units) / (t.poolUnits + units));
  t.npcUnits -= units;
  t.poolUnits += units;
  t.poolCash -= out;
  s.marketCash[t.chain] += out;
}
function advanceOne(s: LabState) {
  s.step++;
  const i = indexOf(s),
    a = s.tokens[0];
  for (const t of s.tokens) {
    const wave = (numberSeed(s.seed + t.id + s.step) % 100) / 100;
    if ((i === 3 && s.step === 2) || (i === 10 && s.step === 2)) {
      npcSell(s, t, 0.25);
      event(s, "whale-sell", "持币大户正常卖出；LP仍锁定", t.id);
    } else if (i === 9 && s.step === 1) {
      npcBuy(s, t, Math.floor(t.poolCash * 0.25));
      event(s, "market-buy", "队列期间发生外部买盘，原报价发生变化", t.id);
    } else if (wave > 0.55) npcBuy(s, t, Math.floor(t.poolCash * 0.003));
    else npcSell(s, t, 0.002);
    if (i === 4 && s.step === 4) {
      const pull = Math.floor(t.poolCash * 0.9);
      t.poolCash -= pull;
      s.marketCash[t.chain] += pull;
      event(s, "lp-pull", "LP持有人实际撤出90%报价储备", t.id, pull);
    }
    if (i === 5 && s.step === 3) {
      t.frozen = true;
      event(s, "freeze", "当前卖出权限变为受限", t.id);
    }
    if (i === 2 && s.step === 3 && t.curveRemainingCents !== null) {
      t.curveRemainingCents = null;
      event(s, "migrated", "阶段已迁移到教学池，容量约束结束", t.id);
    }
    t.history.push({ step: s.step, price: labPrice(t) });
    if (
      s.stopPlans[t.id] &&
      s.positions[t.id]?.units > 0 &&
      labPrice(t) <= s.stopPlans[t.id] &&
      s.facts.stopTriggeredAt === null
    ) {
      s.facts.stopTriggeredAt = s.step;
      event(s, "stop-trigger", "已触及冻结的失效价，请检查可执行退出", t.id);
    }
  }
  if (s.bridge?.status === "pending" && s.bridge.dueStep <= s.step) {
    s.cash[s.bridge.to] += s.bridge.cents;
    s.bridge.status = "completed";
    event(s, "bridge-arrived", "跨链资金已实际到账");
  }
  for (const o of s.orders.filter((x) => x.status === "pending")) {
    if (s.step > o.deadline) {
      o.status = "expired";
      o.message = "已过期，未扣执行费";
      event(s, "expired", o.message, o.tokenId);
    } else if (s.step >= o.dueStep) {
      const t = s.tokens.find((x) => x.id === o.tokenId)!;
      const ok = executeBuy(s, t, o.cents, o.minUnits);
      o.status = ok ? "confirmed" : "reverted";
      o.message = ok ? "按执行报价成交" : "回退，保留执行状态与实际费用";
    }
  }
  if (s.step >= challenge(s.challengeId).maxSteps) s.finished = true;
}
export function applyLabAction(input: LabState, action: LabAction): LabState {
  if (input.finished) return input;
  const s = clone(input),
    i = indexOf(s),
    t = "tokenId" in action ? s.tokens.find((x) => x.id === action.tokenId) : undefined;
  if ("tokenId" in action && !t) {
    reject(s, "项目不存在");
    return s;
  }
  if (action.type === "inspect") {
    if (!s.inspected.includes(t!.id)) s.inspected.push(t!.id);
    event(
      s,
      "inspected",
      `已核对 ${t!.chain} / ${t!.address} / LP${t!.lockedLP ? "锁定" : "可撤"} / 当前退出报价`,
      t!.id,
    );
  }
  if (action.type === "plan") {
    if (
      !Number.isFinite(action.stopPrice) ||
      action.stopPrice <= 0 ||
      action.stopPrice >= labPrice(t!)
    ) {
      reject(s, "失效价应大于0且低于当前价", t!.id);
      return s;
    }
    if (s.stopPlans[t!.id] !== undefined) {
      reject(s, "本次训练计划已冻结，不能事后移动失效价", t!.id);
      return s;
    }
    s.stopPlans[t!.id] = action.stopPrice;
    event(s, "plan", "失效价已冻结", t!.id);
  }
  if (action.type === "buy") {
    if (!Number.isInteger(action.cents) || action.cents < 20 || action.cents > 100000) {
      reject(s, "投入金额无效");
      return s;
    }
    if (i === 11) {
      s.facts.addedAfterStop = true;
      reject(s, "停止线已锁存，禁止新增风险");
      return s;
    }
    if (i === 0 && t!.id !== "token-a") s.facts.wrongIdentity = true;
    if (s.orders.some((x) => x.status === "pending")) {
      s.facts.duplicatePending = true;
      reject(s, "已有待执行意图，先核对它的结果");
      return s;
    }
    const cost = (s.positions[t!.id]?.costCents ?? 0) + action.cents + GAS;
    if (cost > 1000) {
      s.facts.oversized = true;
      reject(s, "本关单项目全损预算10美元，含链费");
      return s;
    }
    if (t!.curveRemainingCents !== null && action.cents > t!.curveRemainingCents) {
      s.facts.capacityViolation = true;
      reject(s, "输入超过真实剩余曲线容量");
      return s;
    }
    if (i === 9) {
      const fee = Math.max(1, Math.ceil(action.cents * 0.0025)),
        net = action.cents - fee,
        units = Math.floor((t!.poolUnits * net) / (t!.poolCash + net));
      s.orders.push({
        id: s.orders.length + 1,
        tokenId: t!.id,
        cents: action.cents,
        minUnits: Math.floor(units * (1 - action.slippageBps / 10000)),
        dueStep: s.step + 2,
        deadline: s.step + action.ttlSteps,
        status: "pending",
        message: "新条件已确认，等待执行",
      });
      event(s, "queued", "新的买入意图已提交", t!.id);
    } else executeBuy(s, t!, action.cents);
  }
  if (action.type === "sell") {
    const q = labSellQuote(s, t!.id, action.percent);
    if (!q.ok) {
      if (t!.frozen && s.gas[t!.chain] >= GAS) {
        s.gas[t!.chain] -= GAS;
        s.feesCents += GAS;
        event(s, "restricted-exit", "权限限制导致真实退出回退，保留持仓与链费", t!.id, GAS);
      } else reject(s, q.error!, t!.id);
      return s;
    }
    const p = s.positions[t!.id],
      removedCost = Math.floor((p.costCents * q.units) / p.units);
    p.costCents -= removedCost;
    p.units -= q.units;
    t!.poolUnits += q.units;
    t!.poolCash -= q.grossCents;
    s.cash[t!.chain] += q.grossCents - q.feeCents;
    s.gas[t!.chain] -= GAS;
    s.feesCents += q.feeCents + GAS;
    s.facts.sellCount++;
    if (s.facts.stopTriggeredAt !== null) s.facts.stopExitedAt = s.step;
    event(s, "sold", `退出已成交，净回款 $${(q.netCents / 100).toFixed(2)}`, t!.id, q.netCents);
  }
  if (action.type === "fund") {
    if (
      !Number.isInteger(action.cents) ||
      action.cents < 10 ||
      action.cents > 1000 ||
      s.cash[action.chain] < action.cents
    ) {
      reject(s, "需要本链已到账的稳定资金，补充金额0.10—10美元");
      return s;
    }
    s.cash[action.chain] -= action.cents;
    s.gas[action.chain] += action.cents;
    event(s, "funded", `${action.chain} gas已补充 $${(action.cents / 100).toFixed(2)}`);
  }
  if (action.type === "bridge") {
    if (
      action.from === action.to ||
      s.bridge?.status === "pending" ||
      !Number.isInteger(action.cents) ||
      action.cents < 100 ||
      s.cash[action.from] < action.cents + 5
    ) {
      reject(s, "桥金额或来源余额无效，已有在途资金请先等待");
      return s;
    }
    s.cash[action.from] -= action.cents + 5;
    s.feesCents += 5;
    s.bridge = {
      from: action.from,
      to: action.to,
      cents: action.cents,
      dueStep: s.step + 3,
      status: "pending",
    };
    event(s, "bridge-sent", "源链已扣款，三步后目标链到账；在途资金只计一次");
  }
  if (action.type === "wait") {
    if (!Number.isInteger(action.steps) || action.steps < 1 || action.steps > 4) {
      reject(s, "每次观察1—4步");
      return s;
    }
    for (let n = 0; n < action.steps && !s.finished; n++) advanceOne(s);
  }
  if (action.type === "finish") {
    s.finished = true;
    event(s, "finished", "本次实操已封存，按实际行为验收");
  }
  for (const current of s.tokens) {
    const currentPrice = labPrice(current);
    if (current.history.at(-1)?.price !== currentPrice)
      current.history.push({ step: s.step, price: currentPrice });
  }
  return s;
}
function check(id: string, title: string, passed: boolean, detail: string): LabCheck {
  return { id, title, passed, detail };
}
export function labResult(s: LabState): LabResult {
  const i = indexOf(s),
    a = s.tokens[0],
    f = s.facts,
    holding = Object.values(s.positions).reduce((n, p) => n + p.units, 0),
    checks: LabCheck[] = [];
  const inspected = s.inspected.includes(a.id),
    roundTrip = f.buyCount > 0 && f.sellCount > 0 && holding === 0;
  checks.push(
    check(
      "observed",
      "核对执行所需事实",
      i === 10 ? s.tokens.every((t) => s.inspected.includes(t.id)) : inspected,
      "先核对链、地址、权限和自己的退出数量。",
    ),
  );
  checks.push(
    check(
      "budget",
      "遵守可控风险边界",
      !f.oversized &&
        !f.wrongIdentity &&
        !f.addedAfterStop &&
        !f.duplicatePending &&
        !f.capacityViolation,
      "预算、身份、停止线和待执行订单必须一起核对。",
    ),
  );
  if (i === 0 || i === 2 || i === 7)
    checks.push(
      check(
        "execute",
        "完成预算内买入与退出",
        roundTrip,
        "需要真实成交与退出；盈亏不决定本项是否达标。",
      ),
    );
  else if (i === 1)
    checks.push(
      check(
        "gas",
        "先补本链gas再退出",
        f.sellCount > 0 &&
          holding === 0 &&
          f.failedAttempts === 0 &&
          s.events.some((e) => e.type === "funded"),
        "其他链的余额不能直接支付本链费用。",
      ),
    );
  else if (i === 3)
    checks.push(
      check(
        "stop",
        "按冻结失效价及时减险",
        !!s.stopPlans[a.id] &&
          f.stopTriggeredAt !== null &&
          f.stopExitedAt !== null &&
          f.stopExitedAt - f.stopTriggeredAt <= 2 &&
          holding === 0,
        "先设失效价；触发后两步内完成退出。",
      ),
    );
  else if (i === 4 || i === 6)
    checks.push(
      check(
        "wait",
        "条件不满足时实际保持空仓",
        f.buyCount === 0 && s.step >= 4,
        "至少观察四步；不把热度或可撤池当作退出保证。",
      ),
    );
  else if (i === 5)
    checks.push(
      check(
        "constraint",
        "验证权限变化并保留回退",
        f.sellCount > 0 &&
          s.events.filter((e) => e.type === "restricted-exit").length === 1 &&
          s.step >= 3,
        "先做小额退出；限制出现后核对一次失败，不重复消耗链费。",
      ),
    );
  else if (i === 8)
    checks.push(
      check(
        "bridge",
        "资金实际到账后再操作",
        s.bridge?.status === "completed" && roundTrip && f.failedAttempts === 0,
        "在途不能花两次；目标链还要有gas。",
      ),
    );
  else if (i === 9)
    checks.push(
      check(
        "queue",
        "核对失败后重新确认并退出",
        s.orders.some((o) => o.status === "reverted" || o.status === "expired") &&
          s.orders.some((o) => o.status === "confirmed" && o.id > 1) &&
          holding === 0 &&
          f.sellCount > 0,
        "等待已有意图结果，新订单使用明确的新条件。",
      ),
    );
  else if (i === 10)
    checks.push(
      check(
        "cluster",
        "实际降低关联敞口",
        Object.values(s.positions).reduce((sum, p) => sum + p.costCents, 0) <= 3000 &&
          f.sellCount > 0 &&
          f.buyCount === 0,
        "以剩余成本计算关联投入，不靠改名字分散。",
      ),
    );
  else
    checks.push(
      check(
        "stop-day",
        "停手并保留减险能力",
        holding === 0 && f.sellCount > 0 && s.step >= 4 && f.buyCount === 0,
        "执行停止窗口，不按后来涨幅评价停手。",
      ),
    );
  checks.push(
    check("sealed", "完成并封存操作证据", s.finished, "点完成后保存；每个动作都可从种子重放。"),
  );
  return {
    score: Math.round((checks.filter((c) => c.passed).length / checks.length) * 100),
    passed: checks.every((c) => c.passed),
    checks,
    pnlCents: labEquity(s) - s.initialEquityCents,
    feesCents: s.feesCents,
    completed: s.finished,
  };
}
const tokenId = z.enum(["token-a", "token-b", "token-c"]);
const cents = z.number().int().min(1).max(100000);
const chain = z.enum(["solana", "base"]);
export const labActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("inspect"), tokenId }).strict(),
  z
    .object({
      type: z.literal("buy"),
      tokenId,
      cents,
      slippageBps: z.number().int().min(0).max(3000),
      ttlSteps: z.number().int().min(1).max(6),
    })
    .strict(),
  z
    .object({
      type: z.literal("sell"),
      tokenId,
      percent: z.union([z.literal(25), z.literal(50), z.literal(100)]),
    })
    .strict(),
  z.object({ type: z.literal("fund"), chain, cents }).strict(),
  z.object({ type: z.literal("bridge"), from: chain, to: chain, cents }).strict(),
  z
    .object({
      type: z.literal("plan"),
      tokenId,
      stopPrice: z.number().finite().positive().max(10000),
    })
    .strict(),
  z.object({ type: z.literal("wait"), steps: z.number().int().min(1).max(4) }).strict(),
  z.object({ type: z.literal("finish") }).strict(),
]);
const checkSchema = z
  .object({
    id: z.string().max(40),
    title: z.string().max(100),
    passed: z.boolean(),
    detail: z.string().max(300),
  })
  .strict();
const resultSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    passed: z.boolean(),
    checks: z.array(checkSchema).max(8),
    pnlCents: z.number().int(),
    feesCents: z.number().int().nonnegative(),
    completed: z.boolean(),
  })
  .strict();
export const labRunSchema = z
  .object({
    version: z.literal("lab-v1"),
    challengeId: z.string().refine((id) => LAB_CHALLENGES.some((c) => c.id === id)),
    seed: z.string().min(1).max(120),
    actions: z.array(labActionSchema).min(1).max(200),
    result: resultSchema,
  })
  .strict();
export function replayLabRun(run: Pick<LabRun, "challengeId" | "seed" | "actions">): LabState {
  let s = createLab(run.challengeId, run.seed);
  if (run.actions.length > 200) throw new Error("操作记录过长");
  for (const action of run.actions) {
    if (s.finished) throw new Error("封存后不能追加动作");
    s = applyLabAction(s, labActionSchema.parse(action));
  }
  return s;
}
export function makeLabRun(challengeId: string, seed: string, actions: LabAction[]): LabRun {
  const s = replayLabRun({ challengeId, seed, actions });
  return { version: "lab-v1", challengeId, seed, actions: clone(actions), result: labResult(s) };
}
export function validateLabRun(value: unknown): value is LabRun {
  const parsed = labRunSchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    const state = replayLabRun(parsed.data);
    return (
      state.finished &&
      JSON.stringify(labResult(state)) === JSON.stringify(parsed.data.result) &&
      labConservation(state) === state.initialConservation &&
      state.tokens.every(
        (t) =>
          t.poolUnits + t.npcUnits + (state.positions[t.id]?.units ?? 0) === t.initialPoolUnits,
      )
    );
  } catch {
    return false;
  }
}
export function evaluateLabs(runs: readonly LabRun[]) {
  const valid = runs.filter(validateLabRun);
  const checks = LAB_CHALLENGES.map((c) => {
    const attempts = valid.filter((r) => r.challengeId === c.id);
    return {
      id: c.id,
      title: c.title,
      passed: attempts.some((r) => r.result.passed),
      bestScore: Math.max(0, ...attempts.map((r) => r.result.score)),
    };
  });
  return {
    passed: checks.every((c) => c.passed),
    completed: checks.filter((c) => c.passed).length,
    required: checks.length,
    checks,
    weaknesses: checks.filter((c) => !c.passed).map((c) => c.title),
  };
}
