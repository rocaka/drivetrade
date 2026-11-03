import test from "node:test";
import assert from "node:assert/strict";
import { createWorld, stepWorld, settleWorld } from "../world/engine.ts";
import {
  compactArchive,
  validateCheckpoint,
  validateWorld,
  type Checkpoint,
} from "../world/repository.ts";
import type { World } from "../world/types.ts";
import { CURRICULUM_VERSION } from "./content.ts";
import {
  configForProfitSlot,
  makeProfitSlots,
  validateAcademy,
  worldReviewScore,
  worldReviewQuestions,
  HOLDOUT_VERSION,
  type AcademyData,
  type ProfitGroup,
} from "./store.ts";
import { assertBackupEvidence } from "./backup-evidence.ts";
import { makeLabRun, LAB_CHALLENGES, LEGACY_LAB_CHALLENGES } from "../training-lab/engine.ts";
import { passingTradingActions } from "../training-lab/__tests__/fixtures.ts";

const group: ProfitGroup = {
  id: "backup-evidence-fixture",
  createdAt: "2026-11-02",
  configVersion: "holdout-v1",
  strategy: {
    screening: "检查权限、池深度和可执行退出报价",
    avoid: "成本高或权限不明时不参与",
    stakePct: 1,
    clusterPct: 3,
    totalPct: 10,
    exit: "按可执行报价和原计划分批退出",
    stop: "达到本场停止线后停止新增风险",
  },
  slots: makeProfitSlots("backup-evidence-fixture"),
  abandoned: false,
};
// One real fixed-duration exam supplies the fixture. Reuse its compact archive
// across tests rather than inventing a profitable report without an economy.
const selectedIndex = group.slots.findIndex((slot) => slot.marketVariant === "standard");
const config = configForProfitSlot(group, group.slots[selectedIndex]);
let originalWorld = createWorld({
  seed: config.seed!,
  regime: config.regime!,
  marketVariant: config.marketVariant,
  mode: "exam",
  duration: 7200,
  spawnPerMinute: 6,
  protection: true,
});
originalWorld = stepWorld(stepWorld(originalWorld, 3600), 3600);
originalWorld = compactArchive(settleWorld(originalWorld));
assert.equal(validateWorld(originalWorld), true);
assert.equal(originalWorld.report?.completed, true);

function fixture() {
  const archived = structuredClone(originalWorld);
  const academy: AcademyData = {
    schemaVersion: 1,
    curriculumVersion: CURRICULUM_VERSION,
    sequence: 1,
    lessonAttempts: [],
    knowledgeAttempts: [],
    scenarioAttempts: [],
    formalRounds: [],
    profitGroups: [structuredClone(group)],
  };
  const slot = academy.profitGroups[0].slots[selectedIndex];
  slot.status = "completed";
  slot.startedAt = "2026-11-02";
  slot.report = structuredClone(archived.report!);
  const world: Checkpoint = {
    version: 1,
    world: null,
    reports: [structuredClone(archived.report!)],
    speed: 10,
    selectedId: null,
    revision: 1,
    archives: [archived],
  };
  assert.equal(validateCheckpoint(world), true);
  assert.equal(validateAcademy(academy), true);
  return { world, academy, slot };
}

test("a real completed world and its legal academy slot retain the same evidence", () => {
  const { world, academy } = fixture();
  assert.doesNotThrow(() => assertBackupEvidence(world, academy));
  world.world = world.archives![0];
  world.archives = [];
  assert.equal(validateCheckpoint(world), true);
  assert.doesNotThrow(() => assertBackupEvidence(world, academy));
});

test("empty market history cannot supply independently invented academy grades", () => {
  const { world, academy } = fixture();
  world.reports = [];
  world.archives = [];
  assert.equal(validateCheckpoint(world), true);
  assert.equal(validateAcademy(academy), true);
  assert.throws(() => assertBackupEvidence(world, academy), /学院成绩缺少一致/);
});

test("changing fees, discipline, returns or an event in the academy copy is rejected", () => {
  const changes = [
    (w: NonNullable<typeof originalWorld.report>) => {
      w.fees += 1;
    },
    (w: NonNullable<typeof originalWorld.report>) => {
      w.discipline.review = 100;
    },
    (w: NonNullable<typeof originalWorld.report>) => {
      w.discipline.risk = 75;
    },
    (w: NonNullable<typeof originalWorld.report>) => {
      w.final += 100;
      w.pnl += 100;
      w.returnPct = (w.pnl / w.initial) * 100;
      w.excessPct = w.returnPct - w.baselineReturnPct;
    },
    (w: NonNullable<typeof originalWorld.report>) => {
      w.events[0].message += " edited";
    },
  ];
  for (const change of changes) {
    const { world, academy, slot } = fixture();
    change(slot.report!);
    assert.equal(validateAcademy(academy), true);
    assert.throws(() => assertBackupEvidence(world, academy), /学院成绩缺少一致/);
  }
});

test("reports in abandoned and older groups are checked, not only the current group", () => {
  const { world, academy } = fixture();
  academy.profitGroups[0].abandoned = true;
  academy.profitGroups.push({
    ...structuredClone(group),
    id: "another-group",
    slots: makeProfitSlots("another-group"),
  });
  world.reports = [];
  world.archives = [];
  assert.equal(validateAcademy(academy), true);
  assert.throws(() => assertBackupEvidence(world, academy), /学院成绩缺少一致/);
});

test("seed, regime, variant and exam mode must also match the world configuration", () => {
  const changes: ((world: World) => void)[] = [
    (w) => {
      w.config.seed = "other-seed";
    },
    (w) => {
      w.config.regime = w.config.regime === "stress" ? "rotation" : "stress";
    },
    (w) => {
      w.config.marketVariant = "thin";
    },
    (w) => {
      w.config.mode = "free";
    },
  ];
  for (const change of changes) {
    const { world, academy } = fixture();
    change(world.archives![0]);
    assert.throws(() => assertBackupEvidence(world, academy), /种子、环境或配置/);
  }
});

test("legacy standard reports and lesson/practice-only history remain compatible", () => {
  const { world, academy, slot } = fixture();
  const prior = academy.profitGroups[0];
  prior.configVersion = "legacy-standard";
  for (const item of prior.slots) item.marketVariant = "standard";
  delete slot.report!.marketVariant;
  delete world.archives![0].config.marketVariant;
  delete world.archives![0].report!.marketVariant;
  delete world.reports[0].marketVariant;
  assert.equal(validateCheckpoint(world), true);
  assert.equal(validateAcademy(academy), true);
  assert.doesNotThrow(() => assertBackupEvidence(world, academy));

  academy.profitGroups = [];
  world.reports = [];
  world.archives = [];
  assert.doesNotThrow(() => assertBackupEvidence(world, academy));
});

test("structured review answers can earn a score without changing the original report", () => {
  const { world, academy, slot } = fixture();
  slot.reviewAttempts = [
    {
      at: "2026-11-02",
      answers: {
        fact: slot.report!.pnl > 0.005 ? 0 : slot.report!.pnl < -0.005 ? 1 : 2,
        cause: 0,
        next: 0,
      },
    },
  ];
  assert.equal(worldReviewScore(slot), 100);
  assert.equal(slot.report!.discipline.review, 0);
  assert.doesNotThrow(() => assertBackupEvidence(world, academy));
});

test("new mixed process exam, original evidence and six-answer review survive backup together", () => {
  const upgraded: ProfitGroup = {
    ...structuredClone(group),
    id: "process-backup-fixture",
    configVersion: HOLDOUT_VERSION,
    slots: makeProfitSlots("process-backup-fixture", HOLDOUT_VERSION),
  };
  const slot = upgraded.slots[0],
    config = configForProfitSlot(upgraded, slot);
  let market = createWorld({
    ...config,
    seed: config.seed!,
    regime: config.regime!,
    mode: "exam",
    duration: 7200,
    spawnPerMinute: 6,
    protection: true,
  });
  market = compactArchive(settleWorld(stepWorld(stepWorld(market, 3600), 3600)));
  assert.equal(validateWorld(market), true);
  assert.equal(market.report?.assessmentVersion, "process-v2-trading");
  assert.equal(market.report?.generationProfile, "mixed-v1");
  slot.report = structuredClone(market.report!);
  slot.status = "completed";
  const questions = worldReviewQuestions(slot.report);
  assert.equal(questions.length, 6);
  slot.reviewAttempts = [
    { at: "2026-11-02", answers: Object.fromEntries(questions.map((q) => [q.id, q.answer])) },
  ];
  const { academy } = fixture();
  academy.profitGroups.push(upgraded);
  const checkpoint: Checkpoint = {
    version: 1,
    world: null,
    reports: [originalWorld.report!, market.report!],
    speed: 10,
    selectedId: null,
    revision: 1,
    archives: [originalWorld, market],
  };
  const restored = JSON.parse(JSON.stringify({ checkpoint, academy }));
  assert.equal(validateCheckpoint(restored.checkpoint), true);
  assert.equal(validateAcademy(restored.academy), true);
  assert.doesNotThrow(() => assertBackupEvidence(restored.checkpoint, restored.academy));
  assert.equal(worldReviewScore(restored.academy.profitGroups[1].slots[0]), 100);
  assert.equal(restored.academy.profitGroups[1].slots[0].report.discipline.review, 0);
  restored.academy.profitGroups[1].slots[0].report.process.checks[0].detail += " edited";
  assert.throws(
    () => assertBackupEvidence(restored.checkpoint, restored.academy),
    /学院成绩缺少一致/,
  );
});

test("legacy practical actions retain their original replay and reject forged results", () => {
  const { academy } = fixture();
  const challenge = LEGACY_LAB_CHALLENGES[0];
  const run = makeLabRun(challenge.id, "lab-backup-fixture", [
    { type: "inspect", tokenId: challenge.targetId },
    { type: "finish" },
  ]);
  assert.equal(run.version, "lab-v1");
  academy.labRuns = [run];
  assert.equal(validateAcademy(JSON.parse(JSON.stringify(academy))), true);
  run.result.passed = true;
  run.result.score = 100;
  assert.equal(validateAcademy(academy), false);
});

test("new trading actions and legacy records restore together without reinterpreting either version", () => {
  const { academy } = fixture();
  const legacy = makeLabRun(LEGACY_LAB_CHALLENGES[0].id, "legacy-trading-backup", [
    { type: "inspect", tokenId: LEGACY_LAB_CHALLENGES[0].targetId },
    { type: "finish" },
  ]);
  const trading = makeLabRun(LAB_CHALLENGES[0].id, "new-trading-backup", passingTradingActions(1));
  assert.equal(trading.version, "lab-v2-trading");
  assert.equal(trading.result.passed, true);
  academy.labRuns = [legacy, trading];
  const restored = JSON.parse(JSON.stringify(academy));
  assert.equal(validateAcademy(restored), true);
  assert.deepEqual(restored.labRuns, [legacy, trading]);
  restored.labRuns[1].result.feesCents += 1;
  assert.equal(validateAcademy(restored), false, "cost evidence must match actual action replay");
});
