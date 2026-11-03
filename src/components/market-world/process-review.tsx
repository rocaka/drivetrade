import { useMemo, useState } from "react";
import type { WorldReport } from "@/lib/world/types";
import { TrainingDisclosure } from "@/components/training-ui";
import { currencyCompact } from "@/lib/world/amount";
import { simTime } from "./shared";

export function ProcessReview({ report }: { report: WorldReport }) {
  const [filter, setFilter] = useState("all"),
    [limit, setLimit] = useState(12);
  const outcomes = report.outcomes ?? [];
  const rows = useMemo(
    () => outcomes.filter((o) => filter === "all" || o.classification === filter),
    [outcomes, filter],
  );
  if (!report.process) return null;
  return (
    <>
      <TrainingDisclosure
        title={report.process.version === "process-v2-trading" ? "本次交易表现" : "计划与实际操作"}
        summary={
          report.process.decisions
            ? `${report.process.score}分 · ${report.process.decisions}笔已确认买入`
            : "暂无执行样本 · 保留空仓决定"
        }
        defaultOpen
      >
        {report.process.weaknesses.length ? (
          <div className="mw-process-next">
            {report.process.weaknesses.slice(0, 3).map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : (
          <p className="mw-muted">本场已记录的过程检查满足要求，继续在未知市场检验。</p>
        )}
        {report.process.checks.map((check) => (
          <div className="mw-process-check" key={check.id}>
            <div>
              <strong>{check.label}</strong>
              <span
                className={check.passed === false ? "mw-bad" : check.passed ? "mw-ok" : "mw-muted"}
              >
                {check.passed === null ? "无样本" : check.passed ? "满足" : "待改进"}
              </span>
            </div>
            <p className="mw-muted">{check.detail}</p>
            {check.eventIds.length > 0 && (
              <details>
                <summary>查看事件依据</summary>
                {check.eventIds.map((id) => {
                  const event = report.events.find((e) => e.id === id);
                  return event ? (
                    <p key={id}>
                      <time>{simTime(event.at)}</time> · {event.message}
                    </p>
                  ) : (
                    <p key={id}>{id}</p>
                  );
                })}
              </details>
            )}
          </div>
        ))}
      </TrainingDisclosure>
      <TrainingDisclosure title="逐币结算结果" summary={`${outcomes.length} 个项目 · 回看行情结果`}>
        <div className="mw-filter-pills">
          {[
            ["all", "全部"],
            ["quality", "持续赢家"],
            ["rug", "实际攻击"],
            ["dump", "大幅回落"],
            ["inactive", "低活跃"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "is-active" : ""}
              onClick={() => {
                setFilter(id);
                setLimit(12);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mw-muted">
          分类只用于本场事后复盘，不代表真实项目评级。曾经上涨和已实现盈利分开核对。
        </p>
        {rows.slice(0, limit).map((o) => (
          <article
            className="mw-process-outcome"
            key={o.tokenId}
            data-testid="market-token-outcome"
          >
            <div>
              <strong>{o.symbol}</strong>
              <span
                className={
                  o.classification === "rug"
                    ? "mw-bad"
                    : o.classification === "quality"
                      ? "mw-ok"
                      : "mw-muted"
                }
              >
                {o.label}
              </span>
            </div>
            <p>{o.reason}</p>
            <small>
              期末 {o.returnPct.toFixed(1)}% · 最高 {o.peakReturnPct.toFixed(1)}% · 池深度{" "}
              {currencyCompact(o.liquidityUsd)} · 标准退出 {currencyCompact(o.standardExitUsd)}
            </small>
          </article>
        ))}
        {rows.length === 0 && <p className="mw-muted">本场没有这类项目证据。</p>}
        {rows.length > limit && (
          <button className="mw-control-button" onClick={() => setLimit((v) => v + 24)}>
            继续查看
          </button>
        )}
      </TrainingDisclosure>
    </>
  );
}
