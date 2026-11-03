import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";

export type RuleType = "BUY" | "STOP_LOSS" | "TAKE_PROFIT" | "OTHER";

export type Rule = {
  id: string;
  title: string;
  content: string;
  type: RuleType;
  isActive: boolean;
};

export type Trade = {
  id: string;
  date: string;
  symbol: string;
  planReason: string;
  stopLoss: string;
  takeProfit: string;
  actualEntry: string;
  actualExit: string;
  followedPlan: boolean;
  deviationReason: string;
  stake: number | null;
  pnl: number | null;
  createdAt: string;
  source?: "fomo";
};

export const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: "BUY", label: "买入" },
  { value: "STOP_LOSS", label: "止损" },
  { value: "TAKE_PROFIT", label: "止盈" },
  { value: "OTHER", label: "其他" },
];

export function typeLabel(type: RuleType) {
  return RULE_TYPES.find((item) => item.value === type)?.label ?? "其他";
}

export const DEFAULT_RULES: Rule[] = [
  {
    id: "rule-no-chase",
    title: "禁止追高",
    content: "连续大阳线后、情绪高潮时不追。只在明确回调或关键支撑附近考虑。",
    type: "BUY",
    isActive: true,
  },
  {
    id: "rule-stop",
    title: "亏损必须及时止损",
    content: "到达预设止损位（建议 -15% 或关键支撑跌破）无条件卖出，不扛单。",
    type: "STOP_LOSS",
    isActive: true,
  },
  {
    id: "rule-tp",
    title: "涨幅超过 50% 考虑卖出",
    content: "达到 50% 先卖一半落袋，剩下用移动止损或继续持有。不要幻想一直拿到顶。",
    type: "TAKE_PROFIT",
    isActive: true,
  },
  {
    id: "rule-size",
    title: "单笔仓位控制",
    content: "单笔最多使用总交易资金的 20-30%，绝不用借来的钱。",
    type: "OTHER",
    isActive: true,
  },
];

const ruleSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  type: z.enum(["BUY", "STOP_LOSS", "TAKE_PROFIT", "OTHER"]),
  isActive: z.boolean(),
});

const tradeSchema = z.object({
  id: z.string(),
  date: z.string(),
  symbol: z.string(),
  planReason: z.string(),
  stopLoss: z.string(),
  takeProfit: z.string(),
  actualEntry: z.string(),
  actualExit: z.string(),
  followedPlan: z.boolean(),
  deviationReason: z.string(),
  stake: z.number().nullable().optional(),
  pnl: z.number().nullable().optional(),
  createdAt: z.string(),
  source: z.enum(["fomo"]).optional(),
}).transform((trade) => ({
  ...trade,
  stake: typeof trade.stake === "number" && Number.isFinite(trade.stake) ? trade.stake : null,
  pnl: typeof trade.pnl === "number" && Number.isFinite(trade.pnl) ? trade.pnl : null,
  source: trade.source === "fomo" ? ("fomo" as const) : undefined,
}));

export const backupSchema = z.object({
  version: z.number().optional(),
  trades: z.array(tradeSchema),
  rules: z.array(ruleSchema),
  principal: z.number().optional(),
});

export type TradeInput = Omit<Trade, "id" | "createdAt">;

type TradingState = {
  trades: Trade[];
  rules: Rule[];
  principal: number;
  hydrated: boolean;
  setHydrated: (value: boolean) => void;
  setPrincipal: (value: number) => void;
  addTrade: (input: TradeInput) => void;
  updateTrade: (id: string, input: TradeInput) => void;
  removeTrade: (id: string) => void;
  restoreTrade: (trade: Trade) => void;
  addRule: (input: Omit<Rule, "id" | "isActive">) => void;
  updateRule: (id: string, patch: Partial<Omit<Rule, "id">>) => void;
  toggleRule: (id: string) => void;
  removeRule: (id: string) => void;
  restoreRule: (rule: Rule, index: number) => void;
  moveRule: (id: string, offset: -1 | 1) => void;
  replaceAll: (data: { trades: Trade[]; rules: Rule[]; principal?: number }) => void;
  importFomo: (incoming: Trade[], principal: number | null) => { added: number; skipped: number };
};

export function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDisciplineTrade(trade: Trade) {
  return trade.source !== "fomo";
}

/** Newest first: by trade date, then by when it was recorded. Imports and edits can leave the array out of order. */
export function newestFirst(trades: Trade[]) {
  return [...trades].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
}

export function executionStats(trades: Trade[]) {
  const scoped = newestFirst(trades.filter(isDisciplineTrade));
  const total = scoped.length;
  const followed = scoped.filter((trade) => trade.followedPlan).length;
  const rate = total === 0 ? 0 : Math.round((followed / total) * 100);
  let streak = 0;
  for (const trade of scoped) {
    if (!trade.followedPlan) break;
    streak += 1;
  }
  return { total, followed, missed: total - followed, rate, streak };
}

export function rateTone(rate: number, total: number) {
  if (total === 0) return "muted" as const;
  if (rate >= 80) return "ok" as const;
  if (rate >= 50) return "warn" as const;
  return "bad" as const;
}

export function tradePnl(trade: Trade) {
  return typeof trade.pnl === "number" && Number.isFinite(trade.pnl) ? trade.pnl : null;
}

export function tradeStake(trade: Trade) {
  return typeof trade.stake === "number" && Number.isFinite(trade.stake) ? trade.stake : null;
}

export function readPrincipal(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function formatAmount(value: number) {
  return Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatSigned(value: number) {
  if (value > 0) return `+${formatAmount(value)}`;
  if (value < 0) return `-${formatAmount(value)}`;
  return "0";
}

export type CurvePoint = {
  id: string;
  tick: string;
  equity: number;
  growth: number;
  pnl: number;
  drawdown: number;
  drawdownPct: number;
};

export function moneyStats(trades: Trade[], principalInput: number | undefined) {
  const principal = readPrincipal(principalInput);
  const settled = trades.filter((trade) => tradePnl(trade) !== null);
  const wins = settled.filter((trade) => (tradePnl(trade) ?? 0) > 0);
  const losses = settled.filter((trade) => (tradePnl(trade) ?? 0) < 0);
  const profit = wins.reduce((sum, trade) => sum + (tradePnl(trade) ?? 0), 0);
  const loss = losses.reduce((sum, trade) => sum + (tradePnl(trade) ?? 0), 0);
  const net = profit + loss;
  const winRate = settled.length === 0 ? null : Math.round((wins.length / settled.length) * 100);
  const avgWin = wins.length === 0 ? 0 : profit / wins.length;
  const avgLoss = losses.length === 0 ? 0 : Math.abs(loss / losses.length);
  const payoff = avgLoss === 0 ? null : avgWin / avgLoss;
  const equity = principal + net;
  const returnPct = principal > 0 ? (net / principal) * 100 : null;

  const ordered = [...settled].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  let running = principal;
  let peak = principal;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const curve: CurvePoint[] = [
    {
      id: "start",
      tick: "起点",
      equity: principal,
      growth: 0,
      pnl: 0,
      drawdown: 0,
      drawdownPct: 0,
    },
  ];
  for (const trade of ordered) {
    const pnl = tradePnl(trade) ?? 0;
    running += pnl;
    if (running > peak) peak = running;
    const drawdown = running - peak;
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    if (drawdownPct < maxDrawdownPct) maxDrawdownPct = drawdownPct;
    curve.push({
      id: trade.id,
      tick: `${trade.date.slice(5)} ${trade.symbol}`.trim(),
      equity: running,
      growth: principal > 0 ? ((running - principal) / principal) * 100 : 0,
      pnl,
      drawdown,
      drawdownPct,
    });
  }

  return {
    principal,
    settled: settled.length,
    wins: wins.length,
    losses: losses.length,
    open: trades.length - settled.length,
    profit,
    loss,
    net,
    winRate,
    payoff,
    avgWin,
    avgLoss,
    equity,
    returnPct,
    maxDrawdown,
    maxDrawdownPct,
    curve,
    bars: curve.filter((point) => point.id !== "start"),
  };
}

export const useTrading = create<TradingState>()(
  persist(
    (set) => ({
      trades: [],
      rules: DEFAULT_RULES,
      principal: 0,
      hydrated: false,
      setHydrated: (value) => set({ hydrated: value }),
      setPrincipal: (value) =>
        set({
          principal: Number.isFinite(value) && value > 0 ? value : 0,
        }),
      addTrade: (input) =>
        set((state) => ({
          trades: [
            {
              ...input,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            },
            ...state.trades,
          ],
        })),
      updateTrade: (id, input) =>
        set((state) => ({
          trades: state.trades.map((trade) => {
            if (trade.id !== id) return trade;
            return {
              ...trade,
              ...input,
              source: input.source ?? trade.source,
              id: trade.id,
              createdAt: trade.createdAt,
            };
          }),
        })),
      removeTrade: (id) =>
        set((state) => ({
          trades: state.trades.filter((trade) => trade.id !== id),
        })),
      restoreTrade: (trade) =>
        set((state) =>
          state.trades.some((item) => item.id === trade.id)
            ? state
            : { trades: [trade, ...state.trades] },
        ),
      addRule: (input) =>
        set((state) => ({
          rules: [...state.rules, { ...input, id: crypto.randomUUID(), isActive: true }],
        })),
      updateRule: (id, patch) =>
        set((state) => ({
          rules: state.rules.map((rule) => (rule.id === id ? { ...rule, ...patch, id: rule.id } : rule)),
        })),
      toggleRule: (id) =>
        set((state) => ({
          rules: state.rules.map((rule) =>
            rule.id === id ? { ...rule, isActive: !rule.isActive } : rule,
          ),
        })),
      removeRule: (id) =>
        set((state) => ({
          rules: state.rules.filter((rule) => rule.id !== id),
        })),
      restoreRule: (rule, index) =>
        set((state) => {
          if (state.rules.some((item) => item.id === rule.id)) return state;
          const rules = [...state.rules];
          rules.splice(Math.max(0, Math.min(index, rules.length)), 0, rule);
          return { rules };
        }),
      moveRule: (id, offset) =>
        set((state) => {
          const from = state.rules.findIndex((rule) => rule.id === id);
          const to = from + offset;
          if (from < 0 || to < 0 || to >= state.rules.length) return state;
          const rules = [...state.rules];
          [rules[from], rules[to]] = [rules[to], rules[from]];
          return { rules };
        }),
      replaceAll: (data) =>
        set({
          trades: data.trades,
          rules: data.rules,
          principal: readPrincipal(data.principal),
        }),
      importFomo: (incoming, principal) => {
        let added = 0;
        set((state) => {
          const ids = new Set(state.trades.map((trade) => trade.id));
          const fresh = incoming.filter((trade) => !ids.has(trade.id));
          added = fresh.length;
          return {
            trades: [...fresh, ...state.trades],
            principal:
              principal !== null && principal > 0 ? principal : state.principal,
          };
        });
        return { added, skipped: incoming.length - added };
      },
    }),
    {
      name: "td-discipline-v1",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        trades: state.trades,
        rules: state.rules,
        principal: state.principal,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
