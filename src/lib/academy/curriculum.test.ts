import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRICULUM_VERSION,
  LESSONS,
  KNOWLEDGE_QUESTIONS,
  LEGACY_LESSONS,
  LEGACY_KNOWLEDGE_QUESTIONS,
  getLessonById,
  getKnowledgeQuestionsForAttempt,
  checkAnswers,
} from "./content.ts";
import {
  LEGACY_FORMAL_SCENARIOS,
  LEGACY_PRACTICE_SCENARIOS,
  FORMAL_SCENARIOS,
  getScenarioById,
  scenariosForRound,
  gradeScenario,
} from "./scenarios.ts";
import { evaluateDiscipline, type ScenarioAttempt } from "./grading.ts";
import {
  validateAcademy,
  academyEvaluation,
  makeProfitSlots,
  HOLDOUT_VERSION,
  configForProfitSlot,
  currentProfitGroup,
  type AcademyData,
  type ProfitGroup,
} from "./store.ts";
import { makePassingTradingRuns } from "../training-lab/__tests__/fixtures.ts";

const correct = (questions: typeof KNOWLEDGE_QUESTIONS) =>
  Object.fromEntries(questions.map((q) => [q.id, q.answer]));
const scenarioAnswers = (scenario: (typeof FORMAL_SCENARIOS)[number]) =>
  Object.fromEntries(scenario.tasks.map((task) => [task.id, task.numberAnswer ?? task.answer!]));

test("primary course and optional quiz focus on decisions and trading arithmetic", () => {
  assert.equal(LESSONS.length, 24);
  assert.equal(KNOWLEDGE_QUESTIONS.length, 30);
  assert.ok(LESSONS.every((lesson) => lesson.id.startsWith("trade-lesson-")));
  assert.ok(KNOWLEDGE_QUESTIONS.every((q) => q.id.startsWith("trade-q-")));
  assert.doesNotMatch(
    KNOWLEDGE_QUESTIONS.map((q) => q.prompt).join(" "),
    /nonce|合约地址|LP|gas|迁池|虚拟储备|seed|退款协议/i,
  );
  const expectancy = KNOWLEDGE_QUESTIONS.find((q) => q.id === "trade-q-25")!;
  assert.equal(expectancy.options[expectancy.answer], "0.1R");
  const ratio = KNOWLEDGE_QUESTIONS.find((q) => q.id === "trade-q-3")!;
  assert.equal(ratio.options[ratio.answer], "2");
});

test("old identities and answers remain interpretable with their immutable original definitions", () => {
  assert.equal(getLessonById("lesson-5")?.title, "本地 gas");
  assert.equal(getLessonById("lesson-5")?.question.answer, 1);
  assert.equal(getLessonById("trade-lesson-5")?.title, "失效距离与数量");
  assert.equal(getScenarioById("exam-13")?.id, "exam-13");
  assert.equal(getScenarioById("trade-formal-1")?.id, "trade-formal-1");
  const oldAttempt = { answers: correct(LEGACY_KNOWLEDGE_QUESTIONS) };
  assert.equal(getKnowledgeQuestionsForAttempt(oldAttempt), LEGACY_KNOWLEDGE_QUESTIONS);
  assert.equal(
    checkAnswers(getKnowledgeQuestionsForAttempt(oldAttempt), oldAttempt.answers).score,
    100,
  );
});

test("legacy curriculum checkpoints remain valid while old answers do not become current optional mastery", () => {
  const rounds = ([0, 1] as const).map((group) => ({
    id: `legacy-${group}`,
    group,
    startedAt: "2026-11-02",
    finishedAt: "2026-11-02",
  }));
  const attempts: ScenarioAttempt[] = [
    ...LEGACY_PRACTICE_SCENARIOS.map((s) => ({
      id: s.id,
      at: "2026-11-02",
      scenarioId: s.id,
      formal: false,
      roundId: null,
      answers: scenarioAnswers(s),
    })),
    ...LEGACY_FORMAL_SCENARIOS.map((s, i) => ({
      id: s.id,
      at: "2026-11-02",
      scenarioId: s.id,
      formal: true,
      roundId: `legacy-${i < 4 ? 0 : 1}`,
      answers: scenarioAnswers(s),
    })),
  ];
  const data: AcademyData = {
    schemaVersion: 1,
    curriculumVersion: "2.0.0",
    sequence: 100,
    lessonAttempts: LEGACY_LESSONS.map((l) => ({
      id: l.id,
      lessonId: l.id,
      answer: l.question.answer,
      at: "2026-11-02",
    })),
    knowledgeAttempts: [
      { id: "old-knowledge", at: "2026-11-02", answers: correct(LEGACY_KNOWLEDGE_QUESTIONS) },
    ],
    formalRounds: rounds,
    scenarioAttempts: attempts,
    profitGroups: [],
  };
  assert.equal(validateAcademy(JSON.parse(JSON.stringify(data))), true);
  assert.deepEqual(scenariosForRound(rounds[0], attempts), LEGACY_FORMAL_SCENARIOS.slice(0, 4));
  assert.equal(
    gradeScenario(getScenarioById(attempts[12].scenarioId)!, attempts[12].answers).execution,
    100,
  );
  const current = evaluateDiscipline(
    data.lessonAttempts.map((l) => l.lessonId),
    data.knowledgeAttempts,
    attempts,
    rounds,
  );
  assert.equal(current.completeLessons, 0);
  assert.equal(current.knowledge.complete, false);
  assert.equal(current.practiceCount, 0);
  const historical = evaluateDiscipline(
    data.lessonAttempts.map((l) => l.lessonId),
    data.knowledgeAttempts,
    attempts,
    rounds,
    "2.0.0",
  );
  assert.equal(historical.knowledge.score, 100);
  assert.equal(historical.completeLessons, 24);
  assert.equal(historical.practiceCount, 12);
  assert.equal(
    historical.passed,
    true,
    "old optional reference scores retain their original meaning",
  );
});

test("version markers cannot reinterpret old answers as new trading quiz evidence", () => {
  const data: AcademyData = {
    schemaVersion: 1,
    curriculumVersion: CURRICULUM_VERSION,
    sequence: 1,
    lessonAttempts: [],
    scenarioAttempts: [],
    formalRounds: [],
    profitGroups: [],
    knowledgeAttempts: [
      {
        id: "mismatch",
        at: "2026-11-03",
        curriculumVersion: CURRICULUM_VERSION,
        answers: correct(LEGACY_KNOWLEDGE_QUESTIONS),
      },
    ],
  };
  assert.equal(validateAcademy(data), false);
  data.knowledgeAttempts[0].answers = correct(KNOWLEDGE_QUESTIONS);
  assert.equal(validateAcademy(data), true);
  const round = {
    id: "new-round",
    group: 0 as const,
    startedAt: "2026-11-03",
    curriculumVersion: CURRICULUM_VERSION,
  };
  assert.deepEqual(scenariosForRound(round), FORMAL_SCENARIOS.slice(0, 4));
});

test("actual trading labs and the new observation group can graduate without optional lessons or quizzes", () => {
  const slots = makeProfitSlots("trading-graduation", HOLDOUT_VERSION);
  slots.forEach((slot, i) => {
    slot.status = "completed";
    slot.report = {
      worldId: `trading-world-${i}`,
      seed: slot.seed,
      regime: slot.regime,
      marketVariant: slot.marketVariant,
      assessmentVersion: "process-v2-trading",
      generationProfile: "mixed-v1",
      mode: "exam",
      elapsed: 7200,
      completed: true,
      initial: 10000,
      final: 10100,
      pnl: 100,
      returnPct: 1,
      baselineReturnPct: 0,
      excessPct: 1,
      fees: 2,
      trades: 2,
      violations: 0,
      maxDrawdownPct: 1,
      residual: 0,
      events: [],
      discipline: { risk: 100, execution: 100, review: 0 },
      process: {
        version: "process-v2-trading",
        score: 100,
        decisions: 1,
        weaknesses: [],
        checks: [
          {
            id: `buy-${i}:exit`,
            transactionId: `buy-${i}`,
            label: "自主卖出",
            passed: true,
            detail: "实际手动减仓已确认",
            weight: 30,
            eventIds: [],
          },
        ],
      },
      outcomes: [],
    };
  });
  const group: ProfitGroup = {
    id: "trading-graduation",
    createdAt: "2026-11-03",
    configVersion: HOLDOUT_VERSION,
    strategy: {
      screening: "按预设教学边界观察市场",
      avoid: "费用过高时等待",
      stakePct: 1,
      clusterPct: 3,
      totalPct: 10,
      exit: "按参考边界自主买入与卖出",
      stop: "触发停止线后不新增风险",
    },
    slots,
    abandoned: false,
  };
  const data: AcademyData = {
    schemaVersion: 1,
    curriculumVersion: CURRICULUM_VERSION,
    sequence: 1,
    lessonAttempts: [],
    knowledgeAttempts: [],
    scenarioAttempts: [],
    formalRounds: [],
    profitGroups: [group],
    labRuns: makePassingTradingRuns("graduation-trading-fixture"),
  };
  assert.equal(validateAcademy(data), true);
  const evaluation = academyEvaluation(data);
  assert.equal(evaluation.discipline.passed, false, "optional quiz was never taken");
  assert.equal(evaluation.labs.completed, 12);
  assert.equal(
    evaluation.profit.passed,
    true,
    "trade results, risk and manual exits meet the rubric",
  );
  assert.equal(evaluation.graduated, true);
  data.labRuns!.pop();
  assert.equal(
    academyEvaluation(data).graduated,
    false,
    "missing practical ability cannot be replaced by quiz or profit totals",
  );
});

test("existing process-v1 observation groups keep their original configuration and are resumable history", () => {
  const group: ProfitGroup = {
    id: "old-process-group",
    createdAt: "2026-11-02",
    configVersion: "holdout-v2-process",
    strategy: {
      screening: "检查权限和可退出报价",
      avoid: "成本高时不参与",
      stakePct: 1,
      clusterPct: 3,
      totalPct: 10,
      exit: "按可执行报价和原计划分批退出",
      stop: "达到本场停止线后停止新增风险",
    },
    slots: makeProfitSlots("old-process-group", "holdout-v2-process"),
    abandoned: false,
  };
  const data: AcademyData = {
    schemaVersion: 1,
    curriculumVersion: "2.0.0",
    sequence: 1,
    lessonAttempts: [],
    knowledgeAttempts: [],
    scenarioAttempts: [],
    formalRounds: [],
    profitGroups: [group],
  };
  assert.equal(validateAcademy(JSON.parse(JSON.stringify(data))), true);
  assert.equal(configForProfitSlot(group, group.slots[0]).assessmentVersion, "process-v1");
  assert.equal(configForProfitSlot(group, group.slots[0]).generationProfile, "mixed-v1");
  assert.equal(
    currentProfitGroup(data),
    undefined,
    "historical progress does not become a new trading assessment",
  );
});
