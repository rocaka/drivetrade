import type { Regime, WorldReport } from "../world/types.ts";
import {
  KNOWLEDGE_QUESTIONS,
  LESSONS,
  CURRICULUM_VERSION,
  LEGACY_CURRICULUM_VERSION,
  LEGACY_LESSONS,
  LEGACY_KNOWLEDGE_QUESTIONS,
  checkAnswers,
  getKnowledgeQuestionsForAttempt,
} from "./content.ts";
import {
  FORMAL_SCENARIOS,
  PRACTICE_SCENARIOS,
  LEGACY_FORMAL_SCENARIOS,
  LEGACY_PRACTICE_SCENARIOS,
  gradeScenario,
  isCurrentFormalRound,
  type ScenarioAnswers,
} from "./scenarios.ts";

export const GRADING_VERSION = "3.0.0-trading";
export const REGIMES: Regime[] = ["inflow", "rotation", "outflow", "stress"];
export const REGIME_LABELS: Record<Regime, string> = {
  inflow: "资金流入",
  rotation: "震荡轮动",
  outflow: "资金流出",
  stress: "拥堵与风险压力",
};
export interface ProfitEvaluation {
  complete: boolean;
  passed: boolean;
  valid: number;
  required: number;
  wins: number;
  net: number;
  median: number;
  profitFactor: number | null;
  trimmedNet: number;
  lowerBound: number | null;
  checks: { id: string; label: string; passed: boolean | null; detail: string }[];
  errors: string[];
  byRegime: { regime: Regime; count: number; pnl: number; wins: number }[];
}
type ExpectedWorld = {
  seed: string;
  regime: Regime;
  marketVariant: "standard" | "thin" | "busy" | "costly";
  generationProfile?: "mixed-v1";
  assessmentVersion?: "process-v1" | "process-v2-trading";
};
const variants = ["standard", "thin", "busy", "costly"] as const;
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function stratifiedLowerBound(reports: WorldReport[], iterations = 10000): number | null {
  const strata = REGIMES.map((regime) => reports.filter((r) => r.regime === regime));
  if (strata.some((group) => group.length !== 6)) return null;
  const random = rng(0xaccad202);
  const results: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (const group of strata)
      for (let k = 0; k < 6; k++) total += group[Math.floor(random() * 6)].excessPct;
    results.push(total / 24);
  }
  results.sort((a, b) => a - b);
  return results[Math.max(0, Math.ceil(iterations * 0.1) - 1)];
}
export function evaluateProfitStability(
  reports: WorldReport[],
  expectedSeeds?: string[],
  expectedConfig?: readonly ExpectedWorld[],
): ProfitEvaluation {
  const errors: string[] = [];
  const seeds = new Set<string>(),
    worlds = new Set<string>();
  const valid: WorldReport[] = [];
  for (const r of reports) {
    if (seeds.has(r.seed) || worlds.has(r.worldId)) {
      errors.push("存在重复世界或重复种子，不能重复计入证据");
      continue;
    }
    seeds.add(r.seed);
    worlds.add(r.worldId);
    if (r.mode !== "exam" || !r.completed || r.elapsed < 7200) {
      errors.push("正式世界必须完成固定120分钟并有效结算");
      continue;
    }
    if (
      !REGIMES.includes(r.regime) ||
      ![r.initial, r.final, r.pnl, r.returnPct, r.baselineReturnPct, r.excessPct, r.fees].every(
        Number.isFinite,
      ) ||
      r.initial <= 0 ||
      r.final < 0
    ) {
      errors.push("报告数值或环境无效");
      continue;
    }
    if (
      Math.abs(r.final - r.initial - r.pnl) > 0.05 ||
      Math.abs(r.returnPct - (r.pnl / r.initial) * 100) > 0.001 ||
      Math.abs(r.excessPct - (r.returnPct - r.baselineReturnPct)) > 0.001
    ) {
      errors.push("收益、退出资产与对照数据不一致");
      continue;
    }
    if (expectedSeeds && !expectedSeeds.includes(r.seed)) {
      errors.push("报告不属于本次冻结观察组");
      continue;
    }
    if (!r.marketVariant || !variants.includes(r.marketVariant)) {
      errors.push("报告缺少有效的样本外市场配置");
      continue;
    }
    if (expectedConfig) {
      const slot = expectedConfig.find((s) => s.seed === r.seed);
      if (
        !slot ||
        slot.regime !== r.regime ||
        slot.marketVariant !== r.marketVariant ||
        slot.generationProfile !== r.generationProfile ||
        slot.assessmentVersion !== r.assessmentVersion ||
        (slot.assessmentVersion !== undefined &&
          (r.process?.version !== slot.assessmentVersion ||
            r.process.score !== r.discipline.execution))
      ) {
        errors.push("报告使用的样本外配置与冻结清单不同");
        continue;
      }
    }
    valid.push(r);
  }
  if (reports.length > 24) errors.push("一组只能使用冻结的24个世界，不能挑选最佳结果");
  const byRegime = REGIMES.map((regime) => {
    const group = valid.filter((r) => r.regime === regime);
    return {
      regime,
      count: group.length,
      pnl: group.reduce((s, r) => s + r.pnl, 0),
      wins: group.filter((r) => r.pnl > 0).length,
    };
  });
  const variantCovered = variants.every(
    (variant) => valid.filter((r) => r.marketVariant === variant).length === 6,
  );
  const complete =
    valid.length === 24 &&
    errors.length === 0 &&
    byRegime.every((s) => s.count === 6) &&
    variantCovered &&
    (!expectedSeeds ||
      (expectedSeeds.length === 24 &&
        expectedSeeds.every((s) => valid.some((r) => r.seed === s)))) &&
    (!expectedConfig || expectedConfig.length === 24);
  const net = valid.reduce((s, r) => s + r.pnl, 0);
  const wins = valid.filter((r) => r.pnl > 0).length;
  const sorted = valid.map((r) => r.returnPct).sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
    : 0;
  const positive = valid.reduce((s, r) => s + Math.max(0, r.pnl), 0),
    negative = valid.reduce((s, r) => s + Math.max(0, -r.pnl), 0);
  const profitFactor = negative > 0 ? positive / negative : null;
  const trimmedNet = net - Math.max(0, ...valid.map((r) => r.pnl));
  const lowerBound = complete ? stratifiedLowerBound(valid) : null;
  const processRequired =
    expectedConfig?.some((slot) => !!slot.assessmentVersion) ||
    valid.some((report) => !!report.assessmentVersion);
  const tradingRequired =
    expectedConfig?.some((slot) => slot.assessmentVersion === "process-v2-trading") ||
    valid.some((report) => report.assessmentVersion === "process-v2-trading");
  const sampled = valid.filter(
    (report) => !!report.assessmentVersion && report.process && report.process.decisions > 0,
  );
  const processDecisions = sampled.reduce((sum, report) => sum + report.process!.decisions, 0);
  const sampledRegimes = new Set(sampled.map((report) => report.regime)).size;
  const exitSamples = sampled.flatMap((report) =>
    report
      .process!.checks.filter((check) => check.id.endsWith(":exit") && check.passed === true)
      .map((check) => ({ regime: report.regime, transactionId: check.transactionId })),
  );
  const exitRegimes = new Set(exitSamples.map((sample) => sample.regime)).size;
  const exitCoverage = exitSamples.length >= 4 && exitRegimes >= 2;
  const processCoverage =
    valid.every(
      (report) =>
        report.assessmentVersion === (tradingRequired ? "process-v2-trading" : "process-v1") &&
        report.process?.version === report.assessmentVersion,
    ) &&
    processDecisions >= 8 &&
    sampled.length >= 4 &&
    sampledRegimes >= 2;
  const riskPassed = valid.every(
    (r) =>
      r.violations === 0 &&
      r.discipline.risk >= 90 &&
      ((processRequired && !!r.assessmentVersion && r.process?.decisions === 0) ||
        r.discipline.execution >= 80) &&
      (r.assessmentVersion === "process-v2-trading" || r.discipline.review >= 75),
  );
  const checks: ProfitEvaluation["checks"] = [
    {
      id: "coverage",
      label: "24个完整世界，四类环境各6个",
      passed: complete,
      detail: `有效 ${valid.length}/24；中途退出、重复种子和不一致报告不计通过`,
    },
    {
      id: "holdout",
      label: "冻结的四种样本外配置各6场",
      passed: complete && variantCovered,
      detail: "标准、薄池、密集拥堵、较高成本配置不能由学员挑选或事后改写",
    },
    {
      id: "net",
      label: "成本后合计盈利",
      passed: complete && net > 0,
      detail: `合计 ${net.toFixed(2)} 训练美元，已使用退出净值而非最高价`,
    },
    {
      id: "median",
      label: "至少15场净盈利，中位收益为正",
      passed: complete && wins >= 15 && median > 0,
      detail: `盈利 ${wins}/24；中位数 ${median.toFixed(2)}%`,
    },
    {
      id: "pf",
      label: "世界盈亏比至少1.2",
      passed: complete ? (profitFactor === null ? null : profitFactor >= 1.2) : false,
      detail:
        profitFactor === null
          ? "无亏损样本：该项不适用，不能解读为无限能力"
          : `正世界收益 ÷ 负世界损失 = ${profitFactor.toFixed(2)}`,
    },
    {
      id: "outlier",
      label: "去掉最佳世界后仍净盈利",
      passed: complete && trimmedNet > 0,
      detail: `去掉最佳后的合计 ${trimmedNet.toFixed(2)}`,
    },
    {
      id: "bootstrap",
      label: "分层重采样超额结果下界为正",
      passed: complete && lowerBound !== null && lowerBound > 0,
      detail:
        lowerBound === null
          ? "证据不完整，暂不计算"
          : "10,000次分层重采样，第10百分位 " + lowerBound.toFixed(3) + "%（模型内观察）",
    },
    {
      id: "risk",
      label: tradingRequired ? "真实交易风险与执行达标" : "正式世界无主动越界且复盘完成",
      passed: complete && riskPassed,
      detail: tradingRequired
        ? "各场风险≥90、确认买入场执行≥80、重大违规为零；空仓场不强迫交易，答题复盘可选"
        : processRequired
          ? "各场风险≥90、已确认买入场执行≥80、实际复盘≥75、重大违规为零；空仓场执行不适用，不能替代整组操作样本"
          : "各场风险≥90、执行≥80、实际结构化复盘≥75、重大违规为零",
    },
  ];
  if (processRequired)
    checks.push({
      id: "process-coverage",
      label: "真实计划执行样本覆盖",
      passed: complete && processCoverage,
      detail: `至少8笔确认计划买入，覆盖4个世界和2类环境；当前${processDecisions}笔／${sampled.length}世界／${sampledRegimes}环境。等待场保留，不要求为得分强行交易。`,
    });
  if (processRequired)
    checks.push({
      id: "exit-coverage",
      label: "真实退出执行样本覆盖",
      passed: complete && exitCoverage,
      detail: `至少4笔计划退出及时提交，覆盖2类环境；当前${exitSamples.length}笔／${exitRegimes}环境。仅计原始过程检查中已确认的主动或计划触发退出，期末系统清仓和未触发条件不计入。`,
    });
  return {
    complete,
    passed: complete && checks.every((c) => c.passed !== false),
    valid: valid.length,
    required: 24,
    wins,
    net,
    median,
    profitFactor,
    trimmedNet,
    lowerBound,
    checks,
    errors: [...new Set(errors)],
    byRegime,
  };
}

export interface KnowledgeAttempt {
  id: string;
  at: string;
  answers: Record<string, number>;
  curriculumVersion?: string;
}
export interface ScenarioAttempt {
  id: string;
  at: string;
  scenarioId: string;
  formal: boolean;
  roundId: string | null;
  answers: ScenarioAnswers;
}
export interface FormalRound {
  id: string;
  group: 0 | 1;
  startedAt: string;
  finishedAt?: string;
  abandoned?: boolean;
  curriculumVersion?: string;
}
export function evaluateDiscipline(
  lessonIds: string[],
  knowledge: KnowledgeAttempt[],
  attempts: ScenarioAttempt[],
  rounds: FormalRound[],
  curriculumVersion: string = CURRICULUM_VERSION,
) {
  const legacy = curriculumVersion === LEGACY_CURRICULUM_VERSION;
  const questions = legacy ? LEGACY_KNOWLEDGE_QUESTIONS : KNOWLEDGE_QUESTIONS;
  const lessons = legacy ? LEGACY_LESSONS : LESSONS;
  const formalScenarios = legacy ? LEGACY_FORMAL_SCENARIOS : FORMAL_SCENARIOS;
  const practiceScenarios = legacy ? LEGACY_PRACTICE_SCENARIOS : PRACTICE_SCENARIOS;
  const latestKnowledge = knowledge
    .filter((attempt) => getKnowledgeQuestionsForAttempt(attempt) === questions)
    .at(-1);
  const k = latestKnowledge
    ? checkAnswers(questions, latestKnowledge.answers)
    : { score: 0, complete: false, criticalPassed: false, wrong: [] as string[] };
  const groups = ([0, 1] as const).map((group) => {
    const round = rounds
      .filter(
        (r) => r.group === group && !r.abandoned && isCurrentFormalRound(r, attempts) !== legacy,
      )
      .at(-1);
    const scenarios = formalScenarios.slice(group * 4, group * 4 + 4);
    const grades = scenarios.map((s) => {
      const a = attempts.find((a) => a.roundId === round?.id && a.scenarioId === s.id);
      return a ? gradeScenario(s, a.answers) : null;
    });
    const complete = !!round?.finishedAt && grades.every((g) => g?.complete);
    const risk = grades.reduce((sum, g) => sum + (g?.risk ?? 0), 0) / 4;
    const execution = grades.reduce((sum, g) => sum + (g?.execution ?? 0), 0) / 4;
    const review = grades.reduce((sum, g) => sum + (g?.review ?? 0), 0) / 4;
    const total = 0.25 * k.score + 0.35 * risk + 0.25 * execution + 0.15 * review;
    return {
      group,
      roundId: round?.id,
      complete,
      risk,
      execution,
      review,
      total,
      passed:
        complete &&
        k.complete &&
        k.score >= 85 &&
        k.criticalPassed &&
        risk >= 90 &&
        execution >= 80 &&
        review >= 75 &&
        total >= 85,
    };
  });
  const practiceIds = new Set(
    attempts
      .filter(
        (a) =>
          !a.formal &&
          practiceScenarios.some(
            (s) => s.id === a.scenarioId && gradeScenario(s, a.answers).complete,
          ),
      )
      .map((a) => a.scenarioId),
  );
  const completeLessons = lessons.filter((lesson) => lessonIds.includes(lesson.id)).length;
  return {
    knowledge: k,
    groups,
    completeLessons,
    practiceCount: practiceIds.size,
    passed: completeLessons === 24 && practiceIds.size === 12 && groups.every((g) => g.passed),
  };
}
