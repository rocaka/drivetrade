import test from "node:test";
import assert from "node:assert/strict";
import type { WorldReport } from "../world/types.ts";
import { LESSONS, KNOWLEDGE_QUESTIONS, CRITICAL_QUESTIONS, checkAnswers } from "./content.ts";
import { FORMAL_SCENARIOS, PRACTICE_SCENARIOS, gradeScenario } from "./scenarios.ts";
import {
  evaluateProfitStability,
  stratifiedLowerBound,
  evaluateDiscipline,
  REGIMES,
  type ScenarioAttempt,
} from "./grading.ts";
import {
  validateAcademy,
  makeProfitSlots,
  configForProfitSlot,
  academyEvaluation,
  currentProfitGroup,
  HOLDOUT_VERSION,
  reportMatchesSlot,
  type AcademyData,
  type ProfitGroup,
} from "./store.ts";

function report(i: number, pnl = 100, baseline = 0): WorldReport {
  return {
    worldId: `w-${i}`,
    seed: `s-${i}`,
    mode: "exam",
    regime: REGIMES[Math.floor(i / 6)],
    marketVariant: (["standard", "thin", "busy", "costly"] as const)[
      ((i % 6) + Math.floor(i / 6)) % 4
    ],
    elapsed: 7320,
    completed: true,
    initial: 10000,
    final: 10000 + pnl,
    pnl,
    returnPct: pnl / 100,
    baselineReturnPct: baseline,
    excessPct: pnl / 100 - baseline,
    fees: 2,
    trades: 3,
    violations: 0,
    maxDrawdownPct: 1,
    residual: 0,
    discipline: { risk: 100, execution: 100, review: 100 },
    events: [],
  };
}
const answers = (s: (typeof PRACTICE_SCENARIOS)[number]) =>
  Object.fromEntries(s.tasks.map((t) => [t.id, t.numberAnswer ?? t.answer!]));

test("curriculum contains actual 24 lessons, 30 formal concepts, 8 critical safety questions", () => {
  assert.equal(LESSONS.length, 24);
  assert.equal(KNOWLEDGE_QUESTIONS.length, 30);
  assert.equal(CRITICAL_QUESTIONS.length, 8);
  for (const lesson of LESSONS) {
    assert.ok(lesson.paragraphs.every((p) => p.length > 15));
    assert.ok(lesson.example.length > 20);
    assert.ok(lesson.question.options.length >= 3);
  }
});
test("one wrong critical answer fails safety gate even with high total score", () => {
  const responses = Object.fromEntries(KNOWLEDGE_QUESTIONS.map((q) => [q.id, q.answer]));
  responses[CRITICAL_QUESTIONS[0].id] = (CRITICAL_QUESTIONS[0].answer + 1) % 3;
  const grade = checkAnswers(KNOWLEDGE_QUESTIONS, responses);
  assert.ok(grade.score >= 85);
  assert.equal(grade.criticalPassed, false);
});
test("partial objectives never get default full marks and numeric risk calculations are checked", () => {
  const s = PRACTICE_SCENARIOS[0];
  const all = answers(s);
  assert.deepEqual(
    { ...gradeScenario(s, all), evidence: [] },
    { risk: 100, execution: 100, review: 100, complete: true, evidence: [] },
  );
  const skipped = { ...all };
  delete skipped.budget;
  const result = gradeScenario(s, skipped);
  assert.equal(result.complete, false);
  assert.equal(result.risk, 40);
  const bad = { ...all, budget: 600 };
  assert.equal(gradeScenario(s, bad).risk, 40);
});
test("24 valid worlds may pass but 23 cannot establish stability", () => {
  const all = Array.from({ length: 24 }, (_, i) => report(i));
  assert.equal(evaluateProfitStability(all).passed, true);
  assert.equal(evaluateProfitStability(all.slice(0, 23)).complete, false);
  assert.equal(evaluateProfitStability(all.slice(0, 23)).lowerBound, null);
  assert.equal(evaluateProfitStability(all).profitFactor, null);
});
test("duplicates, inconsistent equity and wrong seed manifest cannot pass", () => {
  const all = Array.from({ length: 24 }, (_, i) => report(i));
  all[23] = { ...all[0] };
  assert.equal(evaluateProfitStability(all).passed, false);
  const valid = Array.from({ length: 24 }, (_, i) => report(i));
  valid[0].final += 10;
  assert.equal(evaluateProfitStability(valid).passed, false);
  assert.equal(
    evaluateProfitStability(
      Array.from({ length: 24 }, (_, i) => report(i)),
      Array.from({ length: 24 }, (_, i) => `unexpected-${i}`),
    ).passed,
    false,
  );
});
test("a lucky large winner cannot cover persistently losing worlds", () => {
  const all = Array.from({ length: 24 }, (_, i) => report(i, i === 0 ? 5000 : -20));
  const e = evaluateProfitStability(all);
  assert.ok(e.net > 0);
  assert.ok(e.trimmedNet < 0);
  assert.equal(e.passed, false);
});
test("native asset gains and permanent cash are not new-coin strategy evidence", () => {
  const cash = Array.from({ length: 24 }, (_, i) => report(i, 0));
  assert.equal(evaluateProfitStability(cash).passed, false);
  const nativeGains = Array.from({ length: 24 }, (_, i) => report(i, 100, 2));
  assert.ok(evaluateProfitStability(nativeGains).net > 0);
  assert.ok(stratifiedLowerBound(nativeGains)! < 0);
  assert.equal(evaluateProfitStability(nativeGains).passed, false);
});
test("positive profits cannot override risk violations or missing actual review evidence", () => {
  const all = Array.from({ length: 24 }, (_, i) => report(i));
  all[5].violations = 1;
  assert.equal(evaluateProfitStability(all).passed, false);
  all[5].violations = 0;
  all[5].discipline.review = 0;
  assert.equal(evaluateProfitStability(all).passed, false);
  all[5].discipline.review = 100;
  all[5].elapsed = 100;
  assert.equal(evaluateProfitStability(all).passed, false);
});
test("stratified lower bound is repeatable and requires six worlds in all four environments", () => {
  const all = Array.from({ length: 24 }, (_, i) => report(i, 100 + i));
  assert.equal(stratifiedLowerBound(all), stratifiedLowerBound(all));
  all[0].regime = "rotation";
  assert.equal(stratifiedLowerBound(all), null);
});
test("discipline needs both complete four-scene groups, not one exceptional group", () => {
  const k = [
    {
      id: "k1",
      at: "2026-10-29",
      answers: Object.fromEntries(KNOWLEDGE_QUESTIONS.map((q) => [q.id, q.answer])),
    },
  ];
  const rounds = ([0, 1] as const).map((group) => ({
    id: `r-${group}`,
    group,
    startedAt: "2026-10-29",
    finishedAt: "2026-10-29",
  }));
  const practice: ScenarioAttempt[] = PRACTICE_SCENARIOS.map((s) => ({
    id: s.id,
    at: "2026-10-29",
    scenarioId: s.id,
    formal: false,
    roundId: null,
    answers: answers(s),
  }));
  const formal: ScenarioAttempt[] = FORMAL_SCENARIOS.map((s, i) => ({
    id: s.id,
    at: "2026-10-29",
    scenarioId: s.id,
    formal: true,
    roundId: `r-${i < 4 ? 0 : 1}`,
    answers: answers(s),
  }));
  assert.equal(
    evaluateDiscipline(
      LESSONS.map((l) => l.id),
      k,
      [...practice, ...formal],
      rounds,
    ).passed,
    true,
  );
  delete formal[7].answers.decision;
  assert.equal(
    evaluateDiscipline(
      LESSONS.map((l) => l.id),
      k,
      [...practice, ...formal],
      rounds,
    ).passed,
    false,
  );
});
test("import schema rejects standalone graduated flags and altered formal seed groups", () => {
  assert.equal(validateAcademy({ graduated: true }), false);
  const empty = {
    schemaVersion: 1,
    curriculumVersion: "2.0.0",
    sequence: 1,
    lessonAttempts: [],
    knowledgeAttempts: [],
    scenarioAttempts: [],
    formalRounds: [],
    profitGroups: [],
  };
  assert.equal(validateAcademy(empty), true);
  const group = {
    id: "profit-v2-1",
    createdAt: "2026-10-29",
    configVersion: "holdout-v1",
    strategy: {
      screening: "检查权限和可退出报价",
      avoid: "成本高时不参与",
      stakePct: 1,
      clusterPct: 3,
      totalPct: 10,
      exit: "按可执行报价和原计划分批退出",
      stop: "达到本场停止线后停止新增风险",
    },
    slots: makeProfitSlots("profit-v2-1"),
    abandoned: false,
  };
  const backup = { ...empty, profitGroups: [group] };
  assert.equal(validateAcademy(backup), true);
  backup.profitGroups[0].slots[0].seed = "cherry-picked";
  assert.equal(validateAcademy(backup), false);
});
test("holdout manifest contains four fixed variants, six each, and world creation uses the same slot", () => {
  const slots = makeProfitSlots("holdout-fixture");
  assert.deepEqual(slots, makeProfitSlots("holdout-fixture"));
  for (const variant of ["standard", "thin", "busy", "costly"])
    assert.equal(slots.filter((s) => s.marketVariant === variant).length, 6);
  for (const regime of REGIMES)
    assert.equal(
      new Set(slots.filter((s) => s.regime === regime).map((s) => s.marketVariant)).size,
      4,
    );
  const group: ProfitGroup = {
    id: "holdout-fixture",
    createdAt: "2026-10-29",
    configVersion: "holdout-v1",
    strategy: {
      screening: "检查权限和可退出报价",
      avoid: "成本高时不参与",
      stakePct: 1,
      clusterPct: 3,
      totalPct: 10,
      exit: "按可执行报价和原计划分批退出",
      stop: "达到本场停止线后停止新增风险",
    },
    slots,
    abandoned: false,
  };
  const config = configForProfitSlot(group, slots[7]);
  assert.equal(config.marketVariant, slots[7].marketVariant);
  assert.equal(config.seed, slots[7].seed);
  assert.equal(config.regime, slots[7].regime);
  assert.equal(config.mode, "exam");
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
  assert.equal(validateAcademy(data), true);
  data.profitGroups[0].slots[7].marketVariant =
    slots[7].marketVariant === "thin" ? "standard" : "thin";
  assert.equal(validateAcademy(data), false);
});
test("reports must match the frozen holdout variant and standard-only trials cannot substitute", () => {
  const all = Array.from({ length: 24 }, (_, i) => report(i));
  const manifest = all.map((r) => ({
    seed: r.seed,
    regime: r.regime,
    marketVariant: r.marketVariant!,
  }));
  assert.equal(
    evaluateProfitStability(
      all,
      all.map((r) => r.seed),
      manifest,
    ).passed,
    true,
  );
  all[0].marketVariant = all[0].marketVariant === "thin" ? "standard" : "thin";
  assert.equal(
    evaluateProfitStability(
      all,
      all.map((r) => r.seed),
      manifest,
    ).passed,
    false,
  );
  const standards = Array.from({ length: 24 }, (_, i) => ({
    ...report(i),
    marketVariant: "standard" as const,
  }));
  assert.equal(evaluateProfitStability(standards).passed, false);
});
test("legacy standard groups remain valid historical data but cannot count toward holdout graduation", () => {
  const group: ProfitGroup = {
    id: "legacy-1",
    createdAt: "2026-10-29",
    configVersion: "legacy-standard",
    strategy: {
      screening: "检查权限和可退出报价",
      avoid: "成本高时不参与",
      stakePct: 1,
      clusterPct: 3,
      totalPct: 10,
      exit: "按可执行报价和原计划分批退出",
      stop: "达到本场停止线后停止新增风险",
    },
    slots: makeProfitSlots("legacy-1").map((s) => ({ ...s, marketVariant: "standard" })),
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
  assert.equal(validateAcademy(data), true);
  assert.equal(currentProfitGroup(data), undefined);
  assert.equal(academyEvaluation(data).profit.valid, 0);
  assert.equal(academyEvaluation(data).graduated, false);
  const { configVersion: _version, ...oldGroup } = group;
  const oldBackup = {
    ...data,
    profitGroups: [
      { ...oldGroup, slots: group.slots.map(({ marketVariant: _variant, ...oldSlot }) => oldSlot) },
    ],
  };
  assert.equal(validateAcademy(oldBackup), true);
});

test("new holdout freezes mixed generation and process assessment without upgrading historical groups", () => {
  const slots = makeProfitSlots("process-fixture", HOLDOUT_VERSION);
  const group: ProfitGroup = {
    id: "process-fixture",
    createdAt: "2026-11-02",
    configVersion: HOLDOUT_VERSION,
    strategy: {
      screening: "检查权限和可退出报价",
      avoid: "成本高时不参与",
      stakePct: 1,
      clusterPct: 3,
      totalPct: 10,
      exit: "按可执行报价和原计划分批退出",
      stop: "达到本场停止线后停止新增风险",
    },
    slots,
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
  assert.equal(validateAcademy(data), true);
  assert.equal(currentProfitGroup(data)?.id, group.id);
  for (const slot of slots) {
    const config = configForProfitSlot(group, slot);
    assert.equal(config.generationProfile, "mixed-v1");
    assert.equal(config.assessmentVersion, "process-v2-trading");
  }
  delete slots[0].assessmentVersion;
  assert.equal(validateAcademy(data), false);
  const old = makeProfitSlots("old-fixture");
  assert.equal(old[0].generationProfile, undefined);
  assert.equal(old[0].assessmentVersion, undefined);
});

test("matching seed alone cannot substitute legacy results for the new process exam", () => {
  const slot = makeProfitSlots("process-match", HOLDOUT_VERSION)[0];
  const group = { configVersion: HOLDOUT_VERSION } as ProfitGroup;
  const old = {
    ...report(0),
    seed: slot.seed,
    regime: slot.regime,
    marketVariant: slot.marketVariant,
  };
  assert.equal(reportMatchesSlot(group, slot, old), false);
  const newer: WorldReport = {
    ...old,
    assessmentVersion: "process-v2-trading",
    generationProfile: "mixed-v1",
    process: {
      version: "process-v2-trading",
      score: 100,
      decisions: 1,
      checks: [],
      weaknesses: [],
    },
  };
  assert.equal(reportMatchesSlot(group, slot, newer), true);
  delete newer.generationProfile;
  assert.equal(reportMatchesSlot(group, slot, newer), false);
});

test("new process group can wait without forced entries but still needs broad actual execution evidence", () => {
  const reports = Array.from({ length: 24 }, (_, i): WorldReport => {
    const decisions = [0, 1, 6, 7].includes(i) ? 2 : 0;
    return {
      ...report(i),
      elapsed: 7200,
      assessmentVersion: "process-v1",
      generationProfile: "mixed-v1",
      discipline: { risk: 100, execution: decisions ? 100 : 0, review: 100 },
      process: {
        version: "process-v1",
        score: decisions ? 100 : 0,
        decisions,
        checks: Array.from({ length: decisions }, (_, j) => ({
          id: `tx-${i}-${j}:exit`,
          label: "退出计划执行",
          passed: true,
          detail: "冻结退出条件出现后及时提交",
          weight: 20,
          transactionId: `tx-${i}-${j}`,
          eventIds: [],
        })),
        weaknesses: [],
      },
    };
  });
  const evaluation = evaluateProfitStability(reports);
  assert.equal(evaluation.checks.find((check) => check.id === "risk")?.passed, true);
  assert.equal(evaluation.checks.find((check) => check.id === "process-coverage")?.passed, true);
  assert.equal(evaluation.checks.find((check) => check.id === "exit-coverage")?.passed, true);
  assert.equal(evaluation.passed, true);
  const noActions = reports.map((r) => ({
    ...r,
    discipline: { ...r.discipline, execution: 0 },
    process: { ...r.process!, decisions: 0, score: 0, checks: [] },
  }));
  assert.equal(evaluateProfitStability(noActions).passed, false);
  assert.equal(
    evaluateProfitStability(noActions).checks.find((check) => check.id === "process-coverage")
      ?.passed,
    false,
  );
  const settlementOnly = structuredClone(reports);
  for (const r of settlementOnly)
    for (const check of r.process!.checks) {
      check.passed = null;
      check.detail = "观察窗口未触发条件；期末系统清仓不充当主动执行证据";
    }
  const lateEvaluation = evaluateProfitStability(settlementOnly);
  assert.equal(lateEvaluation.checks.find((check) => check.id === "risk")?.passed, true);
  assert.equal(
    lateEvaluation.checks.find((check) => check.id === "process-coverage")?.passed,
    true,
  );
  assert.equal(lateEvaluation.checks.find((check) => check.id === "exit-coverage")?.passed, false);
  assert.equal(lateEvaluation.passed, false);
  const singleRegime = structuredClone(reports);
  for (const r of singleRegime.filter((r) => r.regime !== "inflow"))
    for (const check of r.process!.checks) check.passed = null;
  assert.equal(
    evaluateProfitStability(singleRegime).checks.find((check) => check.id === "exit-coverage")
      ?.passed,
    false,
  );
  // A failed plan in a world with actual entries cannot hide behind N/A.
  reports[0].discipline.execution = 50;
  reports[0].process!.score = 50;
  assert.equal(
    evaluateProfitStability(reports).checks.find((check) => check.id === "risk")?.passed,
    false,
  );
});
