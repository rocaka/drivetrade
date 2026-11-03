import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { simulateProfit } from "@/lib/academy/profit-sim";
import "./profit-simulator.css";

const WIN_RATES = [0.3, 0.4, 0.5, 0.6] as const;
const WIN_RS = [1, 1.5, 1.8, 2.5, 3] as const;
const RISKS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2] as const;
const TRADES = 100;
const PATHS = 400;
const W = 320,
  H = 150;

const pct = (value: number, digits = 0) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;

function Segment<T extends number>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  format: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="psim-field">
      <span>{label}</span>
      <div className="psim-segment" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Plays a method forward over many simulated runs: edge × size × time. */
export function ProfitSimulator() {
  const [winRate, setWinRate] = useState<(typeof WIN_RATES)[number]>(0.4);
  const [winR, setWinR] = useState<(typeof WIN_RS)[number]>(1.8);
  const [risk, setRisk] = useState<(typeof RISKS)[number]>(0.01);
  const [seed, setSeed] = useState(1);
  const result = useMemo(
    () => simulateProfit({ winRate, winR, risk, trades: TRADES, paths: PATHS, seed }),
    [winRate, winR, risk, seed],
  );

  // Log scale keeps both a halved and a doubled account readable.
  const all = [...result.sample.flat(), ...result.median];
  const lo = Math.log(Math.max(0.01, Math.min(0.5, ...all))),
    hi = Math.log(Math.max(2, ...all));
  const x = (t: number) => (t / TRADES) * W;
  const y = (v: number) => H - ((Math.log(Math.max(0.01, v)) - lo) / (hi - lo)) * H;
  const path = (curve: number[]) =>
    curve.map((v, t) => `${t ? "L" : "M"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join("");

  const verdict =
    result.expectancyR <= 0
      ? "这组参数每笔期望为负：仓位再小，也只是亏得慢一点。先改进方法本身。"
      : result.ruinShare >= 0.1
        ? `方法本身是赚钱的，但每笔 ${(risk * 100).toFixed(1)}% 太重：${(result.ruinShare * 100).toFixed(0)}% 的路径曾腰斩。降低仓位。`
        : result.profitableShare < 0.7
          ? "期望为正，但优势很薄：100 笔后仍有不少路径亏钱。需要更多样本，或提高盈亏比。"
          : "正期望 + 小仓位：大多数路径稳定向上，连亏和回撤都能扛过去。";

  return (
    <section className="psim" aria-label="稳定盈利模拟器">
      <p className="academy-eyebrow">动手试试 · 稳定盈利模拟器</p>
      <h3>同一个方法，做 {TRADES} 笔会怎样？</h3>
      <p className="psim-lead">
        亏损固定为 −1R。调整胜率、平均盈利和每笔风险，看 {PATHS} 条随机路径的结果。
      </p>
      <Segment
        label="胜率"
        options={WIN_RATES}
        value={winRate}
        format={(v) => `${v * 100}%`}
        onChange={setWinRate}
      />
      <Segment
        label="平均盈利"
        options={WIN_RS}
        value={winR}
        format={(v) => `${v}R`}
        onChange={setWinR}
      />
      <Segment
        label="每笔风险"
        options={RISKS}
        value={risk}
        format={(v) => `${v * 100}%`}
        onChange={setRisk}
      />

      <div className="psim-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="资金曲线">
          <line className="psim-base" x1={0} x2={W} y1={y(1)} y2={y(1)} />
          {result.sample.map((curve, i) => (
            <path key={i} className="psim-path" d={path(curve)} />
          ))}
          <path
            className={`psim-median ${result.median.at(-1)! >= 1 ? "is-up" : "is-down"}`}
            d={path(result.median)}
          />
        </svg>
        <div className="psim-axis">
          <span>第 0 笔</span>
          <span>细线：24 条随机路径 · 粗线：中位数</span>
          <span>第 {TRADES} 笔</span>
        </div>
      </div>

      <dl className="psim-stats">
        <div>
          <dt>每笔期望</dt>
          <dd className={result.expectancyR > 0 ? "is-up" : "is-down"}>
            {result.expectancyR >= 0 ? "+" : "−"}
            {Math.abs(result.expectancyR).toFixed(2)}R
          </dd>
        </div>
        <div>
          <dt>最终赚钱的路径</dt>
          <dd>{(result.profitableShare * 100).toFixed(0)}%</dd>
        </div>
        <div>
          <dt>中位数收益</dt>
          <dd className={result.medianReturnPct >= 0 ? "is-up" : "is-down"}>
            {pct(result.medianReturnPct)}
          </dd>
        </div>
        <div>
          <dt>最差 10% 的结果</dt>
          <dd className={result.worstDecileReturnPct >= 0 ? "is-up" : "is-down"}>
            {pct(result.worstDecileReturnPct)}
          </dd>
        </div>
        <div>
          <dt>典型最大回撤</dt>
          <dd>{pct(-result.medianMaxDrawdownPct)}</dd>
        </div>
        <div>
          <dt>典型最长连亏</dt>
          <dd>{result.medianLosingStreak} 笔</dd>
        </div>
      </dl>
      <p
        className={`psim-verdict ${result.ruinShare >= 0.1 || result.expectancyR <= 0 ? "is-warn" : ""}`}
      >
        {verdict}
      </p>
      <button type="button" className="psim-reroll" onClick={() => setSeed((s) => s + 1)}>
        <RotateCcw size={14} />
        换一批随机路径
      </button>
      <p className="psim-note">
        教学模型：每笔独立、结果只有 +平均盈利 或 −1R，未计滑点与无法退出。现实结果不保证。
      </p>
    </section>
  );
}
