import type { WorldReport } from "../world/types.ts";

export interface WorldReviewQuestion {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  weight: number;
  explanation: string;
}

function legacyQuestions(report: WorldReport): WorldReviewQuestion[] {
  return [
    {
      id: "fact",
      prompt: "本场扣除全部成本后的净结果是？",
      options: ["净盈利", "净亏损", "基本持平"],
      answer: report.pnl > 0.005 ? 0 : report.pnl < -0.005 ? 1 : 2,
      weight: 30,
      explanation: "以实际结算的净回款比较初始权益，不能拿最高价代替。",
    },
    {
      id: "cause",
      prompt: "对本场估值与执行，哪项归因正确？",
      options:
        report.residual > 0
          ? [
              "仍有未退出资产，按保守可回收口径处理",
              "所有持仓都按最高价卖出了",
              "无法退出等于没有损失",
            ]
          : [
              "净结果已包含实际费用和退出条件",
              "显示涨幅就是实际净利润",
              "所有费用应再从最终权益扣一次",
            ],
      answer: 0,
      weight: 30,
      explanation:
        report.residual > 0 ? "残余资产不能生成虚假卖单。" : "已发生的费用不能重复扣除。",
    },
    {
      id: "next",
      prompt: "下一场如何检验修正，而不挑选结果？",
      options: [
        "保留本场，按冻结策略完成下一未知世界并核对成本",
        "删掉亏损场，只统计好结果",
        "为了回本临时扩大预算",
      ],
      answer: 0,
      weight: 40,
      explanation: "保留完整证据，按同一研究版本检验，而不是事后改写策略。",
    },
  ];
}

/** Choice positions vary deterministically by report identity. The evidence and
 * answer cannot change when a learner retries or imports the same report. */
function rotateQuestion(question: WorldReviewQuestion, worldId: string): WorldReviewQuestion {
  const hash = Array.from(`${worldId}:${question.id}`).reduce(
    (n, char) => Math.imul(n ^ char.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
  const offset = hash % question.options.length;
  return {
    ...question,
    options: [...question.options.slice(offset), ...question.options.slice(0, offset)],
    answer: (question.answer - offset + question.options.length) % question.options.length,
  };
}

/** New exams ask about the actual frozen evidence, rather than awarding a
 * completion score for generic text or inferring skill from a profitable trade. */
export function buildWorldReviewQuestions(report: WorldReport): WorldReviewQuestion[] {
  if (!report.assessmentVersion || !report.process) return legacyQuestions(report);
  const process = report.process;
  const check =
    process.checks.find((item) => item.passed === false) ??
    process.checks.find((item) => item.passed === true);
  const outcome =
    report.outcomes?.find((item) => item.classification === "rug") ??
    report.outcomes?.find((item) => item.classification === "dump") ??
    report.outcomes?.find((item) => item.classification === "quality") ??
    report.outcomes?.[0];
  const weakness = process.weaknesses[0] ?? "保留本场证据，按同一计划在下一未知世界继续检验";
  const questions: WorldReviewQuestion[] = [
    {
      id: "fact",
      prompt: `本场初始 ${report.initial.toFixed(2)}、净退出 ${report.final.toFixed(2)} 训练美元，扣除成本后的结果是？`,
      options: ["净盈利", "净亏损", "基本持平"],
      answer: report.pnl > 0.005 ? 0 : report.pnl < -0.005 ? 1 : 2,
      weight: 15,
      explanation: `已结算净盈亏 ${report.pnl.toFixed(2)}；不能用盘中最高价或单币涨幅替代。`,
    },
    {
      id: "cost",
      prompt: `本场已记费用 ${report.fees.toFixed(2)} 训练美元，如何核对最终权益？`,
      options: [
        "费用已经进入净权益，核对明细但不重复扣除",
        "再扣一次全部费用才算净结果",
        "只要有盈利就忽略费用与冲击",
      ],
      answer: 0,
      weight: 15,
      explanation: `净权益 ${report.final.toFixed(2)} 已包含已记成本；价格冲击也已体现在实际成交数量中。`,
    },
    {
      id: "execution",
      prompt: check
        ? `执行证据「${check.label}」支持哪项结论？`
        : "本场没有足够的已确认计划执行证据，能得出什么结论？",
      options: check
        ? [
            check.passed ? "该检查已满足，但不能证明未来盈利" : "该检查未满足，应按证据修正操作",
            "只要本场盈利就等于完全执行了计划",
            "填写交易理由就能证明操作合格",
          ]
        : [
            "缺少执行样本，需要继续完成有计划的实际操作",
            "没有操作就等于已经掌握所有交易能力",
            "复制一段长备注可以补足成交证据",
          ],
      answer: 0,
      weight: 20,
      explanation: check
        ? `${check.detail}${check.eventIds.length ? `；事件依据：${check.eventIds.join("、")}` : ""}`
        : "缺少样本不能自动认定已掌握执行能力，空仓也不构成有计划成交的替代证据。",
    },
    {
      id: "exit",
      prompt: `本场结算保留 ${report.residual} 项残余资产，应该怎样理解退出结果？`,
      options:
        report.residual > 0
          ? [
              "有资产未能按期退出，应核对权限、池深度和链费证据",
              "残余资产按最高价计入已实现盈利",
              "没有卖出就不能记为风险或损失",
            ]
          : [
              "已按结算规则核算退出，仍需检查主动退出是否遵守原计划",
              "期末系统退出证明每笔主动退出都及时",
              "没有残余就代表没有冲击、链费或亏损",
            ],
      answer: 0,
      weight: 20,
      explanation:
        report.residual > 0
          ? "无法回收的部分保留为残余证据，不能伪造卖出。"
          : "期末系统清仓只是结算措施，不能替代交易中对失效价、目标和持有期限的执行检查。",
    },
    {
      id: "outcome",
      prompt: outcome
        ? `项目 ${outcome.symbol} 的结算分类是「${outcome.label}」，哪项解释与实际证据一致？`
        : "当前没有足够的逐币结算证据，应如何归类？",
      options: [
        outcome?.reason ?? "保留证据不足的结论，不能凭涨跌断言rug或高质量",
        "所有下跌都能证明创建者实施了rug",
        "只要曾经上涨就能证明它是高质量项目",
      ],
      answer: 0,
      weight: 15,
      explanation: outcome
        ? `观察 ${Math.round(outcome.ageSeconds)} 秒，结算涨幅 ${outcome.returnPct.toFixed(2)}%；${outcome.reason}${outcome.eventIds.length ? `；事件：${outcome.eventIds.join("、")}` : ""}`
        : "分类使用已经执行的事件、权限和可退出能力，不能把隐藏意图或失败攻击当作事实。",
    },
    {
      id: "next",
      prompt: "依据本场执行证据，下一场优先检验哪项改进？",
      options: [
        weakness,
        "删除本场亏损或失败记录，只保留好成绩",
        "临时放大仓位，把下一场收益当作对本场的修正",
      ],
      answer: 0,
      weight: 15,
      explanation: `${weakness}。改进须在下一未知场景产生新的实际证据，复盘答案不会改写本场成交。`,
    },
  ];
  return questions.map((question) => rotateQuestion(question, report.worldId));
}
