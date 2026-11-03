import { useState } from "react";
import { BookOpen, Sparkles } from "lucide-react";
import type { WorldReport } from "@/lib/world/types";
import { explainTraining } from "@/lib/academy/explain";
type Explanation = { summary: string; evidenceRefs: string[]; nextPractice: string[] };
export function TrainingCoach({ report }: { report: WorldReport }) {
  const [answer, setAnswer] = useState<Explanation | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const template =
    report.violations > 0
      ? "先回看已确认的超预算行为。盈利不能抵消风险越界。"
      : report.residual > 0
        ? "本场有无法退出的资产。重点比较参考市值与真正能拿回的钱。"
        : report.fees > Math.max(0, report.pnl)
          ? "成本是本场的重要影响因素。对照交易次数、池冲击和链费，寻找可以少做的操作。"
          : "把本场当作一个样本。保留当时计划，换一个未知市场再检验，而不是根据事后赢家改答案。";
  async function run() {
    setPending(true);
    setError("");
    try {
      const summary = JSON.stringify({
        world: report.worldId,
        pnl: report.pnl,
        fees: report.fees,
        violations: report.violations,
        residual: report.residual,
        drawdown: report.maxDrawdownPct,
        discipline: report.discipline,
        assessmentVersion: report.assessmentVersion ?? "legacy",
        process: report.process
          ? {
              score: report.process.score,
              decisions: report.process.decisions,
              weaknesses: report.process.weaknesses.slice(0, 3).map((s) => s.slice(0, 120)),
              checks: report.process.checks
                .filter((c) => c.passed === false)
                .slice(0, 4)
                .map((c) => ({
                  label: c.label,
                  detail: c.detail.slice(0, 120),
                  eventIds: c.eventIds.slice(0, 2),
                })),
            }
          : undefined,
        outcomes: report.outcomes
          ? {
              quality: report.outcomes.filter((o) => o.classification === "quality").length,
              rug: report.outcomes.filter((o) => o.classification === "rug").length,
              dump: report.outcomes.filter((o) => o.classification === "dump").length,
            }
          : undefined,
      });
      const events = report.events
        .slice(-40)
        .map((e) => ({ id: e.id.slice(0, 120), message: e.message.slice(0, 240) }));
      const result = await explainTraining({ data: { summary, events } });
      if (result.ok) {
        setAnswer(result.analysis);
      } else setError(result.error);
    } catch {
      setError("解释暂不可用，已保留规则复盘。");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="mw-panel">
      <h3 className="mw-section-title">
        <BookOpen size={18} />
        复盘教练
      </h3>
      <p className="mw-muted">{template}</p>
      <p className="mw-muted">点击后仅将本场摘要与最多40条训练事件发送至 xAI。AI 不参与评分。</p>
      <button className="mw-button" disabled={pending} onClick={() => void run()}>
        <Sparkles size={16} />
        {pending ? "正在解释…" : "让 AI 解释本场"}
      </button>
      {error && (
        <p role="status" className="mw-muted">
          {error}
        </p>
      )}
      {answer && (
        <div>
          <p>{answer.summary}</p>
          <ul>
            {answer.nextPractice.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <small>事件依据：{answer.evidenceRefs.join("、") || "摘要"}</small>
        </div>
      )}
    </section>
  );
}
