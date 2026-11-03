import { TrainingSelect } from "@/components/training-select";
import { useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BookOpen, History } from "lucide-react";
import { useWorld } from "@/lib/world/store";
import { readRecord, validateWorld } from "@/lib/world/repository";
import { useAcademy, worldReviewScore } from "@/lib/academy/store";
import { TrainingCoach } from "@/components/training-coach";
import { AnimatedValue, TextReveal, TrainingDisclosure } from "@/components/training-ui";
import { compact, money } from "@/lib/world/amount";
import type { World, WorldReport } from "@/lib/world/types";
import { ActionButton, EmptyState, Metric, simTime } from "./shared";
import { ProcessReview } from "./process-review";
const regimes = {
  inflow: "资金流入",
  rotation: "震荡轮动",
  outflow: "资金流出",
  stress: "拥堵与风险压力",
};
export function ReviewPanel({
  world,
  onAcademy,
}: {
  world: World | null;
  onAcademy: (reviewSeed?: string) => void;
}) {
  const reports = useWorld((state) => state.reports);
  const academy = useAcademy((state) => state.data);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [archived, setArchived] = useState<World | null>(null);
  const [chartError, setChartError] = useState("");
  const list = [...reports];
  if (world?.report && !list.some((report) => report.worldId === world.id)) list.push(world.report);
  const sorted = list.slice().reverse();
  const report = sorted.find((report) => report.worldId === selectedReportId) ?? sorted[0];
  const slot = report
    ? academy.profitGroups
        .flatMap((group) => group.slots)
        .find((slot) => slot.report?.worldId === report.worldId)
    : undefined;
  const reviewed = Boolean(slot?.reviewAttempts?.length);
  const reviewScore = slot ? worldReviewScore(slot) : null;
  const chartWorld =
    world?.id === report?.worldId ? world : archived?.id === report?.worldId ? archived : null;
  useEffect(() => {
    let active = true;
    setArchived(null);
    setChartError("");
    if (report && world?.id !== report.worldId) {
      void readRecord<World>("history", report.worldId)
        .then((saved) => {
          if (!active) return;
          if (saved && validateWorld(saved)) setArchived(saved);
          else setChartError("历史曲线暂不可读取，结算与事件记录仍保留。");
        })
        .catch(() => {
          if (active) setChartError("历史曲线读取失败，可重选报告再试。");
        });
    }
    return () => {
      active = false;
    };
  }, [report?.worldId, world?.id]);
  if (!report)
    return (
      <div className="mw-review-view">
        <EmptyState icon={<History size={24} />} title="结束一场，再看完整结果">
          自由世界可以主动结束；正式世界须到固定时间结算。
        </EmptyState>
        <ActionButton secondary onClick={() => onAcademy()}>
          <BookOpen size={18} />
          练习交易与复盘
        </ActionButton>
      </div>
    );
  const displayReport: WorldReport =
    reviewScore === null
      ? report
      : {
          ...report,
          discipline: { ...report.discipline, review: reviewScore },
        };
  return (
    <div className="mw-review-view">
      <label className="mw-label">
        已结算世界
        <TrainingSelect
          value={report.worldId}
          onValueChange={setSelectedReportId}
          options={sorted.map((item, index) => ({
            value: item.worldId,
            label: `${item.mode === "exam" ? "正式考核" : item.mode === "practice" ? "专项练习" : "自由世界"} · ${item.seed} · ${index + 1}`,
          }))}
          aria-label="已结算世界"
        />
      </label>
      <ReportSummary key={report.worldId} report={report} />
      <ProcessReview key={`process-${report.worldId}`} report={report} />
      {report.mode === "exam" && (
        <section className="mw-review-next">
          <TextReveal
            as="h3"
            text={
              reviewed
                ? "本场复盘已保存"
                : report.process?.version === "process-v2-trading"
                  ? "回看这一场。"
                  : "把本场复盘补完整。"
            }
          />
          <p>
            {reviewed
              ? `结构化复盘 ${reviewScore}/100，答案不会改写原始成交和净结果。`
              : report.process?.version === "process-v2-trading"
                ? "交易、费用和结果已保存。回看这场的操作，再进入下一场。"
                : "结算不会自动获得复盘分。识别净结果、解释原因，再选择下一场要检验的动作。"}
          </p>
          <ActionButton onClick={() => onAcademy(report.seed)}>
            {reviewed
              ? "查看本场复盘"
              : report.process?.version === "process-v2-trading"
                ? "查看交易回看"
                : "完成本场复盘"}
            <BookOpen size={18} />
          </ActionButton>
        </section>
      )}
      <TrainingDisclosure
        title="过程与纪律"
        summary={`风险 ${Math.round(report.discipline.risk)} · 执行 ${report.process?.decisions === 0 ? "无样本" : Math.round(report.discipline.execution)} · ${report.violations} 次越界`}
        defaultOpen={report.violations > 0}
      >
        <div className="mw-stats-row">
          <Metric label="风险决策" value={`${Math.round(report.discipline.risk)} / 100`} />
          <Metric
            label="交易执行"
            value={
              report.process?.decisions === 0
                ? "无执行样本"
                : `${Math.round(report.discipline.execution)} / 100`
            }
          />
          <Metric
            label="结构化复盘"
            value={
              reviewed ? `${reviewScore} / 100` : report.mode === "exam" ? "待完成" : "自由复盘"
            }
          />
          <Metric
            label="确认越界"
            value={report.violations}
            tone={report.violations ? "bad" : "ok"}
          />
        </div>
        <p>
          {report.violations
            ? "先检查已确认的预算与保护越界，盈利不会抹掉这些证据。"
            : "未记录主动风险越界。还需多个未知世界检验结果能否重复。"}
        </p>
        {report.residual > 0 && (
          <p className="mw-inline-error">
            结算时仍有 {report.residual} 项残余资产，按保守可回收口径估值，未伪造卖出。
          </p>
        )}
      </TrainingDisclosure>
      <TrainingDisclosure title="权益曲线" summary="净退出权益与原始钱包基准">
        {chartWorld && chartWorld.equity.length > 1 ? (
          <div className="mw-chart mw-equity-chart chart-in">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartWorld.equity}
                margin={{ left: 0, right: 8, top: 12, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="3 5" />
                <XAxis
                  dataKey="t"
                  tickFormatter={(value: number) => `${Math.floor(value / 60)}m`}
                  minTickGap={50}
                  tick={{ fill: "var(--color-muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(value: number) =>
                    Math.abs(value) > 0 && Math.abs(value) < 0.01 ? compact(value) : money(value)
                  }
                  width={80}
                  tick={{ fill: "var(--color-muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  itemStyle={{ color: "var(--color-fg)" }}
                  labelStyle={{ color: "var(--color-muted)" }}
                  labelFormatter={(value) => simTime(Number(value))}
                  formatter={(value, name) => [
                    `$${money(Number(value))}`,
                    name === "equity" ? "净退出权益" : "原钱包基准",
                  ]}
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    color: "var(--color-fg)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 12,
                  }}
                />
                <Area
                  type="linear"
                  dataKey="equity"
                  stroke="var(--color-primary)"
                  fill="var(--color-primary)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="baseline"
                  stroke="var(--color-muted)"
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mw-muted">{chartError || "正在读取已保存的曲线…"}</p>
        )}
      </TrainingDisclosure>
      <TrainingDisclosure title="本次事件明细" summary="成交、费用、异常与原始决定">
        <div className="mw-event-list">
          {report.events
            .slice(-30)
            .reverse()
            .map((event) => (
              <div className={`mw-event ${event.violation ? "mw-bad" : ""}`} key={event.id}>
                <time>{simTime(event.at)}</time>
                <span>{event.message}</span>
              </div>
            ))}
        </div>
      </TrainingDisclosure>
      <TrainingDisclosure title="复盘教练" summary="先看规则反馈，也可主动请求 AI 解释">
        <div className="mw-coach">
          <TrainingCoach report={displayReport} />
        </div>
      </TrainingDisclosure>
      <p className="mw-footnote">
        仅反映当前模拟模型。一个盈利世界不能证明稳定盈利，正式观察需要完整的 24 个未知世界。
      </p>
      <ActionButton secondary onClick={() => onAcademy()}>
        <BookOpen size={18} />
        查看交易考核与补练
      </ActionButton>
    </div>
  );
}
function ReportSummary({ report }: { report: WorldReport }) {
  return (
    <section className="mw-panel mw-report-summary">
      <p className="mw-caption">
        {report.completed ? "已结算" : "未完整结算"} · {regimes[report.regime]} ·{" "}
        {simTime(report.elapsed)}
      </p>
      <TextReveal as="h2" text="成本后，真正留下多少。" />
      <strong className={`mw-report-net ${report.pnl >= 0 ? "mw-ok" : "mw-bad"}`}>
        <AnimatedValue
          value={report.pnl}
          format={(value) => `${value >= 0 ? "+" : "−"}$${money(Math.abs(value))}`}
        />
      </strong>
      <p className="mw-muted">
        净收益 {report.returnPct >= 0 ? "+" : ""}
        {report.returnPct.toFixed(2)}% · 相对原钱包 {report.excessPct >= 0 ? "+" : ""}
        {report.excessPct.toFixed(2)}%
      </p>
      <div className="mw-report-grid">
        <Metric label="初始权益" value={`$${money(report.initial)}`} />
        <Metric label="结算净权益" value={`$${money(report.final)}`} />
        <Metric label="已计费用" value={`$${money(report.fees)}`} />
        <Metric label="最大回撤" value={`${report.maxDrawdownPct.toFixed(2)}%`} />
        <Metric label="实际成交" value={`${report.trades} 笔`} />
        <Metric label="残余资产" value={`${report.residual} 项`} />
      </div>
    </section>
  );
}
