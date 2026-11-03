import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { liquidationValue } from "@/lib/world/engine";
import { money, units } from "@/lib/world/amount";
import { CHAINS } from "@/lib/world/config";
import type { World } from "@/lib/world/types";
import { AnimatedValue, TrainingDisclosure } from "@/components/training-ui";
import { Metric, simTime } from "./shared";
import "./account-overview.css";

export function AccountOverview({ world }: { world: World }) {
  const [range, setRange] = useState<"hour" | "all">("all");
  const equity =
    world.phase === "completed" && world.report ? world.report.final : liquidationValue(world);
  const pnl = equity - world.initialEquity;
  const returnPct = world.initialEquity > 0 ? (pnl / world.initialEquity) * 100 : 0;
  const data = useMemo(() => {
    const points = world.equity.filter((p) => range === "all" || p.t >= world.now - 3600);
    const baseline = CHAINS.reduce(
      (sum, chain) =>
        sum +
        units(world.initialWallet[chain.id].stable) +
        units(world.initialWallet[chain.id].native) * world.fx[chain.id],
      0,
    );
    const current = { t: world.now, equity, baseline };
    if (points.at(-1)?.t === world.now) return [...points.slice(0, -1), current];
    return [...points, current];
  }, [world.equity, world.now, world.initialWallet, world.fx, equity, range]);
  const start = data[0]?.t ?? 0;
  const end = Math.max(start + 1, world.now);
  const span = end - start;
  const step = span < 60 ? 15 : Math.max(60, Math.ceil(span / 4 / 60) * 60);
  const ticks = Array.from(
    { length: 6 },
    (_, i) => Math.ceil(start / step) * step + i * step,
  ).filter((t) => t <= end);
  const axisTime = (t: number) => (span < 60 ? simTime(t).slice(3) : simTime(t).slice(0, -3));
  return (
    <section className="mw-account-overview" aria-label="账户资金曲线">
      <div className="mw-equity-heading">
        <div>
          <span className="mw-eyebrow">本场累计盈亏</span>
          <strong className={pnl >= 0 ? "mw-ok" : "mw-bad"}>
            <AnimatedValue
              value={pnl}
              format={(v) => `${v >= 0 ? "+" : "−"}$${money(Math.abs(v))}`}
            />
          </strong>
          <span className={pnl >= 0 ? "mw-ok" : "mw-bad"}>
            {returnPct >= 0 ? "+" : ""}
            {returnPct.toFixed(2)}%
          </span>
        </div>
        <div className="mw-equity-range" aria-label="资金曲线范围">
          {(
            [
              ["hour", "近1小时"],
              ["all", "全部"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="mw-equity-chart"
        data-testid="account-equity-chart"
        role="img"
        aria-label={`账户总权益曲线，从${simTime(start)}到${simTime(world.now)}，当前${money(equity)}美元`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 4, bottom: 8, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 5" />
            <XAxis
              type="number"
              dataKey="t"
              domain={[start, end]}
              ticks={ticks}
              tickFormatter={axisTime}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              domain={[
                (min: number) =>
                  Math.floor((min - Math.max(1, Math.abs(min) * 0.0002)) * 100) / 100,
                (max: number) => Math.ceil((max + Math.max(1, Math.abs(max) * 0.0002)) * 100) / 100,
              ]}
              width={76}
              tickFormatter={(value) => `$${money(Number(value))}`}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-line)",
                borderRadius: 12,
                color: "var(--color-fg)",
              }}
              labelFormatter={(value) => `已运行 ${simTime(Number(value))}`}
              formatter={(value, name) => [
                `$${money(Number(value))}`,
                name === "equity" ? "总权益" : "不操作基准",
              ]}
            />
            <Line
              type="linear"
              dataKey="baseline"
              stroke="var(--color-muted)"
              strokeDasharray="4 5"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="equity"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={data.length === 1 ? { r: 3 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mw-equity-legend">
        <span>
          <i />
          总权益
        </span>
        <span>
          <i />
          不操作基准
        </span>
        <span>模拟时钟</span>
      </div>
      <div className="mw-equity-metrics">
        <Metric label="起始资金" value={`$${money(world.initialEquity)}`} />
        <Metric label="最大回撤" value={`${world.maxDrawdownPct.toFixed(2)}%`} />
        <Metric label="已计费用" value={`$${money(world.feesUsd)}`} />
        <Metric
          label="实际成交"
          value={`${world.transactions.filter((tx) => tx.status === "confirmed" && (tx.type === "buy" || tx.type === "sell")).length} 笔`}
        />
      </div>
      <TrainingDisclosure title="计算方式">
        <p>
          总权益汇总三条链的现金、在途资金和持仓预计净退出价值，计入已发生的费用。无法退出的资产按可回收金额计价。
        </p>
        <p>
          虚线是不做交易、保留原钱包的对照。曲线保留已保存采样，并补上当前值；汇率波动也会影响权益。
        </p>
      </TrainingDisclosure>
    </section>
  );
}
