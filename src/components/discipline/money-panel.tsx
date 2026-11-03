import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  formatAmount,
  formatSigned,
  moneyStats,
  useTrading,
  type CurvePoint,
} from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { Card, fieldClass } from "./ui";

function useCountUp(target: number) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const duration = 800;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(target * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

function Rise({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rise-in", className)} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function axisTick(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 10000) return `${sign}${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

function ChartTip({
  active,
  payload,
  label,
  kind,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string }>;
  label?: string;
  kind: "money" | "percent";
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-none">
      <p className="text-muted">{label}</p>
      {payload.map((item) => {
        const value = item.value ?? 0;
        const text = kind === "percent" ? `${value > 0 ? "+" : ""}${value.toFixed(1)}%` : formatSigned(value);
        return (
          <p key={item.name} className="font-mono text-sm text-fg tabular-nums">
            {text}
          </p>
        );
      })}
    </div>
  );
}

function EquityChart({ data }: { data: CurvePoint[] }) {
  return (
    <div className="h-48 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="tick"
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={44}
            tickFormatter={axisTick}
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTip kind="money" />} />
          <Area
            type="monotone"
            dataKey="equity"
            name="权益"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="url(#equity-fill)"
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function GrowthChart({ data }: { data: CurvePoint[] }) {
  const last = data[data.length - 1]?.growth ?? 0;
  return (
    <div className="h-48 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="tick"
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={44}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTip kind="percent" />} />
          <Line
            type="monotone"
            dataKey="growth"
            name="成长"
            stroke={last >= 0 ? "var(--color-ok)" : "var(--color-bad)"}
            strokeWidth={2}
            dot={false}
            animationDuration={900}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DrawdownChart({ data }: { data: CurvePoint[] }) {
  return (
    <div className="h-48 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dd-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-bad)" stopOpacity={0.05} />
              <stop offset="100%" stopColor="var(--color-bad)" stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="tick"
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={44}
            tickFormatter={(value: number) => `${Math.round(value)}%`}
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTip kind="percent" />} />
          <Area
            type="monotone"
            dataKey="drawdownPct"
            name="回撤"
            stroke="var(--color-bad)"
            strokeWidth={2}
            fill="url(#dd-fill)"
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const chartViews = [
  ["equity", "账户"],
  ["growth", "成长"],
  ["drawdown", "回撤"],
  ["pnl", "盈亏"],
] as const;

type ChartView = (typeof chartViews)[number][0];

function PnlBars({ data }: { data: CurvePoint[] }) {
  return (
    <div className="h-40 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="tick"
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            width={44}
            tickFormatter={axisTick}
            tick={{ fill: "var(--color-faint)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTip kind="money" />} />
          <Bar dataKey="pnl" name="盈亏" radius={[4, 4, 0, 0]} animationDuration={700}>
            {data.map((point) => (
              <Cell key={point.id} fill={point.pnl >= 0 ? "var(--color-ok)" : "var(--color-bad)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MoneyPanel() {
  const trades = useTrading((state) => state.trades);
  const principal = useTrading((state) => state.principal);
  const setPrincipal = useTrading((state) => state.setPrincipal);
  const stats = moneyStats(trades, principal);
  const [draft, setDraft] = useState(stats.principal > 0 ? String(stats.principal) : "");
  const equity = useCountUp(stats.equity);
  const profit = useCountUp(stats.profit);
  const lossAbs = useCountUp(Math.abs(stats.loss));
  const winShown = useCountUp(stats.winRate ?? 0);
  const payoffShown = useCountUp(stats.payoff ?? 0);
  const [chart, setChart] = useState<ChartView>("equity");

  useEffect(() => {
    setDraft(stats.principal > 0 ? String(stats.principal) : "");
  }, [stats.principal]);

  function commitPrincipal() {
    const text = draft.trim();
    if (!text) {
      setPrincipal(0);
      return;
    }
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("本金填一个大于等于 0 的数字");
      setDraft(stats.principal > 0 ? String(stats.principal) : "");
      return;
    }
    setPrincipal(value);
  }

  const barMax = Math.max(stats.avgWin, stats.avgLoss, 1);
  const hasCurve = stats.bars.length > 0;

  return (
    <div className="space-y-3">
      <Rise delay={0}>
        <Card>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">账户权益</p>
              <p className="mt-1 font-serif text-3xl font-medium tabular-nums text-fg">
                {formatSigned(equity).replace(/^\+/, "")}
              </p>
            </div>
            <p className={cn("font-mono text-sm tabular-nums", stats.net > 0 ? "text-ok" : stats.net < 0 ? "text-bad" : "text-muted")}>
              净盈亏 {formatSigned(stats.net)}
              {stats.returnPct !== null ? ` · ${stats.returnPct > 0 ? "+" : ""}${stats.returnPct.toFixed(1)}%` : ""}
            </p>
          </div>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-muted">本金</span>
            <input
              className={fieldClass}
              inputMode="decimal"
              value={draft}
              placeholder="账户起始资金，比如 1000"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitPrincipal}
            />
          </label>
          <p className="text-xs text-muted">金额用同一单位，比如 USDT。平仓时在日志里写盈亏，曲线才会动。</p>
        </Card>
      </Rise>

      <Rise delay={70}>
        <div className="grid grid-cols-2 gap-2">
          <Card className="p-3">
            <p className="text-xs text-muted">收益</p>
            <p className="mt-1 font-mono text-xl font-semibold text-ok tabular-nums">+{formatAmount(profit)}</p>
            <p className="text-xs text-muted">{stats.wins} 笔盈利</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted">亏损</p>
            <p className="mt-1 font-mono text-xl font-semibold text-bad tabular-nums">{formatSigned(-lossAbs)}</p>
            <p className="text-xs text-muted">{stats.losses} 笔亏损</p>
          </Card>
        </div>
      </Rise>

      <Rise delay={140}>
        <Card>
          <div className="flex items-center gap-4">
            <div
              className="grid size-28 shrink-0 place-items-center rounded-full transition-none"
              style={{
                background: `conic-gradient(var(--color-ok) ${(stats.winRate === null ? 0 : winShown) * 3.6}deg, var(--color-surface-2) 0deg)`,
              }}
              aria-hidden
            >
              <div className="grid size-20 place-items-center rounded-full bg-surface">
                <span className="font-mono text-lg font-semibold tabular-nums">
                  {stats.winRate === null ? "—" : `${Math.round(winShown)}%`}
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">胜率</p>
              <p className="mt-1 text-xs text-muted">
                {stats.settled === 0
                  ? "还没有平仓记录"
                  : `${stats.wins} 胜 ${stats.losses} 负${stats.open ? ` · ${stats.open} 笔未平` : ""}`}
              </p>
              <p className="mt-3 text-sm font-semibold">盈亏比</p>
              <p className="font-mono text-lg font-semibold tabular-nums text-primary">
                {stats.payoff === null ? (stats.wins > 0 ? "无亏损" : "—") : payoffShown.toFixed(2)}
              </p>
              <p className="text-xs text-muted">平均盈利 / 平均亏损</p>
              <p className="mt-3 text-sm font-semibold">最大回撤</p>
              <p className="font-mono text-lg font-semibold tabular-nums text-bad">
                {stats.settled === 0 ? "—" : formatSigned(stats.maxDrawdown)}
              </p>
              <p className="text-xs text-muted">
                {stats.settled === 0 || stats.maxDrawdownPct === 0
                  ? "从权益高点回落的幅度"
                  : `高点回落 ${Math.abs(stats.maxDrawdownPct).toFixed(1)}%`}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>平均盈利</span>
                <span className="font-mono text-ok tabular-nums">+{formatAmount(stats.avgWin)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-ok transition-all duration-700"
                  style={{ width: `${(stats.avgWin / barMax) * 100}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>平均亏损</span>
                <span className="font-mono text-bad tabular-nums">-{formatAmount(stats.avgLoss)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-bad transition-all duration-700"
                  style={{ width: `${(stats.avgLoss / barMax) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </Card>
      </Rise>

      <Rise delay={210}>
        <Card>
          <div className="grid grid-cols-4 gap-1">
            {chartViews.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setChart(key)}
                className={cn(
                  "min-h-11 rounded-xl text-sm font-medium transition-colors duration-200",
                  chart === key ? "bg-primary text-primary-fg" : "bg-surface-2 text-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div key={chart} className="chart-in mt-3">
            {chart === "equity" ? (
              <>
                <h3 className="text-sm font-semibold">账户曲线</h3>
                <p className="mb-2 text-xs text-muted">本金加上每一笔已平仓盈亏。</p>
                {hasCurve ? (
                  <EquityChart data={stats.curve} />
                ) : (
                  <p className="text-sm text-muted">记下盈亏金额后，这里会画出权益怎么变。</p>
                )}
              </>
            ) : null}
            {chart === "growth" ? (
              <>
                <h3 className="text-sm font-semibold">成长曲线</h3>
                <p className="mb-2 text-xs text-muted">相对本金的累计回报。</p>
                {stats.principal <= 0 ? (
                  <p className="text-sm text-muted">先填写本金，才能算成长百分比。</p>
                ) : hasCurve ? (
                  <GrowthChart data={stats.curve} />
                ) : (
                  <p className="text-sm text-muted">有平仓盈亏之后，回报率会按时间连起来。</p>
                )}
              </>
            ) : null}
            {chart === "drawdown" ? (
              <>
                <h3 className="text-sm font-semibold">回撤曲线</h3>
                <p className="mb-2 text-xs text-muted">相对当时权益高点，账户回落了多少。</p>
                {hasCurve ? (
                  <DrawdownChart data={stats.curve} />
                ) : (
                  <p className="text-sm text-muted">有平仓之后，这里显示水下的回撤。</p>
                )}
              </>
            ) : null}
            {chart === "pnl" ? (
              <>
                <h3 className="text-sm font-semibold">单笔盈亏</h3>
                <p className="mb-2 text-xs text-muted">绿柱是赚，红柱是亏。</p>
                {hasCurve ? (
                  <PnlBars data={stats.bars} />
                ) : (
                  <p className="text-sm text-muted">每笔平仓会在这里留下一根柱。</p>
                )}
              </>
            ) : null}
          </div>
        </Card>
      </Rise>
    </div>
  );
}
