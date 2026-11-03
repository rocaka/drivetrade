import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Flag,
  X,
} from "lucide-react";
import { Button } from "@/components/discipline/ui";
import {
  AnimatedValue,
  TextReveal,
  TrainingDisclosure,
  TrainingHeader,
  type AcademyView,
  type TrainingDestination,
} from "@/components/training-ui";
import { useWorld } from "@/lib/world/store";
import type { WorldConfig } from "@/lib/world/types";
import {
  CURRICULUM_VERSION,
  LESSONS,
  STATIONS,
  PROFIT_LESSONS,
  PROFIT_STATIONS,
  LEGACY_LESSONS,
  LEGACY_STATIONS,
  getLessonById,
  getKnowledgeQuestionsForAttempt,
  KNOWLEDGE_QUESTIONS,
  CRITICAL_QUESTIONS,
  checkAnswers,
  type Question,
} from "@/lib/academy/content";
import {
  PRACTICE_SCENARIOS,
  gradeScenario,
  scenariosForRound,
  isCurrentFormalRound,
  type Scenario,
  type ScenarioAnswers,
} from "@/lib/academy/scenarios";
import {
  useAcademy,
  academyEvaluation,
  completedLessonIds,
  currentProfitGroup,
  nextWorldConfig,
  configForProfitSlot,
  recordWorldReport,
  worldReviewQuestions,
  worldReviewScore,
  VARIANT_LABELS,
  HOLDOUT_VERSION,
  type FrozenStrategy,
  type ProfitSlot,
  type ProfitGroup,
} from "@/lib/academy/store";
import { REGIME_LABELS } from "@/lib/academy/grading";
import {
  ADVANCED_LAB_CHALLENGES,
  LAB_CHALLENGES,
  evaluateLabs,
  getLabChallenge,
} from "@/lib/training-lab/engine";
import { PracticalLab } from "./practical-lab";
import { ProfitSimulator } from "./profit-simulator";
import "./academy.css";

type Props = {
  onBack: () => void;
  onMarket: (config?: Partial<WorldConfig>) => Promise<boolean> | boolean;
  initialView?: AcademyView;
  initialReviewSeed?: string;
  onNavigate?: (target: TrainingDestination) => void;
};
const viewNames: Record<AcademyView, string> = {
  map: "学习交易",
  practice: "交易练习",
  exams: "考核",
  report: "进度",
};
const fmt = (n: number) =>
  n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}`;
const starter: FrozenStrategy = {
  screening: "用小额观察价格和预计回款，等到可以接受的位置，再决定买入或继续观察。",
  avoid: "价格不合适、费用太高、相关仓位已经过多或到达停止线时，不再追加买入。",
  stakePct: 1,
  clusterPct: 3,
  totalPct: 10,
  exit: "买入后留意实际浮盈浮亏，到撤退条件减仓，到目标分批卖出，并核对实际到账。",
  stop: "连续亏损或达到本场停止线时，先停止新买入。保留交易记录，再观察下一次机会。",
};

// Unsubmitted drafts stay with the mounted screen; confirmed evidence belongs to IndexedDB.
const DraftContext = createContext<Map<string, unknown> | null>(null);
function useDraft<T>(key: string, initial: () => T): [T, Dispatch<SetStateAction<T>>] {
  const cache = useContext(DraftContext)!;
  const [value, update] = useState<T>(() => (cache.has(key) ? (cache.get(key) as T) : initial()));
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      update((previous) => {
        const result = typeof next === "function" ? (next as (v: T) => T)(previous) : next;
        cache.set(key, result);
        return result;
      });
    },
    [cache, key],
  );
  return [value, setValue];
}
function useTaskScroll(step: string | number) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const scroller = ref.current?.closest(".academy-main");
    if (scroller) scroller.scrollTop = 0;
  }, [step]);
  return ref;
}
function lessonForQuestion(id: string) {
  const extra: Record<string, string> = {
    "exam-25": "lesson-20",
    "exam-26": "lesson-23",
    "exam-27": "lesson-9",
    "exam-28": "lesson-23",
    "exam-29": "lesson-24",
    "exam-30": "lesson-10",
  };
  const tradingExtra: Record<string, string> = {
    "trade-q-25": "trade-lesson-22",
    "trade-q-26": "trade-lesson-14",
    "trade-q-27": "trade-lesson-9",
    "trade-q-28": "trade-lesson-21",
    "trade-q-29": "trade-lesson-23",
    "trade-q-30": "trade-lesson-24",
  };
  return (
    [...LESSONS, ...LEGACY_LESSONS].find((lesson) => lesson.question.id === id)?.id ??
    tradingExtra[id] ??
    extra[id] ??
    LESSONS[0].id
  );
}

export function AcademyScreen({
  onBack,
  onMarket,
  initialView = "map",
  initialReviewSeed,
  onNavigate,
}: Props) {
  const { data, hydrated, busy, error, hydrate, clearError } = useAcademy();
  const reports = useWorld((s) => s.reports);
  const world = useWorld((s) => s.world);
  const drafts = useRef(new Map<string, unknown>());
  const mainRef = useRef<HTMLElement>(null);
  const openedReview = useRef<string | undefined>(undefined);
  const [view, setView] = useState<AcademyView>(initialView);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [labId, setLabId] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [reviewSeed, setReviewSeed] = useState<string | null>(null);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const groupStarting = useRef(false);
  const [labHistoryLimit, setLabHistoryLimit] = useState(12);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [view, lessonId, scenario?.id, labId, knowledgeOpen, reviewSeed]);
  const evaluation = useMemo(() => academyEvaluation(data), [data]);
  const mastered = useMemo(() => new Set(completedLessonIds(data)), [data]);
  const profitMastered = useMemo(
    () =>
      new Set(
        PROFIT_LESSONS.filter((l) =>
          data.lessonAttempts.some((a) => a.lessonId === l.id && a.answer === l.question.answer),
        ).map((l) => l.id),
      ),
    [data],
  );
  const advancedLabs = useMemo(
    () => evaluateLabs(data.labRuns ?? [], ADVANCED_LAB_CHALLENGES),
    [data],
  );
  const nextProfitLesson =
    PROFIT_LESSONS.find((l) => !profitMastered.has(l.id)) ?? PROFIT_LESSONS[0];
  const profitGroup = currentProfitGroup(data);
  const reviewSlot = data.profitGroups
    .flatMap((g) => g.slots)
    .find((s) => s.seed === reviewSeed && s.report);
  const nextLesson = LESSONS.find((l) => !mastered.has(l.id)) ?? LESSONS[0];
  const nextLab =
    LAB_CHALLENGES.find((c) => !evaluation.labs.checks.find((item) => item.id === c.id)?.passed) ??
    LAB_CHALLENGES[0];
  const latestKnowledge = data.knowledgeAttempts.at(-1);
  const latestKnowledgeQuestions = latestKnowledge
    ? getKnowledgeQuestionsForAttempt(latestKnowledge)
    : KNOWLEDGE_QUESTIONS;
  const latestKnowledgeGrade = latestKnowledge
    ? checkAnswers(latestKnowledgeQuestions, latestKnowledge.answers)
    : null;
  const practiceScores = PRACTICE_SCENARIOS.map((s) => {
    const latest = data.scenarioAttempts.filter((a) => !a.formal && a.scenarioId === s.id).at(-1);
    return { scenario: s, grade: latest ? gradeScenario(s, latest.answers) : null };
  });
  const recommended = [...practiceScores].sort(
    (a, b) =>
      (a.grade ? a.grade.risk + a.grade.execution + a.grade.review : -1) -
      (b.grade ? b.grade.risk + b.grade.execution + b.grade.review : -1),
  )[0];
  function returnHub() {
    setLabId(null);
    setLessonId(null);
    setScenario(null);
    setKnowledgeOpen(false);
    setReviewSeed(null);
    if (reviewSeed) onNavigate?.({ page: "academy", view });
  }
  // An open exercise, lesson or practice quiz gets its own history entry, so Back (or the swipe
  // gesture) returns to the hub instead of leaving training. Formal exam rounds are left out so
  // Back can't abandon a graded attempt.
  const detailKey =
    labId ??
    lessonId ??
    (scenario && !scenario.formal ? scenario.id : null) ??
    (knowledgeOpen ? "knowledge" : null);
  const shownDetail = useRef<string | null>(null);
  useEffect(() => {
    const previous = shownDetail.current;
    shownDetail.current = detailKey;
    const state: unknown = window.history.state;
    const marked =
      typeof state === "object" && state !== null && "academyDetail" in state
        ? (state as { academyDetail: unknown }).academyDetail
        : null;
    if (detailKey && !previous)
      window.history.pushState({ ...(state as object), academyDetail: detailKey }, "");
    else if (detailKey && previous && marked)
      window.history.replaceState({ ...(state as object), academyDetail: detailKey }, "");
    else if (!detailKey && previous && marked) window.history.back();
  }, [detailKey]);
  useEffect(() => {
    const onPop = () => {
      const state: unknown = window.history.state;
      const marked = typeof state === "object" && state !== null && "academyDetail" in state;
      if (marked || !shownDetail.current) return;
      shownDetail.current = null;
      setLabId(null);
      setLessonId(null);
      setScenario((current) => (current?.formal ? current : null));
      setKnowledgeOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function navigate(next: AcademyView) {
    returnHub();
    setView(next);
    onNavigate?.({ page: "academy", view: next });
  }
  useEffect(() => {
    void hydrate();
    void useWorld.getState().hydrate();
  }, [hydrate]);
  useEffect(() => {
    setView(initialView);
    setLabId(null);
    setLessonId(null);
    setScenario(null);
    setKnowledgeOpen(false);
    setReviewSeed(null);
  }, [initialView]);
  useEffect(() => {
    if (hydrated)
      void (async () => {
        for (const report of reports) await recordWorldReport(report);
      })();
  }, [reports, hydrated]);
  useEffect(() => {
    if (!initialReviewSeed) {
      openedReview.current = undefined;
      return;
    }
    if (!hydrated || openedReview.current === initialReviewSeed) return;
    setLabId(null);
    setView("exams");
    setLessonId(null);
    setScenario(null);
    setKnowledgeOpen(false);
    const slot = data.profitGroups
      .flatMap((g) => g.slots)
      .find((s) => s.seed === initialReviewSeed && s.report);
    if (slot) {
      openedReview.current = initialReviewSeed;
      setReviewSeed(slot.seed);
      setMarketError("");
    } else setMarketError("这场结算尚未同步到观察组。可稍后从考核页的已结束世界继续复盘。");
  }, [initialReviewSeed, hydrated, data.profitGroups]);
  async function enterMarket(config?: Partial<WorldConfig>): Promise<boolean> {
    if (launchBusy) return false;
    setLaunchBusy(true);
    setMarketError("");
    try {
      const entered = await onMarket(config);
      if (!entered) setMarketError("市场暂未打开，已确认的场次仍然保留。点击原按钮即可重试。");
      return entered;
    } catch (e) {
      setMarketError(e instanceof Error ? e.message : "市场创建失败，当前场次已保留，可以重试。");
      return false;
    } finally {
      setLaunchBusy(false);
    }
  }
  function resumeFormalRound(id: string) {
    const current = useAcademy.getState().data;
    const round = current.formalRounds.find((r) => r.id === id);
    if (!round || round.abandoned || round.finishedAt) return;
    const next = scenariosForRound(round, current.scenarioAttempts).find((s) => {
      const attempt = current.scenarioAttempts.find(
        (a) => a.roundId === id && a.scenarioId === s.id,
      );
      return !attempt || !gradeScenario(s, attempt.answers).complete;
    });
    if (next) {
      setRoundId(id);
      setScenario(next);
    }
  }
  async function beginFormal(group: 0 | 1) {
    const existing = data.formalRounds
      .filter(
        (r) =>
          r.group === group &&
          !r.abandoned &&
          !r.finishedAt &&
          isCurrentFormalRound(r, data.scenarioAttempts),
      )
      .at(-1);
    const id = existing?.id ?? (await useAcademy.getState().startFormal(group));
    if (id) resumeFormalRound(id);
  }
  async function startTradingGroup() {
    if (groupStarting.current || busy || launchBusy) return;
    groupStarting.current = true;
    setStartBusy(true);
    try {
      if (await useAcademy.getState().startProfitGroup(starter)) await launchNext();
    } finally {
      groupStarting.current = false;
      setStartBusy(false);
    }
  }
  async function launchNext() {
    const current = useAcademy.getState().data;
    const group = currentProfitGroup(current);
    const active = group?.slots.find((s) => s.status === "started");
    if (active && group) {
      const entered = await enterMarket(
        world?.config.seed === active.seed && world.phase !== "completed"
          ? undefined
          : configForProfitSlot(group, active),
      );
      if (!entered) await useAcademy.getState().cancelUnstartedProfitSlot(active.seed);
      return;
    }
    const config = nextWorldConfig(current);
    if (config?.seed && (await useAcademy.getState().startProfitSlot(config.seed))) {
      const entered = await enterMarket(config);
      if (!entered) await useAcademy.getState().cancelUnstartedProfitSlot(config.seed);
    }
  }
  async function resumeGroup(group: ProfitGroup) {
    const slot =
      group.slots.find((s) => s.status === "started") ??
      group.slots.find((s) => s.status === "ready");
    if (!slot || launchBusy) return;
    if (slot.status === "ready" && !(await useAcademy.getState().startProfitSlot(slot.seed)))
      return;
    const entered = await enterMarket(
      world?.config.seed === slot.seed && world.phase !== "completed"
        ? undefined
        : configForProfitSlot(group, slot),
    );
    if (!entered) await useAcademy.getState().cancelUnstartedProfitSlot(slot.seed);
  }
  function formalDone() {
    const current = useAcademy.getState().data;
    const round = current.formalRounds.find((r) => r.id === roundId);
    if (round && !round.finishedAt) {
      const next = scenariosForRound(round, current.scenarioAttempts).find((s) => {
        const attempt = current.scenarioAttempts.find(
          (a) => a.roundId === round.id && a.scenarioId === s.id,
        );
        return !attempt || !gradeScenario(s, attempt.answers).complete;
      });
      if (next) {
        setScenario(next);
        return;
      }
    }
    setScenario(null);
    setView("exams");
  }
  function roundScenarios(id: string | null | undefined) {
    const round = data.formalRounds.find((item) => item.id === id);
    return round ? scenariosForRound(round, data.scenarioAttempts) : [];
  }
  const detailed = !!(lessonId || scenario || labId || knowledgeOpen || reviewSlot);

  return (
    <DraftContext.Provider value={drafts.current}>
      <div className="academy-shell" data-testid="academy-screen">
        <TrainingHeader title={viewNames[view]} kicker="买入 · 观察 · 卖出" />
        <main className="academy-main" ref={mainRef}>
          <nav className="academy-tabs" aria-label="学习与考核">
            {(
              (view === "map" || view === "practice"
                ? [
                    ["map", "开始"],
                    ["practice", "12项练习"],
                  ]
                : [
                    ["exams", "毕业考核"],
                    ["report", "训练记录"],
                  ]) as [AcademyView, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                aria-current={view === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {(error || marketError) && (
            <div className="academy-error" role="alert">
              <span>{error || marketError}</span>
              <button
                aria-label="关闭提示"
                onClick={() => {
                  clearError();
                  setMarketError("");
                }}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {!hydrated ? (
            <p className="academy-loading" role="status">
              正在读取训练记录…
            </p>
          ) : (
            <div className="academy-page">
              {labId ? (
                <PracticalLab
                  key={labId}
                  challengeId={labId}
                  runs={data.labRuns ?? []}
                  onSave={(run) => useAcademy.getState().recordLabRun(run)}
                  onClose={returnHub}
                  onOpen={setLabId}
                />
              ) : lessonId ? (
                <LessonReader
                  key={lessonId}
                  lessonId={lessonId}
                  onClose={returnHub}
                  onNext={setLessonId}
                />
              ) : scenario ? (
                <ScenarioRunner
                  key={`${roundId ?? "practice"}-${scenario.id}`}
                  scenario={scenario}
                  roundId={roundId}
                  onClose={returnHub}
                  onDone={
                    scenario.formal
                      ? formalDone
                      : () => {
                          setScenario(null);
                          setView("practice");
                        }
                  }
                  onLesson={(id) => {
                    setScenario(null);
                    setLessonId(id);
                  }}
                />
              ) : knowledgeOpen ? (
                <KnowledgeExam
                  onClose={returnHub}
                  onLesson={(id) => {
                    setKnowledgeOpen(false);
                    setLessonId(id);
                  }}
                />
              ) : reviewSlot ? (
                <WorldReview key={reviewSlot.seed} slot={reviewSlot} onClose={returnHub} />
              ) : null}
              {!detailed && view === "map" && (
                <>
                  <PageLead
                    eyebrow={`${evaluation.labs.completed} / 12 项练习已做到`}
                    title="先买卖，再慢慢练稳。"
                    text="选金额，买入、卖出，或者继续观察。每次只练一个交易习惯。"
                  />
                  <section className="academy-next">
                    <p className="academy-eyebrow">
                      {evaluation.labs.passed ? "接着去完整市场" : "下一项练习"}
                    </p>
                    <h3>
                      {evaluation.labs.passed ? "在更多机会里，守住自己的节奏。" : nextLab.title}
                    </h3>
                    <p>
                      {evaluation.labs.passed
                        ? "开始24场交易考核，或者继续自由模拟。"
                        : nextLab.summary}
                    </p>
                    <Button
                      onClick={() =>
                        evaluation.labs.passed ? navigate("exams") : setLabId(nextLab.id)
                      }
                    >
                      {evaluation.labs.passed ? "查看交易考核" : "直接开始练习"}
                      <ArrowRight size={17} />
                    </Button>
                  </section>
                  <button className="academy-bridge" onClick={() => navigate("practice")}>
                    <span>
                      <strong>12项交易练习</strong>
                      <small>仓位、等入场、止损、分批卖出，动手练。</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                  <button
                    className="academy-bridge"
                    onClick={() => void enterMarket()}
                    disabled={launchBusy}
                  >
                    <span>
                      <strong>直接去自由市场</strong>
                      <small>自己选项目，随时买卖与观察。</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                  <TrainingDisclosure
                    title="交易小课（选读）"
                    summary={`${mastered.size}/24 · 不必先答题，随时可以练交易`}
                  >
                    <section className="academy-next">
                      <p className="academy-eyebrow">想了解原因，再看一小段</p>
                      <h3>{nextLesson.title}</h3>
                      <p>{nextLesson.summary}</p>
                      <Button variant="ghost" onClick={() => setLessonId(nextLesson.id)}>
                        读这一课
                        <BookOpen size={17} />
                      </Button>
                    </section>
                    <div className="academy-route">
                      {STATIONS.map((station, index) => {
                        const lessons = LESSONS.filter((l) => l.station === index),
                          count = lessons.filter((l) => mastered.has(l.id)).length;
                        return (
                          <TrainingDisclosure
                            key={station.title}
                            title={`${String(index + 1).padStart(2, "0")}  ${station.title}`}
                            summary={`${station.subtitle} · ${count}/3`}
                            className="academy-station"
                          >
                            <div className="academy-link-list">
                              {lessons.map((l) => (
                                <button
                                  className="academy-list-row"
                                  key={l.id}
                                  onClick={() => setLessonId(l.id)}
                                >
                                  <span className="academy-list-label">
                                    {mastered.has(l.id) ? (
                                      <CheckCircle2 size={17} className="is-good" />
                                    ) : (
                                      <span className="academy-node" />
                                    )}
                                    <span>{l.title}</span>
                                  </span>
                                  <ChevronRight size={17} />
                                </button>
                              ))}
                            </div>
                          </TrainingDisclosure>
                        );
                      })}
                    </div>
                  </TrainingDisclosure>
                  <TrainingDisclosure
                    title="进阶：怎样做到稳定盈利"
                    summary={`${profitMastered.size}/${PROFIT_LESSONS.length} 课 · ${advancedLabs.completed}/${advancedLabs.required} 项进阶实操 · 附模拟器`}
                    className="academy-profit-track"
                  >
                    <section className="academy-next">
                      <p className="academy-eyebrow">稳定盈利 = 正期望 × 小仓位 × 足够多次</p>
                      <h3>{nextProfitLesson.title}</h3>
                      <p>{nextProfitLesson.summary}</p>
                      <Button variant="ghost" onClick={() => setLessonId(nextProfitLesson.id)}>
                        读这一课
                        <BookOpen size={17} />
                      </Button>
                    </section>
                    <div className="academy-route">
                      {PROFIT_STATIONS.map((station, index) => {
                        const lessons = PROFIT_LESSONS.filter((l) => l.station === index),
                          count = lessons.filter((l) => profitMastered.has(l.id)).length;
                        return (
                          <TrainingDisclosure
                            key={station.title}
                            title={`${String(index + 1).padStart(2, "0")}  ${station.title}`}
                            summary={`${station.subtitle} · ${count}/${lessons.length}`}
                            className="academy-station"
                          >
                            <div className="academy-link-list">
                              {lessons.map((l) => (
                                <button
                                  className="academy-list-row"
                                  key={l.id}
                                  onClick={() => setLessonId(l.id)}
                                >
                                  <span className="academy-list-label">
                                    {profitMastered.has(l.id) ? (
                                      <CheckCircle2 size={17} className="is-good" />
                                    ) : (
                                      <span className="academy-node" />
                                    )}
                                    <span>{l.title}</span>
                                  </span>
                                  <ChevronRight size={17} />
                                </button>
                              ))}
                            </div>
                          </TrainingDisclosure>
                        );
                      })}
                    </div>
                    <button className="academy-bridge" onClick={() => navigate("practice")}>
                      <span>
                        <strong>4 项进阶实操</strong>
                        <small>按 1R 算仓位、保本保护余仓、时间止损、三笔同风险。</small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                    <ProfitSimulator />
                  </TrainingDisclosure>
                  <p className="academy-footnote">虚拟资金 · 操作自动记录 · 想看知识点时再展开</p>
                </>
              )}
              {!detailed && view === "practice" && (
                <>
                  <PageLead
                    eyebrow={`${evaluation.labs.completed} / 12 项实操达标`}
                    title="一次，只练好一个动作。"
                    text="不必填专业表格。买入、卖出、继续观察，结果由实际操作记录。"
                  />
                  <section className="academy-next">
                    <p className="academy-eyebrow">
                      {evaluation.labs.passed ? "继续巩固" : "下一项实操"}
                    </p>
                    <h3>
                      {LAB_CHALLENGES.find(
                        (c) => !evaluation.labs.checks.find((v) => v.id === c.id)?.passed,
                      )?.title ?? LAB_CHALLENGES[0].title}
                    </h3>
                    <Button
                      onClick={() =>
                        setLabId(
                          evaluation.labs.checks.find((c) => !c.passed)?.id ?? LAB_CHALLENGES[0].id,
                        )
                      }
                    >
                      进入实操 <ArrowRight size={17} />
                    </Button>
                  </section>
                  <div className="academy-link-list">
                    {LAB_CHALLENGES.map((c, i) => {
                      const grade = evaluation.labs.checks.find((v) => v.id === c.id);
                      return (
                        <button
                          key={c.id}
                          className={`academy-list-row ${grade?.passed ? "is-done" : ""}`}
                          onClick={() => setLabId(c.id)}
                        >
                          <span className="academy-list-index">
                            {grade?.passed ? (
                              <Check size={15} aria-label="已达标" />
                            ) : (
                              String(i + 1).padStart(2, "0")
                            )}
                          </span>
                          <span className="academy-list-copy">
                            <strong>{c.title}</strong>
                            <small>
                              {grade?.passed ? `已达标 · 最佳${grade.bestScore}分` : c.summary}
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      );
                    })}
                  </div>
                  <section className="academy-advanced-labs" aria-label="进阶实操">
                    <p className="academy-eyebrow">
                      进阶实操 · 选做 · {advancedLabs.completed} / {advancedLabs.required}
                    </p>
                    <h3>把盈利习惯练成肌肉记忆</h3>
                    <p className="academy-support">
                      不计入 12 项要求，配合「进阶：怎样做到稳定盈利」小课练习。
                    </p>
                    <div className="academy-link-list">
                      {ADVANCED_LAB_CHALLENGES.map((c, i) => {
                        const grade = advancedLabs.checks.find((v) => v.id === c.id);
                        return (
                          <button
                            key={c.id}
                            className={`academy-list-row ${grade?.passed ? "is-done" : ""}`}
                            onClick={() => setLabId(c.id)}
                          >
                            <span className="academy-list-index">
                              {grade?.passed ? (
                                <Check size={15} aria-label="已达标" />
                              ) : (
                                `进${i + 1}`
                              )}
                            </span>
                            <span className="academy-list-copy">
                              <strong>{c.title}</strong>
                              <small>
                                {grade?.passed ? `已达标 · 最佳${grade.bestScore}分` : c.summary}
                              </small>
                            </span>
                            <ChevronRight size={17} />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <TrainingDisclosure
                    title="想多理解一点（选做）"
                    summary="交易例子与小测，不是毕业前置"
                  >
                    <section className="academy-next">
                      <p className="academy-eyebrow">
                        {recommended.grade ? "建议补练" : "下一项训练"}
                      </p>
                      <h3>{recommended.scenario.title}</h3>
                      <p>{recommended.scenario.summary}</p>
                      <Button
                        onClick={() => {
                          setRoundId(null);
                          setScenario(recommended.scenario);
                        }}
                      >
                        开始这一项
                        <ArrowRight size={17} />
                      </Button>
                    </section>
                    <div className="academy-link-list">
                      {practiceScores.map(({ scenario: s, grade }, i) => (
                        <button
                          key={s.id}
                          className="academy-list-row"
                          onClick={() => {
                            setRoundId(null);
                            setScenario(s);
                          }}
                        >
                          <span className="academy-list-index">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="academy-list-copy">
                            <strong>{s.title}</strong>
                            <small>
                              {grade
                                ? `风控 ${grade.risk.toFixed(0)} · 执行 ${grade.execution.toFixed(0)} · 复盘 ${grade.review.toFixed(0)}`
                                : s.summary}
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                    </div>
                    <TrainingDisclosure title="关于这组小测" summary="可选，不影响实操与交易考核">
                      <p>
                        逐项选择或填写，再查看解释。六项全部完成后保存为训练证据；可以重新练习，不需要在市场里凑交易次数。
                      </p>
                    </TrainingDisclosure>
                  </TrainingDisclosure>
                </>
              )}
              {!detailed && view === "exams" && (
                <>
                  <PageLead
                    eyebrow="12项练习 · 24场实际交易"
                    title="把买卖，练成自己的节奏。"
                    text="先练动作，再在不同市场里重复。考核直接买卖，不需要先答题。"
                  />
                  <section className="academy-section">
                    <SectionHeading
                      number="01"
                      title="12项交易练习"
                      passed={evaluation.labs.passed}
                    />
                    <Progress value={evaluation.labs.completed} max={12} label="交易实操进度" />
                    <p className="academy-support">
                      已做到 {evaluation.labs.completed}/12 · 仓位、等入场、止损与分批卖出
                    </p>
                    <Button
                      variant={evaluation.labs.passed ? "ghost" : "primary"}
                      onClick={() => setLabId(nextLab.id)}
                    >
                      {evaluation.labs.passed ? "再练一个交易习惯" : `接着练：${nextLab.title}`}
                      <ArrowRight size={17} />
                    </Button>
                  </section>
                  <section className="academy-section">
                    <SectionHeading
                      number="02"
                      title="24场模拟交易"
                      passed={evaluation.profit.passed}
                    />
                    <div className="academy-observation-count">
                      <AnimatedValue value={evaluation.profit.valid} />
                      <span>/ 24 场完整记录</span>
                    </div>
                    <Progress value={evaluation.profit.valid} max={24} label="正式交易场次进度" />
                    <p className="academy-support">
                      每场120模拟分钟，可以暂停。买卖、费用和未成交都会保留，不挑选盈利场次。
                    </p>
                    {world?.config.mode === "exam" &&
                      world.phase !== "completed" &&
                      !profitGroup?.slots.some((slot) => slot.seed === world.config.seed) && (
                        <section className="academy-notice">
                          <h3>还有一场旧版交易没结束</h3>
                          <p>可以继续完成，或明确结束并保留原记录。</p>
                          <div className="academy-actions">
                            <Button variant="ghost" onClick={() => void enterMarket()}>
                              继续这场
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void useWorld
                                  .getState()
                                  .dispatch({ id: crypto.randomUUID(), type: "abandon" })
                              }
                            >
                              结束并保留记录
                            </Button>
                          </div>
                        </section>
                      )}
                    {profitGroup ? (
                      <>
                        {profitGroup.slots.some((slot) => slot.status === "abandoned") ? (
                          <>
                            <p className="academy-notice">
                              本组有未完成场次。保留这组记录，再开始一组完整交易。
                            </p>
                            <Button variant="ghost" onClick={() => setConfirmAbandon(true)}>
                              保留记录，准备重新开始
                            </Button>
                          </>
                        ) : (
                          <Button
                            disabled={
                              busy ||
                              launchBusy ||
                              profitGroup.slots.every((slot) => slot.status === "completed")
                            }
                            onClick={() => void launchNext()}
                          >
                            {launchBusy
                              ? "正在打开市场…"
                              : profitGroup.slots.every((slot) => slot.status === "completed")
                                ? "24场已完整结束"
                                : profitGroup.slots.some((slot) => slot.status === "started")
                                  ? "继续当前交易场"
                                  : "开始下一场交易"}
                            <ArrowRight size={17} />
                          </Button>
                        )}
                        <TrainingDisclosure
                          title="本组交易记录"
                          summary={`${profitGroup.slots.filter((slot) => slot.report).length}/24 场已结算`}
                        >
                          <div className="academy-world-dots">
                            {profitGroup.slots.map((slot, index) => (
                              <button
                                key={slot.seed}
                                aria-label={`第${index + 1}场${slot.report ? "，查看交易记录" : slot.status === "started" ? "，正在进行" : "，尚未开始"}`}
                                disabled={!slot.report}
                                className={slot.status}
                                onClick={() => setReviewSeed(slot.seed)}
                              >
                                {slot.report?.completed ? <Check size={16} /> : index + 1}
                              </button>
                            ))}
                          </div>
                          <div className="academy-link-list">
                            {profitGroup.slots
                              .filter((slot) => slot.report)
                              .map((slot) => (
                                <button
                                  className="academy-list-row"
                                  key={slot.seed}
                                  onClick={() => setReviewSeed(slot.seed)}
                                >
                                  <span className="academy-list-copy">
                                    <strong>第{profitGroup.slots.indexOf(slot) + 1}场</strong>
                                    <small>
                                      {slot.report!.completed ? "完整结束" : "未完整结束"} ·{" "}
                                      {slot.report!.trades}次成交
                                    </small>
                                  </span>
                                  <strong className={slot.report!.pnl >= 0 ? "is-good" : "is-bad"}>
                                    {signed(slot.report!.pnl)}
                                  </strong>
                                  <ChevronRight size={16} />
                                </button>
                              ))}
                          </div>
                        </TrainingDisclosure>
                        <TrainingDisclosure title="本组条件与管理" summary="24场采用同一组条件">
                          <StrategySummary strategy={profitGroup.strategy} />
                          <button
                            className="academy-text-btn is-bad"
                            onClick={() => setConfirmAbandon(true)}
                          >
                            结束本组，保留全部记录
                            <Flag size={15} />
                          </button>
                          {profitGroup.slots.every((slot) => slot.status === "completed") && (
                            <Button
                              variant="ghost"
                              disabled={busy || startBusy || launchBusy}
                              onClick={() => void startTradingGroup()}
                            >
                              新开一组，继续检验
                            </Button>
                          )}
                        </TrainingDisclosure>
                      </>
                    ) : (
                      <>
                        <Button
                          disabled={busy || startBusy || launchBusy}
                          onClick={() => void startTradingGroup()}
                        >
                          {startBusy || launchBusy ? "正在准备交易场…" : "开始交易考核"}
                          <ArrowRight size={17} />
                        </Button>
                        <p className="academy-footnote">
                          直接采用本组默认额度与停止条件，不用填写策略表。
                        </p>
                        <TrainingDisclosure
                          title="自定义条件（可选）"
                          summary="想写自己的规则，再展开"
                        >
                          <StrategySummary strategy={starter} />
                          <Button variant="ghost" onClick={() => setStrategyOpen(true)}>
                            自己写一组条件
                          </Button>
                        </TrainingDisclosure>
                      </>
                    )}
                    <TrainingDisclosure
                      title="这一组还差什么"
                      summary={
                        evaluation.profit.passed
                          ? "当前模型内达标"
                          : `${evaluation.profit.valid}/24 · 查看实际结果`
                      }
                    >
                      <div className="academy-checks">
                        {evaluation.profit.checks.map((c) => (
                          <div className="academy-check-row" key={c.id}>
                            <Status ok={c.passed} />
                            <div>
                              <strong>{c.label}</strong>
                              <p>{c.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      {evaluation.profit.errors.map((message) => (
                        <p className="is-bad" key={message}>
                          {message}
                        </p>
                      ))}
                    </TrainingDisclosure>
                  </section>
                  <TrainingDisclosure
                    title="交易小课与答题（选做）"
                    summary="24课、30题与书面场景，都不是毕业前置"
                  >
                    <button className="academy-text-btn" onClick={() => navigate("map")}>
                      看看交易小课
                      <BookOpen size={15} />
                    </button>
                    <section className="academy-section">
                      <SectionHeading
                        number="03"
                        title="交易小测（选做）"
                        passed={evaluation.discipline.passed}
                      />
                      <p className="academy-support">
                        课程 {mastered.size}/24 · 专项 {evaluation.discipline.practiceCount}/12
                      </p>
                      <button className="academy-list-row" onClick={() => setKnowledgeOpen(true)}>
                        <span className="academy-list-copy">
                          <strong>知识考核</strong>
                          <small>30道题 · 完整提交后判分</small>
                        </span>
                        <span className="academy-result-value">
                          {evaluation.discipline.knowledge.complete
                            ? `${evaluation.discipline.knowledge.score.toFixed(0)}分`
                            : "开始"}
                        </span>
                        <ChevronRight size={17} />
                      </button>
                      {evaluation.discipline.groups.map((g) => (
                        <div key={g.group} className="academy-formal-group">
                          <button
                            className="academy-list-row"
                            disabled={busy || g.passed}
                            onClick={() => void beginFormal(g.group)}
                          >
                            <span className="academy-list-copy">
                              <strong>正式专项 · 第{g.group + 1}组</strong>
                              <small>
                                {g.complete
                                  ? `风控 ${g.risk.toFixed(0)} · 执行 ${g.execution.toFixed(0)} · 复盘 ${g.review.toFixed(0)}`
                                  : "4个场景 · 每次确认立即冻结"}
                              </small>
                            </span>
                            <span className={g.passed ? "is-good" : "academy-result-value"}>
                              {g.passed
                                ? "已达标"
                                : g.complete
                                  ? "重考"
                                  : g.roundId
                                    ? "继续"
                                    : "开始"}
                            </span>
                            <ChevronRight size={17} />
                          </button>
                          {g.complete && (
                            <TrainingDisclosure
                              title="查看本组证据"
                              summary={g.passed ? "已达标" : `综合 ${g.total.toFixed(1)} · 待补强`}
                            >
                              <p>综合 {g.total.toFixed(1)}。当前知识成绩也参与本组综合评分。</p>
                              {roundScenarios(g.roundId).map((s) => {
                                const a = data.scenarioAttempts.find(
                                    (a) => a.roundId === g.roundId && a.scenarioId === s.id,
                                  ),
                                  grade = a ? gradeScenario(s, a.answers) : null;
                                return (
                                  <div className="academy-evidence" key={s.id}>
                                    <strong>{s.title}</strong>
                                    {grade?.evidence.map((e) => (
                                      <p key={e.objectiveId}>
                                        <span className={e.correct ? "is-good" : "is-bad"}>
                                          {e.correct ? "符合" : "需修正"}
                                        </span>{" "}
                                        · {e.explanation}
                                      </p>
                                    ))}
                                    <button
                                      className="academy-text-btn"
                                      onClick={() => {
                                        setRoundId(null);
                                        setScenario(
                                          PRACTICE_SCENARIOS.find(
                                            (p) => p.lessonId === s.lessonId,
                                          ) ?? recommended.scenario,
                                        );
                                      }}
                                    >
                                      补练相关专项
                                      <ArrowRight size={15} />
                                    </button>
                                  </div>
                                );
                              })}
                            </TrainingDisclosure>
                          )}
                        </div>
                      ))}
                      <TrainingDisclosure
                        title="小测怎么判分"
                        summary="只影响这组小测，不是毕业门槛"
                      >
                        <ul className="academy-reading-list">
                          <li>24课已掌握，12个专项均完成一次。</li>
                          <li>知识至少85分，{CRITICAL_QUESTIONS.length}道关键安全题全部正确。</li>
                          <li>两组分别达到：风控90、执行80、复盘75、综合85。</li>
                        </ul>
                        <p>正式专项每个确认决定都会保存，返回后从尚未确认的任务继续。</p>
                      </TrainingDisclosure>
                    </section>
                  </TrainingDisclosure>
                  {data.profitGroups.some(
                    (g) =>
                      g.configVersion !== HOLDOUT_VERSION &&
                      !g.abandoned &&
                      g.slots.some((slot) => slot.status === "ready" || slot.status === "started"),
                  ) && (
                    <TrainingDisclosure title="旧版交易组" summary="原规则与原成绩都保留">
                      {data.profitGroups
                        .filter(
                          (g) =>
                            g.configVersion !== HOLDOUT_VERSION &&
                            !g.abandoned &&
                            g.slots.some(
                              (slot) => slot.status === "ready" || slot.status === "started",
                            ),
                        )
                        .map((g) => (
                          <div className="academy-check-row" key={g.id}>
                            <span>
                              {g.configVersion} ·{" "}
                              {g.slots.filter((slot) => slot.status === "completed").length}/24
                            </span>
                            <Button
                              variant="ghost"
                              disabled={launchBusy}
                              onClick={() => void resumeGroup(g)}
                            >
                              继续旧组
                            </Button>
                          </div>
                        ))}
                    </TrainingDisclosure>
                  )}
                  <p className="academy-footnote">
                    毕业看实际练习与完整交易结果。模拟达标不代表现实盈利保证。
                  </p>
                </>
              )}
              {!detailed && view === "report" && (
                <>
                  <PageLead
                    eyebrow="每一步都有记录"
                    title={evaluation.graduated ? "这一阶段，练到了。" : "看见自己，正在变稳。"}
                    text={
                      evaluation.graduated
                        ? "继续训练，检查能力能否跨场景保持。实盘准备仍需自己负责。"
                        : "先看下一步，再按需要展开成绩与历史。"
                    }
                  />
                  <div className="academy-summary">
                    <Metric label="交易练习" value={`${evaluation.labs.completed}/12`} />
                    <Metric
                      label="已记费用"
                      value={fmt(
                        profitGroup?.slots.reduce(
                          (sum, slot) => sum + (slot.report?.fees ?? 0),
                          0,
                        ) ?? 0,
                      )}
                    />
                    <Metric label="正式世界" value={`${evaluation.profit.valid}/24`} />
                    <Metric label="观察组合计" value={signed(evaluation.profit.net)} />
                  </div>
                  <section className="academy-next">
                    <p className="academy-eyebrow">下一步</p>
                    <h3>
                      {!evaluation.labs.passed
                        ? nextLab.title
                        : evaluation.graduated
                          ? "继续自由模拟，保持自己的节奏。"
                          : profitGroup
                            ? "接着完成这一组实际交易。"
                            : "在完整市场里，开始检验。"}
                    </h3>
                    <Button
                      disabled={busy || launchBusy || startBusy}
                      onClick={() => {
                        if (!evaluation.labs.passed) setLabId(nextLab.id);
                        else if (evaluation.graduated) void enterMarket();
                        else if (profitGroup) navigate("exams");
                        else void startTradingGroup();
                      }}
                    >
                      {!evaluation.labs.passed
                        ? "接着练习"
                        : evaluation.graduated
                          ? "继续模拟"
                          : profitGroup
                            ? "继续交易考核"
                            : "开始交易考核"}
                      <ArrowRight size={17} />
                    </Button>
                  </section>
                  <TrainingDisclosure
                    title="练到哪里了"
                    summary={evaluation.graduated ? "当前模型内达标" : "看实际买卖积累的记录"}
                    defaultOpen
                  >
                    <div className="academy-check-row">
                      <Status ok={evaluation.labs.passed} />
                      <span>12项交易练习</span>
                      <strong>{evaluation.labs.completed}/12</strong>
                    </div>
                    <div className="academy-check-row">
                      <Status ok={evaluation.profit.passed} />
                      <span>24场实际交易</span>
                      <strong>{evaluation.profit.valid}/24</strong>
                    </div>
                    <button className="academy-text-btn" onClick={() => navigate("exams")}>
                      查看交易记录与要求
                      <ArrowRight size={15} />
                    </button>
                  </TrainingDisclosure>
                  <TrainingDisclosure
                    title="交易小课与自测（选做）"
                    summary={
                      latestKnowledgeGrade
                        ? `最近记录 ${latestKnowledgeGrade.score.toFixed(0)} 分 · ${latestKnowledgeQuestions === KNOWLEDGE_QUESTIONS ? "交易版" : "旧版原题"}`
                        : "想理解原因时再看，不影响毕业"
                    }
                  >
                    <button className="academy-text-btn" onClick={() => navigate("map")}>
                      看看交易小课
                      <BookOpen size={15} />
                    </button>
                    {latestKnowledge ? (
                      latestKnowledgeQuestions
                        .filter((q) => latestKnowledge.answers[q.id] !== q.answer)
                        .map((q) => (
                          <div className="academy-evidence" key={q.id}>
                            <strong>{q.prompt}</strong>
                            <p>{q.explanation}</p>
                            <button
                              className="academy-text-btn"
                              onClick={() => setLessonId(lessonForQuestion(q.id))}
                            >
                              回看对应原课
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        ))
                    ) : (
                      <p className="academy-support">不想答题，可以直接继续练习和交易。</p>
                    )}
                    {latestKnowledgeGrade?.score === 100 && (
                      <p className="academy-support">
                        本轮题目全部正确。实际买卖的过程与结果单独记录。
                      </p>
                    )}
                  </TrainingDisclosure>
                  <TrainingDisclosure
                    title="实操记录"
                    summary={`${data.labRuns?.length ?? 0}次练习 · 新旧版本分别保留`}
                  >
                    {(data.labRuns ?? [])
                      .slice()
                      .reverse()
                      .slice(0, labHistoryLimit)
                      .map((run, index) => (
                        <TrainingDisclosure
                          key={`${run.seed}-${index}`}
                          title={getLabChallenge(run.challengeId)?.title ?? run.challengeId}
                          summary={`${run.version === "lab-v2-trading" ? "交易版" : "旧版原题"} · ${run.result.passed ? "已做到" : "继续练习"} · ${run.result.score}分`}
                        >
                          <div className="academy-summary three">
                            <Metric label="本次净结果" value={signed(run.result.pnlCents / 100)} />
                            <Metric label="实际费用" value={fmt(run.result.feesCents / 100)} />
                            <Metric label="操作" value={`${run.actions.length}次`} />
                          </div>
                          {run.result.checks.map((check) => (
                            <p className="academy-support" key={check.id}>
                              <span className={check.passed ? "is-good" : "is-bad"}>
                                {check.passed ? "✓" : "○"}
                              </span>{" "}
                              {check.title} · {check.detail}
                            </p>
                          ))}
                        </TrainingDisclosure>
                      ))}
                    {(data.labRuns?.length ?? 0) > labHistoryLimit && (
                      <Button
                        variant="ghost"
                        onClick={() => setLabHistoryLimit((limit) => limit + 12)}
                      >
                        再看12条记录
                      </Button>
                    )}
                    {!data.labRuns?.length && (
                      <p className="academy-support">
                        买入、卖出、观察，完成一关后这里就会留下记录。
                      </p>
                    )}
                  </TrainingDisclosure>
                  <TrainingDisclosure
                    title="完整训练历史"
                    summary={`${data.profitGroups.length}个观察组 · ${data.formalRounds.length}个专项组 · ${data.knowledgeAttempts.length}次知识考核`}
                  >
                    {data.profitGroups.map((g, index) => (
                      <TrainingDisclosure
                        key={g.id}
                        title={`观察组 ${index + 1}`}
                        summary={`${new Date(g.createdAt).toLocaleDateString("zh-CN")} · ${
                          g.configVersion !== HOLDOUT_VERSION
                            ? "旧版，保留记录"
                            : g.abandoned
                              ? "已放弃"
                              : `${g.slots.filter((s) => s.status === "completed").length}/24`
                        }`}
                      >
                        <p className="academy-footnote">
                          {g.configVersion} ·{" "}
                          {g.configVersion !== HOLDOUT_VERSION
                            ? "旧版成绩完整保留，不自动换算成新标准；未完成场次仍可继续。"
                            : "混合市场 · 实际买入、观察与自主卖出"}
                        </p>
                        <StrategySummary strategy={g.strategy} />
                        {g.configVersion !== HOLDOUT_VERSION &&
                          !g.abandoned &&
                          g.slots.some((s) => s.status === "ready" || s.status === "started") && (
                            <Button
                              variant="ghost"
                              disabled={launchBusy}
                              onClick={() => void resumeGroup(g)}
                            >
                              继续旧版场次
                            </Button>
                          )}
                        {g.slots
                          .filter((slot) => slot.report)
                          .map((slot) => (
                            <button
                              className="academy-list-row"
                              key={slot.seed}
                              onClick={() => setReviewSeed(slot.seed)}
                            >
                              <span className="academy-list-copy">
                                <strong>世界 {g.slots.indexOf(slot) + 1}</strong>
                                <small>
                                  {slot.report!.completed ? "完整结束" : "提前结束"} ·{" "}
                                  {slot.report!.assessmentVersion === "process-v2-trading"
                                    ? `${slot.report!.trades}次成交，记录已保存`
                                    : `原版复盘 ${worldReviewScore(slot)} 分`}
                                </small>
                              </span>
                              <strong className={slot.report!.pnl >= 0 ? "is-good" : "is-bad"}>
                                {signed(slot.report!.pnl)}
                              </strong>
                              <ChevronRight size={16} />
                            </button>
                          ))}
                        {!g.slots.some((slot) => slot.report) && (
                          <p>尚无结算报告；冻结清单和启动状态仍保留。</p>
                        )}
                      </TrainingDisclosure>
                    ))}
                    {data.lessonAttempts.some((attempt) =>
                      LEGACY_LESSONS.some((lesson) => lesson.id === attempt.lessonId),
                    ) && (
                      <TrainingDisclosure
                        title="旧版课程记录"
                        summary="原课文、原题目与当时选择均保留"
                      >
                        {data.lessonAttempts
                          .filter((attempt) =>
                            LEGACY_LESSONS.some((lesson) => lesson.id === attempt.lessonId),
                          )
                          .slice()
                          .reverse()
                          .map((attempt) => {
                            const lesson = getLessonById(attempt.lessonId)!;
                            return (
                              <div className="academy-evidence" key={attempt.id}>
                                <strong>{lesson.title}</strong>
                                <p>当时选择：{lesson.question.options[attempt.answer]}</p>
                                <p>
                                  {attempt.answer === lesson.question.answer
                                    ? "原题答对"
                                    : "原题待补强"}{" "}
                                  · {lesson.question.explanation}
                                </p>
                                <button
                                  className="academy-text-btn"
                                  onClick={() => setLessonId(lesson.id)}
                                >
                                  查看原课
                                  <BookOpen size={15} />
                                </button>
                              </div>
                            );
                          })}
                      </TrainingDisclosure>
                    )}
                    {data.formalRounds.map((r, index) => (
                      <TrainingDisclosure
                        key={r.id}
                        title={`专项组 ${r.group + 1} · 第${index + 1}次`}
                        summary={`${new Date(r.startedAt).toLocaleDateString("zh-CN")} · ${isCurrentFormalRound(r, data.scenarioAttempts) ? "交易版小测" : "旧版原题"} · ${r.abandoned ? "已放弃" : r.finishedAt ? "已完成" : "进行中"}`}
                      >
                        {scenariosForRound(r, data.scenarioAttempts).map((s) => {
                          const attempt = data.scenarioAttempts.find(
                            (a) => a.roundId === r.id && a.scenarioId === s.id,
                          );
                          return (
                            <div className="academy-evidence" key={s.id}>
                              <strong>{s.title}</strong>
                              <p>已冻结 {Object.keys(attempt?.answers ?? {}).length}/6 项决定</p>
                              {r.finishedAt &&
                                attempt &&
                                gradeScenario(s, attempt.answers).evidence.map((item) => (
                                  <p key={item.objectiveId}>
                                    <span className={item.correct ? "is-good" : "is-bad"}>
                                      {item.correct ? "符合" : "需修正"}
                                    </span>{" "}
                                    · {item.explanation}
                                  </p>
                                ))}
                            </div>
                          );
                        })}
                        {!r.finishedAt && !r.abandoned && (
                          <Button variant="ghost" onClick={() => resumeFormalRound(r.id)}>
                            继续这组原版题目
                          </Button>
                        )}
                        {!r.finishedAt && (
                          <p className="academy-support">
                            整组完成前不提前显示答案；暂停不会更改已确认决定。
                          </p>
                        )}
                      </TrainingDisclosure>
                    ))}
                    {data.knowledgeAttempts.map((a, index) => (
                      <TrainingDisclosure
                        key={a.id}
                        title={`${getKnowledgeQuestionsForAttempt(a) === KNOWLEDGE_QUESTIONS ? "交易自测" : "旧版知识考核"} ${index + 1}`}
                        summary={`${new Date(a.at).toLocaleDateString("zh-CN")} · ${checkAnswers(getKnowledgeQuestionsForAttempt(a), a.answers).score.toFixed(0)}分`}
                      >
                        {getKnowledgeQuestionsForAttempt(a).map((q) => (
                          <div className="academy-evidence" key={q.id}>
                            <strong>{q.prompt}</strong>
                            <p>当时选择：{q.options[a.answers[q.id]]}</p>
                            <p>
                              <span className={a.answers[q.id] === q.answer ? "is-good" : "is-bad"}>
                                {a.answers[q.id] === q.answer ? "正确" : "需补强"}
                              </span>{" "}
                              · {q.explanation}
                            </p>
                          </div>
                        ))}
                      </TrainingDisclosure>
                    ))}
                    <p className="academy-support">
                      失败和放弃仍保留，不会用最好24场拼接。完整备份可在账本首页导出。
                    </p>
                    <button className="academy-text-btn" onClick={onBack}>
                      回到账本
                      <ArrowRight size={15} />
                    </button>
                  </TrainingDisclosure>
                  <TrainingDisclosure
                    title="实盘准备"
                    summary={evaluation.graduated ? "准备清单可用" : "交易练习与完整场次达标后开放"}
                  >
                    {evaluation.graduated ? (
                      <>
                        <ul className="academy-reading-list">
                          <li>仅使用能够承受全部损失的资金，不借款补亏。</li>
                          <li>核对市场、账户和权限，不分享助记词。</li>
                          <li>写清投入、退出、停止条件和异常处理。</li>
                          <li>未覆盖的链、平台与风险仍视为未评估。</li>
                        </ul>
                        <p>长期模拟也是正常选择。这不是交易所资格、服务端认证或真实盈利保证。</p>
                        <Button variant="ghost" onClick={() => void enterMarket()}>
                          继续模拟
                        </Button>
                      </>
                    ) : (
                      <p>
                        12项交易练习与24场实际交易结果达标后开放。课程与答题是选做，真实账本始终可用。
                      </p>
                    )}
                  </TrainingDisclosure>
                </>
              )}
            </div>
          )}
        </main>
        {strategyOpen && (
          <StrategyDialog
            busy={busy}
            onCancel={() => setStrategyOpen(false)}
            onSubmit={async (strategy) => {
              if (await useAcademy.getState().startProfitGroup(strategy)) {
                setStrategyOpen(false);
                setView("exams");
              }
            }}
          />
        )}
        {confirmAbandon && (
          <AcademyDialog title="登记放弃本组？" onClose={() => setConfirmAbandon(false)}>
            <p>
              已完成、亏损、未完成和策略全部保留。新组必须重新完成24场，不能挑选旧组的盈利世界。
            </p>
            {(error || marketError) && (
              <p className="is-bad" role="alert">
                {error || marketError}
              </p>
            )}
            <div className="academy-actions">
              <Button variant="ghost" onClick={() => setConfirmAbandon(false)}>
                继续本组
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  const active = useWorld.getState().world;
                  const belongs =
                    active && profitGroup?.slots.some((s) => s.seed === active.config.seed);
                  if (belongs && active.phase !== "completed") {
                    const ended = await useWorld
                      .getState()
                      .dispatch({ id: crypto.randomUUID(), type: "abandon" });
                    if (!ended) {
                      setMarketError(
                        useWorld.getState().error || "当前世界未成功结束，请重试，观察组仍保留。",
                      );
                      return;
                    }
                  }
                  const settled = useWorld.getState().world;
                  if (belongs && settled?.report) {
                    await recordWorldReport(settled.report);
                    const stored = currentProfitGroup(useAcademy.getState().data)?.slots.find(
                      (s) => s.seed === settled.config.seed,
                    );
                    if (!stored?.report) {
                      setMarketError("结算证据尚未保存到观察组，请重试。原世界已保留。");
                      return;
                    }
                  }
                  if (await useAcademy.getState().abandonProfitGroup()) {
                    setConfirmAbandon(false);
                    setMarketError("");
                  }
                }}
              >
                保留记录并放弃
              </Button>
            </div>
          </AcademyDialog>
        )}
      </div>
    </DraftContext.Provider>
  );
}

function PageLead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <section className="academy-page-lead">
      <p className="academy-eyebrow">{eyebrow}</p>
      <TextReveal key={title} text={title} as="h2" />
      <TextReveal key={text} text={text} as="p" />
    </section>
  );
}
function SectionHeading({
  number,
  title,
  passed,
}: {
  number: string;
  title: string;
  passed: boolean;
}) {
  return (
    <div className="academy-section-heading">
      <span>{number}</span>
      <h3>{title}</h3>
      {passed && <CheckCircle2 size={20} className="is-good" />}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div
      className="academy-progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}
function Status({ ok }: { ok: boolean | null }) {
  return ok ? (
    <CheckCircle2 className="is-good" size={18} />
  ) : (
    <span className={`academy-status ${ok === null ? "neutral" : ""}`}>
      {ok === null ? "—" : ""}
    </span>
  );
}
function Back({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="academy-text-btn academy-back" onClick={onClick}>
      <ArrowLeft size={16} />
      {children}
    </button>
  );
}
function Choices({
  question,
  selected,
  onChoose,
  disabled = false,
}: {
  question: Pick<Question, "id" | "prompt" | "options">;
  selected?: number;
  onChoose: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="academy-choices">
      <legend>
        <TextReveal key={question.id} text={question.prompt} as="p" />
      </legend>
      {question.options.map((option, i) => (
        <label className={selected === i ? "selected" : ""} key={`${question.id}-${i}`}>
          <input
            type="radio"
            name={question.id}
            checked={selected === i}
            disabled={disabled}
            onChange={() => onChoose(i)}
          />
          <span className="academy-choice-letter" aria-hidden>
            {String.fromCharCode(65 + i)}
          </span>
          <span>{option}</span>
          <span className="academy-choice-mark" aria-hidden>
            {selected === i && <Check size={17} />}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function LessonReader({
  lessonId,
  onClose,
  onNext,
}: {
  lessonId: string;
  onClose: () => void;
  onNext: (id: string) => void;
}) {
  const lesson = getLessonById(lessonId)!;
  const legacyCourse = LEGACY_LESSONS.some((item) => item.id === lessonId);
  const profitCourse = PROFIT_LESSONS.some((item) => item.id === lessonId);
  const course = legacyCourse ? LEGACY_LESSONS : profitCourse ? PROFIT_LESSONS : LESSONS;
  const stations = legacyCourse ? LEGACY_STATIONS : profitCourse ? PROFIT_STATIONS : STATIONS;
  const [draft, setDraft] = useDraft(`lesson:${lessonId}`, () => ({
    answer: undefined as number | undefined,
    submitted: false,
    phase: "read" as "read" | "check",
  }));
  const busy = useAcademy((s) => s.busy),
    correct = draft.answer === lesson.question.answer,
    next = course[course.findIndex((item) => item.id === lesson.id) + 1];
  const scrollRef = useTaskScroll(draft.phase);
  return (
    <article className="academy-reader" ref={scrollRef}>
      <Back
        onClick={
          draft.phase === "check" ? () => setDraft((d) => ({ ...d, phase: "read" })) : onClose
        }
      >
        {draft.phase === "check" ? "回看课程" : "学习路线"}
      </Back>
      <p className="academy-eyebrow">
        {legacyCourse ? "旧版原课 · " : profitCourse ? "进阶 · " : "选读 · "}
        {stations[lesson.station].title} · 第{course.findIndex((item) => item.id === lesson.id) + 1}
        课
      </p>
      {draft.phase === "read" ? (
        <>
          <TextReveal key={`${lessonId}-read`} text={lesson.title} as="h2" />
          <p className="academy-reader-summary">{lesson.summary}</p>
          <div className="academy-prose">
            {lesson.paragraphs.map((p, i) => (
              <TextReveal key={`${lessonId}-${i}`} text={p} as="p" />
            ))}
          </div>
          <section className="academy-example">
            <p className="academy-eyebrow">举个例子</p>
            <p>{lesson.example}</p>
          </section>
          <div className="academy-trap">
            <span>容易踩的坑</span>
            <p>{lesson.trap}</p>
          </div>
          <Button onClick={() => setDraft((d) => ({ ...d, phase: "check" }))}>
            用一道题检查理解（选做）
            <ArrowRight size={17} />
          </Button>
          <Button variant="ghost" onClick={() => (next ? onNext(next.id) : onClose())}>
            {next ? "直接看下一小课" : "返回练习"}
            <ArrowRight size={17} />
          </Button>
        </>
      ) : (
        <>
          <TextReveal key={`${lessonId}-check`} text="这个概念，你掌握了吗？" as="h2" />
          <p className="academy-support">{lesson.title} · 可随时回看课程</p>
          <Choices
            question={lesson.question}
            selected={draft.answer}
            onChoose={(answer) => setDraft((d) => ({ ...d, answer, submitted: false }))}
          />
          <Button
            disabled={draft.answer === undefined || busy}
            onClick={async () => {
              if (
                draft.answer !== undefined &&
                (await useAcademy.getState().answerLesson(lesson.id, draft.answer))
              )
                setDraft((d) => ({ ...d, submitted: true }));
            }}
          >
            {draft.submitted ? "再检查一次" : "检查理解"}
            <Check size={17} />
          </Button>
          {draft.submitted && (
            <section className={`academy-feedback ${correct ? "correct" : ""}`} role="status">
              <strong>{correct ? "概念已掌握" : "再分清这一步"}</strong>
              <p>{lesson.question.explanation}</p>
              {correct && (
                <Button variant="ghost" onClick={() => (next ? onNext(next.id) : onClose())}>
                  {next ? "继续下一课" : "回到路线"}
                  <ArrowRight size={17} />
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </article>
  );
}

type ScenarioDraft = {
  answers: ScenarioAnswers;
  step: number;
  checked: boolean;
  finished: boolean;
};
function ScenarioRunner({
  scenario,
  roundId,
  onClose,
  onDone,
  onLesson,
}: {
  scenario: Scenario;
  roundId: string | null;
  onClose: () => void;
  onDone: () => void;
  onLesson: (id: string) => void;
}) {
  const data = useAcademy((s) => s.data),
    busy = useAcademy((s) => s.busy);
  const saved = scenario.formal
    ? data.scenarioAttempts.find((a) => a.roundId === roundId && a.scenarioId === scenario.id)
        ?.answers
    : undefined;
  const [draft, setDraft] = useDraft<ScenarioDraft>(
    `scenario:${roundId ?? "practice"}:${scenario.id}`,
    () => ({
      answers: { ...saved },
      step: saved
        ? Math.max(
            0,
            scenario.tasks.findIndex((t) => saved[t.id] === undefined),
          )
        : 0,
      checked: false,
      finished: false,
    }),
  );
  const [freezeNotice, setFreezeNotice] = useState(false);
  const firstUnconfirmed = scenario.tasks.findIndex((t) => saved?.[t.id] === undefined);
  const step = scenario.formal && saved ? Math.max(0, firstUnconfirmed) : draft.step;
  const scrollRef = useTaskScroll(draft.finished ? "complete" : step);
  const task = scenario.tasks[step],
    answers = scenario.formal ? { ...draft.answers, ...saved } : draft.answers,
    response = answers[task.id],
    grade = gradeScenario(scenario, answers);
  function answer(value: number | undefined) {
    setDraft((d) => {
      const next = { ...d.answers };
      if (value === undefined) delete next[task.id];
      else next[task.id] = value;
      return { ...d, answers: next };
    });
  }
  async function commit() {
    if (response === undefined || !Number.isFinite(response)) return;
    if (scenario.formal && roundId) {
      if (
        !(await useAcademy.getState().commitScenarioAnswer(roundId, scenario.id, task.id, response))
      )
        return;
      setFreezeNotice(true);
      if (step === scenario.tasks.length - 1) {
        onDone();
        return;
      }
      setDraft((d) => ({ ...d, step: step + 1, checked: false }));
    } else if (!draft.checked) setDraft((d) => ({ ...d, checked: true }));
    else if (step < scenario.tasks.length - 1)
      setDraft((d) => ({ ...d, step: step + 1, checked: false }));
    else if (await useAcademy.getState().submitScenario(scenario.id, answers))
      setDraft((d) => ({ ...d, finished: true }));
  }
  if (draft.finished)
    return (
      <article className="academy-reader" ref={scrollRef}>
        <Back onClick={onDone}>专项列表</Back>
        <PageLead
          eyebrow="本次专项已保存"
          title={scenario.title}
          text="看清哪一步需要修正，再决定是否补练。"
        />
        <div className="academy-summary three">
          <Metric label="风控" value={grade.risk.toFixed(0)} />
          <Metric label="执行" value={grade.execution.toFixed(0)} />
          <Metric label="复盘" value={grade.review.toFixed(0)} />
        </div>
        <TrainingDisclosure
          title="逐项证据"
          summary={`${grade.evidence.filter((e) => e.correct).length}/6项符合要求`}
          defaultOpen={grade.evidence.some((e) => !e.correct)}
        >
          {grade.evidence.map((e) => (
            <div className="academy-evidence" key={e.objectiveId}>
              <strong className={e.correct ? "is-good" : "is-bad"}>
                {e.correct ? "符合要求" : "需要修正"}
              </strong>
              <p>{e.explanation}</p>
            </div>
          ))}
        </TrainingDisclosure>
        <Button onClick={onDone}>
          完成，返回专项列表
          <ArrowRight size={17} />
        </Button>
        <div className="academy-actions">
          <Button
            variant="ghost"
            onClick={() => setDraft({ answers: {}, step: 0, checked: false, finished: false })}
          >
            重新练习
          </Button>
          <Button variant="ghost" onClick={() => onLesson(scenario.lessonId)}>
            回看课程
          </Button>
        </div>
      </article>
    );
  return (
    <article className="academy-reader academy-question-screen" ref={scrollRef}>
      <Back onClick={onClose}>
        {scenario.formal ? "暂停，保留已冻结决定" : "返回，保留本次草稿"}
      </Back>
      <div className="academy-task-meta">
        <span>
          {scenario.formal ? "正式专项" : "专项练习"} · {scenario.title}
        </span>
        <span>
          {step + 1} / {scenario.tasks.length}
        </span>
      </div>
      <Progress value={step} max={scenario.tasks.length} label="专项任务进度" />
      <TrainingDisclosure
        key={`${scenario.id}-facts`}
        title="当前场景"
        summary={`${scenario.chain} · 查看账户与市场事实`}
        defaultOpen={step < 2}
      >
        <p>{scenario.summary}</p>
        <ul className="academy-reading-list">
          {scenario.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </TrainingDisclosure>
      <section className="academy-task" key={task.id}>
        <p className="academy-eyebrow">
          {task.dimension === "risk"
            ? "风险决策"
            : task.dimension === "execution"
              ? "执行动作"
              : "复盘证据"}
        </p>
        {task.options ? (
          <Choices
            question={{
              id: `${scenario.id}-${task.id}`,
              prompt: task.prompt,
              options: task.options,
            }}
            selected={response}
            onChoose={answer}
            disabled={draft.checked}
          />
        ) : (
          <label className="academy-number-question">
            <TextReveal key={task.id} text={task.prompt} as="p" />
            <div className="academy-number-input">
              <input
                aria-label="最大本金投入"
                inputMode="decimal"
                type="number"
                min="0"
                max="1000000"
                value={response ?? ""}
                disabled={draft.checked}
                onChange={(e) => answer(e.target.value === "" ? undefined : Number(e.target.value))}
              />
              <span>训练美元</span>
            </div>
            <small>只填写本金金额，预计费用另行保留。</small>
          </label>
        )}
        <Button
          disabled={response === undefined || !Number.isFinite(response) || busy}
          onClick={() => void commit()}
        >
          {scenario.formal
            ? "确认并冻结这个决定"
            : draft.checked
              ? step === scenario.tasks.length - 1
                ? "保存本次训练"
                : "下一项决定"
              : "检查这个决定"}
          <ArrowRight size={17} />
        </Button>
        {draft.checked && !scenario.formal && (
          <div
            className={`academy-feedback ${grade.evidence[step]?.correct ? "correct" : ""}`}
            role="status"
          >
            <strong>{grade.evidence[step]?.correct ? "这项决定符合要求" : "这里需要修正"}</strong>
            <p>{task.explanation}</p>
          </div>
        )}
      </section>
      {scenario.formal ? (
        <p className="academy-footnote" role="status">
          {freezeNotice ? "上一个决定已冻结并保存。" : "确认后立即保存，不能反向修改。"}{" "}
          本题未确认草稿仍可调整，答案在整组结束后显示。
        </p>
      ) : (
        <p className="academy-footnote">草稿保留在当前页面会话；六项全部完成后存为训练证据。</p>
      )}
    </article>
  );
}

function KnowledgeExam({
  onClose,
  onLesson,
}: {
  onClose: () => void;
  onLesson: (id: string) => void;
}) {
  const [draft, setDraft] = useDraft(`knowledge:${CURRICULUM_VERSION}`, () => ({
    answers: {} as Record<string, number>,
    page: 0,
    done: false,
  }));
  const busy = useAcademy((s) => s.busy),
    q = KNOWLEDGE_QUESTIONS[draft.page],
    grade = checkAnswers(KNOWLEDGE_QUESTIONS, draft.answers);
  const scrollRef = useTaskScroll(draft.done ? "complete" : draft.page);
  if (draft.done)
    return (
      <article className="academy-reader" ref={scrollRef}>
        <Back onClick={onClose}>考核</Back>
        <PageLead
          eyebrow="完整题组已保存"
          title={`${grade.score.toFixed(0)} 分`}
          text={
            grade.score >= 85 && grade.criticalPassed
              ? "这组自测完成。继续用实际买卖检验理解。"
              : "这组还有不熟的地方，可以回看。它不影响你继续练交易。"
          }
        />
        <div className="academy-check-row">
          <Status ok={grade.criticalPassed} />
          <span>关键安全题全部正确</span>
        </div>
        <TrainingDisclosure
          title="需要补强的题目"
          summary={`${grade.wrong.length}道`}
          defaultOpen={grade.wrong.length > 0}
        >
          {KNOWLEDGE_QUESTIONS.filter((item) => draft.answers[item.id] !== item.answer).map(
            (item) => (
              <div className="academy-evidence" key={item.id}>
                <strong>{item.prompt}</strong>
                <p>{item.explanation}</p>
                <button
                  className="academy-text-btn"
                  onClick={() => onLesson(lessonForQuestion(item.id))}
                >
                  回看课程
                  <ArrowRight size={15} />
                </button>
              </div>
            ),
          )}
          {!grade.wrong.length && <p>本轮全部正确。</p>}
        </TrainingDisclosure>
        <Button onClick={onClose}>
          回到考核
          <ArrowRight size={17} />
        </Button>
        <Button variant="ghost" onClick={() => setDraft({ answers: {}, page: 0, done: false })}>
          新建一轮知识考核
        </Button>
      </article>
    );
  return (
    <article className="academy-reader academy-question-screen" ref={scrollRef}>
      <Back onClick={onClose}>返回，保留本轮草稿</Back>
      <div className="academy-task-meta">
        <span>交易自测 · 选做</span>
        <span>{draft.page + 1} / 30</span>
      </div>
      <Progress value={Object.keys(draft.answers).length} max={30} label="知识答题进度" />
      <Choices
        question={q}
        selected={draft.answers[q.id]}
        onChoose={(value) => setDraft((d) => ({ ...d, answers: { ...d.answers, [q.id]: value } }))}
      />
      <div className="academy-actions">
        <Button
          variant="ghost"
          disabled={draft.page === 0}
          onClick={() => setDraft((d) => ({ ...d, page: d.page - 1 }))}
        >
          上一题
        </Button>
        {draft.page < 29 ? (
          <Button
            disabled={draft.answers[q.id] === undefined}
            onClick={() => setDraft((d) => ({ ...d, page: d.page + 1 }))}
          >
            下一题
            <ArrowRight size={17} />
          </Button>
        ) : (
          <Button
            disabled={!grade.complete || busy}
            onClick={async () => {
              if (await useAcademy.getState().submitKnowledge(draft.answers))
                setDraft((d) => ({ ...d, done: true }));
            }}
          >
            提交完整题组
            <Check size={17} />
          </Button>
        )}
      </div>
      <p className="academy-footnote">
        可返回检查，完成30题后统一判分。通过需总分至少85，且{CRITICAL_QUESTIONS.length}
        道关键安全题全部正确。
      </p>
      <TrainingDisclosure
        title="跳到已答题目"
        summary={`${Object.keys(draft.answers).length}/30 已答`}
      >
        <div className="academy-world-dots">
          {KNOWLEDGE_QUESTIONS.map((item, i) => (
            <button
              key={item.id}
              className={draft.answers[item.id] !== undefined ? "completed" : ""}
              aria-label={`第${i + 1}题${draft.answers[item.id] !== undefined ? "，已答" : ""}`}
              onClick={() => setDraft((d) => ({ ...d, page: i }))}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </TrainingDisclosure>
    </article>
  );
}

function WorldReview({ slot, onClose }: { slot: ProfitSlot; onClose: () => void }) {
  const report = slot.report!,
    questions = worldReviewQuestions(report);
  const latestReview = slot.reviewAttempts?.at(-1);
  const [draft, setDraft] = useDraft(
    `review:${report.worldId}:${report.assessmentVersion ?? "legacy"}`,
    () => ({
      answers: { ...(latestReview?.answers ?? {}) } as Record<string, number>,
      page: 0,
      done: !!latestReview,
    }),
  );
  const busy = useAcademy((s) => s.busy),
    score = questions.reduce(
      (sum, q) => sum + (draft.answers[q.id] === q.answer ? q.weight : 0),
      0,
    ),
    q = questions[draft.page];
  const scrollRef = useTaskScroll(draft.done ? "complete" : draft.page);
  if (report.assessmentVersion === "process-v2-trading")
    return (
      <article className="academy-reader" ref={scrollRef} data-testid="academy-trading-record">
        <Back onClick={onClose}>返回交易记录</Back>
        <PageLead
          eyebrow="实际买卖，自动留存"
          title="这场交易，钱是怎么变的。"
          text="看结果，也看入场、退出和费用。这里不用答题，记录已经随结算保存。"
        />
        <div className="academy-summary three">
          <Metric label="本场净结果" value={signed(report.pnl)} />
          <Metric label="实际费用" value={fmt(report.fees)} />
          <Metric label="真实成交" value={`${report.trades}次`} />
        </div>
        <TrainingDisclosure
          title="这场做到了什么"
          summary={`${report.process?.decisions ?? 0}次买入 · 自主交易记录`}
          defaultOpen
        >
          {report.process?.checks.map((item) => (
            <div className="academy-check-row" key={item.id}>
              <Status ok={item.passed} />
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </div>
            </div>
          ))}
        </TrainingDisclosure>
        <TrainingDisclosure title="下次留意一件事" summary="从实际记录找改进">
          {(report.process?.weaknesses ?? []).map((text) => (
            <p className="academy-support" key={text}>
              {text}
            </p>
          ))}
          {!report.process?.weaknesses.length && (
            <p className="academy-support">保持本场节奏，在新的机会里继续检验。</p>
          )}
        </TrainingDisclosure>
        <TrainingDisclosure title="项目后来怎样了" summary="只看已经发生的事实">
          {(report.outcomes ?? [])
            .filter((item) => ["rug", "quality", "dump"].includes(item.classification))
            .slice(0, 12)
            .map((item) => (
              <div className="academy-evidence" key={item.tokenId}>
                <strong>
                  {item.symbol} · {item.label}
                </strong>
                <p>{item.reason}</p>
              </div>
            ))}
          {!(report.outcomes ?? []).some((item) =>
            ["rug", "quality", "dump"].includes(item.classification),
          ) && <p className="academy-support">没有足够证据给项目贴结果标签，等待更多记录。</p>}
        </TrainingDisclosure>
        <TrainingDisclosure title="当时的记录" summary={`${report.events.length}条已发生事件`}>
          <div className="academy-link-list">
            {report.events
              .filter(
                (event) =>
                  event.at >= 0 &&
                  (event.commandId ||
                    ["daily-stop", "stop-trigger", "target-trigger", "settled"].includes(
                      event.type,
                    )),
              )
              .slice(-24)
              .map((event) => (
                <p className="academy-support" key={event.id}>
                  {event.message}
                </p>
              ))}
          </div>
        </TrainingDisclosure>
        <Button onClick={onClose}>
          回去继续训练
          <ArrowRight size={17} />
        </Button>
        <p className="academy-footnote">这份记录不改写成交、费用或盈亏，也没有答题门槛。</p>
      </article>
    );
  return (
    <article className="academy-reader academy-question-screen" ref={scrollRef}>
      <Back onClick={onClose}>返回观察组</Back>
      <p className="academy-eyebrow">{VARIANT_LABELS[slot.marketVariant]} · 结算后复盘</p>
      {draft.done ? (
        <>
          <PageLead
            eyebrow="原始答案已保存"
            title={`复盘证据 ${score} 分`}
            text={
              score >= 75
                ? "本场复盘证据达标。下一次继续按冻结策略执行。"
                : "还需要分清事实与判断，再补一轮复盘。"
            }
          />
          {questions
            .filter((item) => draft.answers[item.id] !== item.answer)
            .map((item) => (
              <div className="academy-feedback" key={item.id}>
                <p>{item.explanation}</p>
              </div>
            ))}
          <Button onClick={onClose}>
            返回观察组
            <ArrowRight size={17} />
          </Button>
          <Button variant="ghost" onClick={() => setDraft({ answers: {}, page: 0, done: false })}>
            再复盘一次
          </Button>
        </>
      ) : (
        <>
          <TextReveal text="先看事实，再找原因。" as="h2" />
          <div className="academy-summary three">
            <Metric label="成本后结果" value={signed(report.pnl)} />
            <Metric label="已发生成本" value={fmt(report.fees)} />
            <Metric label="未退出资产" value={String(report.residual)} />
          </div>
          <div className="academy-task-meta">
            <span>
              {{
                fact: "结果",
                cost: "成本",
                execution: "执行",
                exit: "退出",
                outcome: "项目",
                cause: "归因",
                next: "改进",
              }[q.id] ?? "证据"}
            </span>
            <span>
              {draft.page + 1} / {questions.length}
            </span>
          </div>
          <Choices
            question={q}
            selected={draft.answers[q.id]}
            onChoose={(value) =>
              setDraft((d) => ({ ...d, answers: { ...d.answers, [q.id]: value } }))
            }
          />
          <div className="academy-actions">
            <Button
              variant="ghost"
              disabled={draft.page === 0}
              onClick={() => setDraft((d) => ({ ...d, page: d.page - 1 }))}
            >
              上一项
            </Button>
            {draft.page < questions.length - 1 ? (
              <Button
                disabled={draft.answers[q.id] === undefined}
                onClick={() => setDraft((d) => ({ ...d, page: d.page + 1 }))}
              >
                下一项
                <ArrowRight size={17} />
              </Button>
            ) : (
              <Button
                disabled={questions.some((item) => draft.answers[item.id] === undefined) || busy}
                onClick={async () => {
                  if (await useAcademy.getState().reviewWorld(slot.seed, draft.answers))
                    setDraft((d) => ({ ...d, done: true }));
                }}
              >
                保存本次复盘
                <Check size={17} />
              </Button>
            )}
          </div>
          <p className="academy-footnote">复盘不改写成交或盈利。达到75分，才补齐本场复盘证据。</p>
          <TrainingDisclosure
            title="结算证据"
            summary={`${REGIME_LABELS[slot.regime]} · ${report.completed ? "完整结束" : "提前结束"}`}
          >
            <div className="academy-check-row">
              <span>风险证据</span>
              <strong>{report.discipline.risk.toFixed(0)}</strong>
            </div>
            <div className="academy-check-row">
              <span>执行证据</span>
              <strong>{report.discipline.execution.toFixed(0)}</strong>
            </div>
            <div className="academy-check-row">
              <span>主动越界</span>
              <strong>{report.violations}</strong>
            </div>
            <div className="academy-check-row">
              <span>超额收益</span>
              <strong>{report.excessPct.toFixed(2)}%</strong>
            </div>
          </TrainingDisclosure>
        </>
      )}
    </article>
  );
}
function StrategySummary({ strategy }: { strategy: FrozenStrategy }) {
  return (
    <div className="academy-strategy-summary">
      {[
        ["筛选", strategy.screening],
        ["放弃", strategy.avoid],
        ["退出", strategy.exit],
        ["停止", strategy.stop],
      ].map(([label, text]) => (
        <div key={label}>
          <span>{label}</span>
          <p>{text}</p>
        </div>
      ))}
      <p className="academy-support">
        单项目 {strategy.stakePct}% · 关联簇 {strategy.clusterPct}% · 新币合计 {strategy.totalPct}%
      </p>
    </div>
  );
}
function AcademyDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="academy-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="academy-dialog-head">
        <TextReveal text={title} as="h2" />
        <button className="academy-icon-btn" aria-label="关闭" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function StrategyDialog({
  onCancel,
  onSubmit,
  busy,
}: {
  onCancel: () => void;
  onSubmit: (strategy: FrozenStrategy) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useDraft("strategy", () => ({ strategy: { ...starter }, page: 0 }));
  const error = useAcademy((s) => s.error);
  const fields = [
    ["screening", "我如何筛选与观察"],
    ["avoid", "什么条件下我不参与"],
    ["exit", "我如何退出与处理失败"],
    ["stop", "我何时停止新增风险"],
  ] as const;
  const [key, label] = fields[draft.page],
    canSubmit = fields.every(([field]) => draft.strategy[field].trim().length >= 10);
  return (
    <AcademyDialog title="写下这组要验证的策略" onClose={onCancel}>
      {error && (
        <p className="is-bad" role="alert">
          {error}
        </p>
      )}
      <p className="academy-support">24场使用同一版本。建立观察组后，策略和场次一起冻结。</p>
      <div className="academy-task-meta">
        <span>策略准备</span>
        <span>{draft.page + 1} / 4</span>
      </div>
      <label className="academy-field">
        <TextReveal key={key} text={label} as="p" />
        <textarea
          autoFocus
          key={key}
          aria-label={label}
          value={draft.strategy[key]}
          maxLength={1200}
          rows={5}
          onChange={(e) =>
            setDraft((d) => ({ ...d, strategy: { ...d.strategy, [key]: e.target.value } }))
          }
        />
        <small>可以修改这个起点，至少写清10个字。</small>
      </label>
      <TrainingDisclosure title="本场风险上限" summary="单项目1% · 关联簇3% · 新币合计10%">
        <p>
          采用全损口径，并保留必要费用。数值与正式世界一致；靠很近的止损线不能降低全损暴露。这是训练上限。
        </p>
      </TrainingDisclosure>
      <div className="academy-actions">
        <Button
          variant="ghost"
          onClick={() => (draft.page ? setDraft((d) => ({ ...d, page: d.page - 1 })) : onCancel())}
        >
          {draft.page ? "上一步" : "稍后再写"}
        </Button>
        {draft.page < 3 ? (
          <Button
            disabled={draft.strategy[key].trim().length < 10}
            onClick={() => setDraft((d) => ({ ...d, page: d.page + 1 }))}
          >
            下一项
            <ArrowRight size={17} />
          </Button>
        ) : (
          <Button disabled={busy || !canSubmit} onClick={() => void onSubmit(draft.strategy)}>
            确认冻结并建组
            <Flag size={17} />
          </Button>
        )}
      </div>
    </AcademyDialog>
  );
}
