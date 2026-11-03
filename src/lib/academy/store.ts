import { create } from "zustand";
import { z } from "zod";
import type { Regime, WorldConfig, WorldReport } from "../world/types.ts";
import { reportSchema as worldReportSchema } from "../world/repository.ts";
import type { LabRun } from "../training-lab/types.ts";
import { evaluateLabs, validateLabRun } from "../training-lab/engine.ts";
import { buildWorldReviewQuestions } from "./review.ts";
import {
  CURRICULUM_VERSION,
  LEGACY_CURRICULUM_VERSION,
  LESSONS,
  KNOWLEDGE_QUESTIONS,
  checkAnswers,
  getLessonById,
  getKnowledgeQuestionsForAttempt,
} from "./content.ts";
import {
  gradeScenario,
  getScenarioById,
  scenariosForRound,
  isCurrentFormalRound,
  type ScenarioAnswers,
} from "./scenarios.ts";
import {
  evaluateDiscipline,
  evaluateProfitStability,
  type KnowledgeAttempt,
  type ScenarioAttempt,
  type FormalRound,
  REGIMES,
} from "./grading.ts";

type LessonAttempt = { id: string; lessonId: string; at: string; answer: number };
export interface FrozenStrategy {
  screening: string;
  avoid: string;
  stakePct: number;
  clusterPct: number;
  totalPct: number;
  exit: string;
  stop: string;
}
export type AcademyMarketVariant = "standard" | "thin" | "busy" | "costly";
export const HOLDOUT_VERSION = "holdout-v3-trading";
export const HOLDOUT_VARIANTS: AcademyMarketVariant[] = ["standard", "thin", "busy", "costly"];
export const VARIANT_LABELS: Record<AcademyMarketVariant, string> = {
  standard: "标准生态",
  thin: "薄池生态",
  busy: "密集拥堵",
  costly: "较高成本",
};
export interface ProfitSlot {
  seed: string;
  regime: Regime;
  marketVariant: AcademyMarketVariant;
  generationProfile?: "mixed-v1";
  assessmentVersion?: "process-v1" | "process-v2-trading";
  status: "ready" | "started" | "completed" | "abandoned";
  report?: WorldReport;
  startedAt?: string;
  reviewAttempts?: { at: string; answers: Record<string, number> }[];
}
export interface ProfitGroup {
  id: string;
  createdAt: string;
  configVersion: "holdout-v3-trading" | "holdout-v2-process" | "holdout-v1" | "legacy-standard";
  strategy: FrozenStrategy;
  slots: ProfitSlot[];
  abandoned: boolean;
}
export interface AcademyData {
  schemaVersion: 1;
  curriculumVersion: string;
  sequence: number;
  lessonAttempts: LessonAttempt[];
  knowledgeAttempts: KnowledgeAttempt[];
  scenarioAttempts: ScenarioAttempt[];
  formalRounds: FormalRound[];
  profitGroups: ProfitGroup[];
  labRuns?: LabRun[];
}
const blank = (): AcademyData => ({
  schemaVersion: 1,
  curriculumVersion: CURRICULUM_VERSION,
  sequence: 0,
  lessonAttempts: [],
  knowledgeAttempts: [],
  scenarioAttempts: [],
  formalRounds: [],
  profitGroups: [],
  labRuns: [],
});
const finite = z.number().finite();
const answersSchema = z
  .record(z.string().max(80), finite)
  .refine((v) => Object.keys(v).length <= 40, "答案过多");
const dateSchema = z.string().max(80);
const variantSchema = z.enum(["standard", "thin", "busy", "costly"]);
const eventSchema = z
  .object({
    id: z.string().max(160),
    seq: z.number().int().nonnegative(),
    at: finite,
    type: z.string().max(100),
    message: z.string().max(4000),
    tokenId: z.string().max(160).optional(),
    chain: z.enum(["solana", "bnb", "base"]).optional(),
    commandId: z.string().max(160).optional(),
    amountUsd: finite.optional(),
    violation: z.boolean().optional(),
  })
  .strict();
const legacyReportSchema = z
  .object({
    worldId: z.string().max(200),
    seed: z.string().max(200),
    regime: z.enum(["inflow", "rotation", "outflow", "stress"]),
    marketVariant: variantSchema.optional(),
    mode: z.enum(["free", "practice", "exam"]),
    elapsed: finite.nonnegative(),
    completed: z.boolean(),
    initial: finite.positive(),
    final: finite.nonnegative(),
    pnl: finite,
    returnPct: finite,
    baselineReturnPct: finite,
    excessPct: finite,
    fees: finite.nonnegative(),
    trades: z.number().int().nonnegative(),
    violations: z.number().int().nonnegative(),
    maxDrawdownPct: finite.nonnegative(),
    residual: finite.nonnegative(),
    discipline: z
      .object({
        risk: finite.min(0).max(100),
        execution: finite.min(0).max(100),
        review: finite.min(0).max(100),
      })
      .strict(),
    events: z.array(eventSchema).max(20000),
  })
  .strict();
// Historical reports retain their original shape/timing. New reports use the
// world's complete schema so process evidence is never silently discarded.
const reportSchema = z.union([legacyReportSchema, worldReportSchema]);
const strategySchema = z
  .object({
    screening: z.string().min(8).max(1200),
    avoid: z.string().min(5).max(1200),
    stakePct: z.literal(1),
    clusterPct: z.literal(3),
    totalPct: z.literal(10),
    exit: z.string().min(8).max(1200),
    stop: z.string().min(5).max(1200),
  })
  .strict();
const slotSchema = z
  .object({
    seed: z.string().max(200),
    regime: z.enum(["inflow", "rotation", "outflow", "stress"]),
    marketVariant: variantSchema.default("standard"),
    generationProfile: z.literal("mixed-v1").optional(),
    assessmentVersion: z.enum(["process-v1", "process-v2-trading"]).optional(),
    status: z.enum(["ready", "started", "completed", "abandoned"]),
    report: reportSchema.optional(),
    startedAt: dateSchema.optional(),
    reviewAttempts: z
      .array(z.object({ at: dateSchema, answers: answersSchema }).strict())
      .max(100)
      .optional(),
  })
  .strict();
const groupSchema = z
  .object({
    id: z.string().max(100),
    createdAt: dateSchema,
    configVersion: z
      .enum(["holdout-v3-trading", "holdout-v2-process", "holdout-v1", "legacy-standard"])
      .default("legacy-standard"),
    strategy: strategySchema,
    slots: z.array(slotSchema).length(24),
    abandoned: z.boolean(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    curriculumVersion: z.enum([CURRICULUM_VERSION, LEGACY_CURRICULUM_VERSION]),
    sequence: z.number().int().min(0).max(1000000),
    lessonAttempts: z
      .array(
        z
          .object({
            id: z.string().max(100),
            lessonId: z.string().max(50),
            at: dateSchema,
            answer: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20000),
    knowledgeAttempts: z
      .array(
        z
          .object({
            id: z.string().max(100),
            at: dateSchema,
            answers: answersSchema,
            curriculumVersion: z.enum([CURRICULUM_VERSION, LEGACY_CURRICULUM_VERSION]).optional(),
          })
          .strict(),
      )
      .max(1000),
    scenarioAttempts: z
      .array(
        z
          .object({
            id: z.string().max(100),
            at: dateSchema,
            scenarioId: z.string().max(50),
            formal: z.boolean(),
            roundId: z.string().max(100).nullable(),
            answers: answersSchema,
          })
          .strict(),
      )
      .max(20000),
    formalRounds: z
      .array(
        z
          .object({
            id: z.string().max(100),
            group: z.union([z.literal(0), z.literal(1)]),
            curriculumVersion: z.enum([CURRICULUM_VERSION, LEGACY_CURRICULUM_VERSION]).optional(),
            startedAt: dateSchema,
            finishedAt: dateSchema.optional(),
            abandoned: z.boolean().optional(),
          })
          .strict(),
      )
      .max(2000),
    profitGroups: z.array(groupSchema).max(200),
    labRuns: z.array(z.custom<LabRun>(validateLabRun, "实操重放证据无效")).max(2000).default([]),
  })
  .strict()
  .superRefine((data, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const a of data.lessonAttempts) {
      const l = getLessonById(a.lessonId);
      if (!l || a.answer >= l.question.options.length) issue("课程证据无效");
    }
    for (const a of data.knowledgeAttempts)
      for (const [key, value] of Object.entries(a.answers)) {
        const q = getKnowledgeQuestionsForAttempt(a).find((q) => q.id === key);
        if (!q || !Number.isInteger(value) || value < 0 || value >= q.options.length)
          issue("知识答案无效");
      }
    for (const a of data.scenarioAttempts) {
      const s = getScenarioById(a.scenarioId);
      if (!s || s.formal !== a.formal) {
        issue("场景版本无法识别");
        continue;
      }
      for (const [key, value] of Object.entries(a.answers)) {
        const t = s.tasks.find((t) => t.id === key);
        if (
          !t ||
          value < 0 ||
          (t.options && (!Number.isInteger(value) || value >= t.options.length))
        )
          issue("场景证据无效");
      }
      if (a.formal) {
        const round = data.formalRounds.find((r) => r.id === a.roundId);
        if (!round) issue("缺少正式组");
        else if (
          !scenariosForRound(round, data.scenarioAttempts).some((expected) => expected.id === s.id)
        )
          issue("正式决定与题组版本不一致");
      }
    }
    for (const g of data.profitGroups) {
      const expected = makeProfitSlots(g.id, g.configVersion);
      if (
        !g.slots.every(
          (s, i) =>
            s.seed === expected[i].seed &&
            s.regime === expected[i].regime &&
            (g.configVersion !== "legacy-standard"
              ? s.marketVariant === expected[i].marketVariant
              : s.marketVariant === "standard") &&
            s.generationProfile === expected[i].generationProfile &&
            s.assessmentVersion === expected[i].assessmentVersion,
        )
      )
        issue("观察组种子或样本外配置清单已改变");
      for (const s of g.slots)
        if (s.report && !reportMatchesSlot(g, s, s.report)) issue("报告与冻结世界配置不一致");
      for (const s of g.slots) {
        if (!s.report && s.reviewAttempts?.length) issue("复盘缺少结算报告");
        if (!s.report) continue;
        const questions = worldReviewQuestions(s.report);
        for (const attempt of s.reviewAttempts ?? [])
          if (
            Object.keys(attempt.answers).length !== questions.length ||
            questions.some(
              (q) =>
                !Number.isInteger(attempt.answers[q.id]) ||
                attempt.answers[q.id] < 0 ||
                attempt.answers[q.id] >= q.options.length,
            )
          )
            issue("复盘答案与报告版本不一致");
      }
    }
  });

let dbPromise: Promise<IDBDatabase> | null = null;
function database() {
  if (!dbPromise)
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("当前环境不能保存训练，请在支持 IndexedDB 的浏览器打开"));
        return;
      }
      const request = indexedDB.open("td-academy-learning", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("state"))
          request.result.createObjectStore("state");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("学习存储不可用"));
    });
  return dbPromise;
}
async function readData(): Promise<AcademyData> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly");
    const req = tx.objectStore("state").get("current");
    req.onsuccess = () => {
      if (req.result === undefined) resolve(blank());
      else {
        const result = schema.safeParse(req.result);
        if (result.success) resolve(result.data);
        else reject(new Error("学习数据版本或证据损坏，请先导出备份"));
      }
    };
    req.onerror = () => reject(req.error);
  });
}
async function writeData(data: AcademyData) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(data, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("课程保存失败"));
    tx.onabort = () => reject(tx.error ?? new Error("课程保存被中止"));
  });
}
async function updateStoredData(change: (data: AcademyData) => void): Promise<AcademyData> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    const store = tx.objectStore("state");
    const req = store.get("current");
    let result: AcademyData | undefined;
    let failure: Error | undefined;
    req.onsuccess = () => {
      try {
        const before = req.result === undefined ? blank() : schema.parse(req.result);
        const draft = structuredClone(before);
        change(draft);
        result = schema.parse(draft);
        store.put(result, "current");
      } catch (error) {
        failure = new Error(message(error));
        tx.abort();
      }
    };
    tx.oncomplete = () => (result ? resolve(result) : reject(new Error("课程事务没有产生证据")));
    tx.onerror = () => reject(failure ?? tx.error ?? new Error("课程事务保存失败"));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("课程事务已中止"));
  });
}
let queue: Promise<unknown> = Promise.resolve();
let maintenance = false;
let storageBlocked = false;
interface AcademyStore {
  data: AcademyData;
  hydrated: boolean;
  busy: boolean;
  error: string;
  hydrate: () => Promise<void>;
  answerLesson: (id: string, answer: number) => Promise<boolean>;
  submitKnowledge: (answers: Record<string, number>) => Promise<boolean>;
  submitScenario: (id: string, answers: ScenarioAnswers, roundId?: string) => Promise<boolean>;
  recordLabRun: (run: LabRun) => Promise<boolean>;
  commitScenarioAnswer: (
    roundId: string,
    scenarioId: string,
    taskId: string,
    answer: number,
  ) => Promise<boolean>;
  startFormal: (group: 0 | 1) => Promise<string | null>;
  abandonFormal: (roundId: string) => Promise<void>;
  startProfitGroup: (strategy: FrozenStrategy) => Promise<boolean>;
  startProfitSlot: (seed: string) => Promise<boolean>;
  cancelUnstartedProfitSlot: (seed: string) => Promise<boolean>;
  reviewWorld: (seed: string, answers: Record<string, number>) => Promise<boolean>;
  abandonProfitGroup: () => Promise<boolean>;
  clearError: () => void;
}
export const useAcademy = create<AcademyStore>((set, get) => ({
  data: blank(),
  hydrated: false,
  busy: false,
  error: "",
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const data = await readData();
      storageBlocked = false;
      set({ data, hydrated: true, error: "" });
    } catch (error) {
      storageBlocked = true;
      set({ hydrated: true, error: message(error) });
    }
  },
  answerLesson: async (id, answer) =>
    mutate((data) => {
      const lesson = getLessonById(id);
      if (!lesson || answer < 0 || answer >= lesson.question.options.length)
        throw new Error("答案无效");
      data.lessonAttempts.push({
        id: nextId(data, "lesson"),
        lessonId: id,
        answer,
        at: new Date().toISOString(),
      });
    }),
  submitKnowledge: async (answers) =>
    mutate((data) => {
      if (!checkAnswers(KNOWLEDGE_QUESTIONS, answers).complete)
        throw new Error("请完成全部30题再提交");
      data.knowledgeAttempts.push({
        curriculumVersion: CURRICULUM_VERSION,
        id: nextId(data, "knowledge"),
        at: new Date().toISOString(),
        answers: { ...answers },
      });
    }),
  recordLabRun: async (run) =>
    mutate((data) => {
      if (!validateLabRun(run)) throw new Error("实操记录与重放结果不一致，未计入训练");
      data.labRuns ??= [];
      // The same frozen run is idempotent; failed attempts are retained too.
      const raw = JSON.stringify(run);
      if (!data.labRuns.some((saved) => JSON.stringify(saved) === raw))
        data.labRuns.push(structuredClone(run));
    }),
  submitScenario: async (id, answers, roundId) =>
    mutate((data) => {
      const s = getScenarioById(id);
      if (!s || !gradeScenario(s, answers).complete) throw new Error("请完成全部能力目标");
      if (s.formal) {
        const round = data.formalRounds.find(
          (r) => r.id === roundId && !r.abandoned && !r.finishedAt,
        );
        if (!round) throw new Error("正式考核组已结束");
        if (
          !scenariosForRound(round, data.scenarioAttempts).some((expected) => expected.id === s.id)
        )
          throw new Error("决定不属于该组的原始题目版本");
        if (data.scenarioAttempts.some((a) => a.roundId === roundId && a.scenarioId === id))
          throw new Error("正式动作已冻结，不能反向修改");
      }
      data.scenarioAttempts.push({
        id: nextId(data, "scenario"),
        at: new Date().toISOString(),
        scenarioId: id,
        formal: s.formal,
        roundId: roundId ?? null,
        answers: { ...answers },
      });
      if (s.formal) {
        const r = data.formalRounds.find((r) => r.id === roundId)!;
        const required = scenariosForRound(r, data.scenarioAttempts);
        if (
          required.every((s) =>
            data.scenarioAttempts.some((a) => a.roundId === roundId && a.scenarioId === s.id),
          )
        )
          r.finishedAt = new Date().toISOString();
      }
    }),
  commitScenarioAnswer: async (roundId, scenarioId, taskId, answer) =>
    mutate((data) => {
      const round = data.formalRounds.find(
        (r) => r.id === roundId && !r.abandoned && !r.finishedAt,
      );
      const scenario = getScenarioById(scenarioId);
      const task = scenario?.tasks.find((t) => t.id === taskId);
      if (!round || !scenario || !task || !Number.isFinite(answer))
        throw new Error("考核目标或组已无效");
      if (!scenariosForRound(round, data.scenarioAttempts).some((s) => s.id === scenarioId))
        throw new Error("目标不属于该组");
      let attempt = data.scenarioAttempts.find(
        (a) => a.roundId === roundId && a.scenarioId === scenarioId,
      );
      if (!attempt) {
        attempt = {
          id: nextId(data, "formal-evidence"),
          at: new Date().toISOString(),
          scenarioId,
          formal: true,
          roundId,
          answers: {},
        };
        data.scenarioAttempts.push(attempt);
      }
      if (attempt.answers[taskId] !== undefined) throw new Error("该决定已经冻结，不能反向修改");
      attempt.answers[taskId] = answer;
      const required = scenariosForRound(round, data.scenarioAttempts);
      if (
        required.every((s) => {
          const a = data.scenarioAttempts.find(
            (a) => a.roundId === roundId && a.scenarioId === s.id,
          );
          return !!a && gradeScenario(s, a.answers).complete;
        })
      )
        round.finishedAt = new Date().toISOString();
    }),
  startFormal: async (group) => {
    let id: string | null = null;
    const committed = await mutate((data) => {
      for (const r of data.formalRounds.filter(
        (r) =>
          r.group === group &&
          !r.finishedAt &&
          !r.abandoned &&
          isCurrentFormalRound(r, data.scenarioAttempts),
      ))
        r.abandoned = true;
      id = nextId(data, "discipline");
      data.formalRounds.push({
        id,
        group,
        curriculumVersion: CURRICULUM_VERSION,
        startedAt: new Date().toISOString(),
      });
    });
    return committed ? id : null;
  },
  abandonFormal: async (id) => {
    await mutate((data) => {
      const r = data.formalRounds.find((r) => r.id === id);
      if (r && !r.finishedAt) r.abandoned = true;
    });
  },
  startProfitGroup: async (strategy) =>
    mutate((data) => {
      const parsed = strategySchema.safeParse(strategy);
      if (!parsed.success)
        throw new Error("请填写筛选、放弃、退出及停止条件；风险不得超出本场上限");
      if (
        data.profitGroups.some(
          (g) =>
            g.configVersion === HOLDOUT_VERSION &&
            !g.abandoned &&
            g.slots.some((s) => s.status !== "completed"),
        )
      )
        throw new Error("当前观察组尚未结束；请继续或明确放弃后再建新组");
      const id = nextId(data, "profit");
      data.profitGroups.push({
        id,
        createdAt: new Date().toISOString(),
        configVersion: HOLDOUT_VERSION,
        strategy: parsed.data,
        slots: makeProfitSlots(id, HOLDOUT_VERSION),
        abandoned: false,
      });
    }),
  startProfitSlot: async (seed) =>
    mutate((data) => {
      const group = data.profitGroups.find(
        (g) => !g.abandoned && g.slots.some((s) => s.seed === seed),
      );
      const slot = group?.slots.find((s) => s.seed === seed);
      if (!group || !slot || slot.status !== "ready")
        throw new Error("世界不属于当前可开始的冻结观察组");
      if (group.slots.some((s) => s.status === "started"))
        throw new Error("请先完成或恢复已经开始的正式世界");
      slot.status = "started";
      slot.startedAt = new Date().toISOString();
    }),
  cancelUnstartedProfitSlot: async (seed) => {
    const { useWorld } = await import("../world/store");
    if (useWorld.getState().world?.config.seed === seed) return false;
    const slot = get()
      .data.profitGroups.flatMap((g) => g.slots)
      .find((s) => s.seed === seed);
    if (!slot || slot.status !== "started" || slot.report) return false;
    return mutate((data) => {
      const target = data.profitGroups.flatMap((g) => g.slots).find((s) => s.seed === seed);
      // Recheck at the actual queued write: a real world or report is never rolled back.
      if (
        useWorld.getState().world?.config.seed === seed ||
        !target ||
        target.status !== "started" ||
        target.report
      )
        return;
      target.status = "ready";
      delete target.startedAt;
    });
  },
  reviewWorld: async (seed, answers) =>
    mutate((data) => {
      const slot = data.profitGroups.flatMap((g) => g.slots).find((s) => s.seed === seed);
      if (!slot?.report) throw new Error("请先完成世界结算");
      const questions = worldReviewQuestions(slot.report);
      if (
        Object.keys(answers).length !== questions.length ||
        questions.some(
          (q) =>
            !Number.isInteger(answers[q.id]) ||
            answers[q.id] < 0 ||
            answers[q.id] >= q.options.length,
        )
      )
        throw new Error("请完成本报告的全部复盘证据");
      slot.reviewAttempts ??= [];
      slot.reviewAttempts.push({ at: new Date().toISOString(), answers: { ...answers } });
    }),
  abandonProfitGroup: async () => {
    return mutate((data) => {
      const g = currentProfitGroup(data);
      if (g) {
        g.abandoned = true;
        for (const s of g.slots) if (s.status === "started") s.status = "abandoned";
      }
    });
  },
  clearError: () => set({ error: "" }),
}));
function message(error: unknown) {
  return error instanceof Error ? error.message : "学习数据保存失败，请重试或导出备份";
}
function nextId(data: AcademyData, prefix: string) {
  data.sequence += 1;
  return `${prefix}-v2-${data.sequence}`;
}
async function mutate(change: (data: AcademyData) => void): Promise<boolean> {
  if (maintenance) {
    useAcademy.setState({ error: "完整备份正在操作，训练写入暂时冻结" });
    return false;
  }
  const task = queue.then(async () => {
    // Ownership is checked when the queued task actually starts, not merely when
    // a button was clicked. A tab may have been taken over while it was waiting.
    const { assertWorldWriter } = await import("../world/store");
    await assertWorldWriter();
    if (maintenance) throw new Error("完整备份正在操作，训练写入暂时冻结");
    const store = useAcademy.getState();
    if (!store.hydrated) await store.hydrate();
    if (storageBlocked)
      throw new Error("原学习存档暂时不可读取，写入已冻结；请先恢复有效备份，避免覆盖");
    useAcademy.setState({ busy: true, error: "" });
    // Read and write inside the same IDB transaction: another tab cannot overwrite
    // a newer attempt with this tab's older in-memory snapshot.
    await assertWorldWriter();
    const data = await updateStoredData(change);
    useAcademy.setState({ data, busy: false, error: "" });
    return true;
  });
  queue = task.catch(() => undefined);
  try {
    return await task;
  } catch (error) {
    useAcademy.setState({ busy: false, error: message(error) });
    return false;
  }
}
export function makeProfitSlots(
  id: string,
  version: ProfitGroup["configVersion"] = "holdout-v1",
): ProfitSlot[] {
  const slots: ProfitSlot[] = REGIMES.flatMap((regime, regimeIndex) =>
    Array.from({ length: 6 }, (_, i) => ({
      seed: `${id}-${regime}-${i + 1}`,
      regime,
      marketVariant:
        version === "legacy-standard"
          ? "standard"
          : HOLDOUT_VARIANTS[(i + regimeIndex) % HOLDOUT_VARIANTS.length],
      ...(["holdout-v2-process", HOLDOUT_VERSION].includes(version)
        ? {
            generationProfile: "mixed-v1" as const,
            assessmentVersion:
              version === HOLDOUT_VERSION
                ? ("process-v2-trading" as const)
                : ("process-v1" as const),
          }
        : {}),
      status: "ready" as const,
    })),
  );
  let state =
    Array.from(id).reduce((s, c) => Math.imul(s ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  for (let i = slots.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}
export function currentProfitGroup(data: AcademyData) {
  return data.profitGroups
    .filter((g) => g.configVersion === HOLDOUT_VERSION && !g.abandoned)
    .at(-1);
}
/** Existing frozen groups remain resumable without counting as the new exam. */
export function resumableProfitGroup(data: AcademyData) {
  return data.profitGroups
    .filter(
      (g) => !g.abandoned && g.slots.some((s) => s.status === "started" || s.status === "ready"),
    )
    .at(-1);
}
export function reportMatchesSlot(group: ProfitGroup, slot: ProfitSlot, report: WorldReport) {
  return (
    report.seed === slot.seed &&
    report.regime === slot.regime &&
    report.mode === "exam" &&
    (group.configVersion === "legacy-standard"
      ? (report.marketVariant ?? "standard") === "standard"
      : report.marketVariant === slot.marketVariant) &&
    report.generationProfile === slot.generationProfile &&
    report.assessmentVersion === slot.assessmentVersion &&
    (!["holdout-v2-process", HOLDOUT_VERSION].includes(group.configVersion) ||
      report.process?.version === slot.assessmentVersion)
  );
}
export function completedLessonIds(data: AcademyData) {
  return LESSONS.filter((l) =>
    data.lessonAttempts.some((a) => a.lessonId === l.id && a.answer === l.question.answer),
  ).map((l) => l.id);
}
export function worldReviewQuestions(report: WorldReport) {
  return buildWorldReviewQuestions(report);
}
export function worldReviewScore(slot: ProfitSlot) {
  if (!slot.report || !slot.reviewAttempts?.length) return 0;
  const a = slot.reviewAttempts.at(-1)!.answers;
  return worldReviewQuestions(slot.report).reduce(
    (sum, q) => sum + (a[q.id] === q.answer ? q.weight : 0),
    0,
  );
}
export function academyEvaluation(data: AcademyData) {
  const discipline = evaluateDiscipline(
    completedLessonIds(data),
    data.knowledgeAttempts,
    data.scenarioAttempts,
    data.formalRounds,
  );
  const group = currentProfitGroup(data);
  const profit = evaluateProfitStability(
    group?.slots.flatMap((s) =>
      s.report
        ? [{ ...s.report, discipline: { ...s.report.discipline, review: worldReviewScore(s) } }]
        : [],
    ) ?? [],
    group?.slots.map((s) => s.seed),
    group?.slots,
  );
  const labs = evaluateLabs(data.labRuns ?? []);
  return { discipline, profit, labs, graduated: profit.passed && labs.passed };
}
export async function recordWorldReport(report: WorldReport): Promise<void> {
  if (report.mode !== "exam") return;
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success) return;
  const group = useAcademy
    .getState()
    .data.profitGroups.find((g) => !g.abandoned && g.slots.some((s) => s.seed === report.seed));
  const slot = group?.slots.find((s) => s.seed === report.seed);
  if (!slot || slot.report || slot.status !== "started") return;
  if (!reportMatchesSlot(group!, slot, report)) {
    useAcademy.setState({ error: "结算报告与冻结的样本外配置不一致，未计入正式观察" });
    return;
  }
  await mutate((data) => {
    const g = data.profitGroups.find(
      (g) => !g.abandoned && g.slots.some((s) => s.seed === report.seed),
    );
    const target = g?.slots.find((s) => s.seed === report.seed);
    if (!target || target.report) return;
    target.report = parsed.data;
    target.status = report.completed && report.elapsed >= 7200 ? "completed" : "abandoned";
  });
}
export function configForProfitSlot(group: ProfitGroup, slot: ProfitSlot): Partial<WorldConfig> {
  return {
    seed: slot.seed,
    regime: slot.regime,
    marketVariant: slot.marketVariant,
    ...(["holdout-v2-process", HOLDOUT_VERSION].includes(group.configVersion)
      ? {
          generationProfile: "mixed-v1" as const,
          assessmentVersion:
            group.configVersion === HOLDOUT_VERSION
              ? ("process-v2-trading" as const)
              : ("process-v1" as const),
        }
      : {}),
    mode: "exam",
    duration: 7200,
    spawnPerMinute: 6,
    protection: true,
    label: `正式观察 ${group.slots.indexOf(slot) + 1}/24`,
  };
}
export function nextWorldConfig(data: AcademyData): Partial<WorldConfig> | null {
  const group = currentProfitGroup(data);
  if (!group) return null;
  const slot = group.slots.find((s) => s.status === "ready");
  return slot ? configForProfitSlot(group, slot) : null;
}
export async function serializeAcademy(): Promise<unknown> {
  await queue;
  if (!useAcademy.getState().hydrated) await useAcademy.getState().hydrate();
  if (storageBlocked) throw new Error("无法读取原学习存档，不能导出空数据代替");
  const data = await readData();
  useAcademy.setState({ data });
  return structuredClone(data);
}
export function validateAcademy(data: unknown): boolean {
  return schema.safeParse(data).success;
}
export async function restoreAcademy(data: unknown): Promise<void> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("学习备份格式或证据无效");
  await queue;
  await writeData(parsed.data);
  storageBlocked = false;
  useAcademy.setState({ data: parsed.data, hydrated: true, error: "" });
}
// Recovery-only: preserve a damaged original verbatim before a validated full import.
// Normal imports must use restoreAcademy so evidence is validated before any write.
export async function readRawAcademy(): Promise<unknown> {
  await queue;
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly");
    const request = tx.objectStore("state").get("current");
    let raw: unknown;
    request.onsuccess = () => {
      raw = request.result;
    };
    tx.oncomplete = () => resolve(raw);
    tx.onerror = () => reject(tx.error ?? new Error("无法读取原学习存档"));
    tx.onabort = () => reject(tx.error ?? new Error("原学习存档读取中止"));
  });
}
export async function restoreRawAcademy(raw: unknown): Promise<void> {
  await queue;
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    const store = tx.objectStore("state");
    if (raw === undefined) store.delete("current");
    else store.put(raw, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("原学习存档回滚失败"));
    tx.onabort = () => reject(tx.error ?? new Error("原学习存档回滚中止"));
  });
  const parsed = schema.safeParse(raw === undefined ? blank() : raw);
  storageBlocked = !parsed.success;
  useAcademy.setState({
    data: parsed.success ? parsed.data : blank(),
    hydrated: true,
    error: parsed.success
      ? ""
      : "原学习存档已原样保留，证据损坏，已阻止新写入。请先保全或恢复有效备份。",
  });
}
export async function setAcademyMaintenance(value: boolean): Promise<void> {
  maintenance = value;
  if (value) await queue;
}
