import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { executionStats, useTrading } from "@/lib/trading/store";
import { cn } from "@/lib/cn";
import { ChecklistScreen } from "./checklist";
import { HomeScreen } from "./home";
import { JournalScreen } from "./journal";
import { RulesScreen } from "./rules";
import {
  appLocationFor,
  appLocationUrl,
  readAppLocation,
  type TrainingDestination,
} from "@/lib/training/navigation";

const StatsScreen = lazy(() => import("./stats").then((m) => ({ default: m.StatsScreen })));

const TrainingShell = lazy(() =>
  import("@/components/training-shell").then((m) => ({ default: m.TrainingShell })),
);

type Tab = "home" | "checklist" | "journal" | "rules" | "stats" | "academy" | "market";

const tabs: { id: Tab; label: string }[] = [
  { id: "home", label: "首页" },
  { id: "checklist", label: "检查" },
  { id: "journal", label: "日志" },
  { id: "rules", label: "铁律" },
  { id: "stats", label: "统计" },
];

const titles: Record<Tab, string> = {
  home: "首页",
  checklist: "先过检查",
  journal: "记下这一笔",
  rules: "铁律",
  stats: "账本曲线",
  academy: "交易训练世界",
  market: "多链市场",
};

function useCount(target: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700);
      setValue(target * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return Math.round(value);
}

export function DisciplineApp() {
  const trades = useTrading((state) => state.trades);
  const stats = executionStats(trades);
  const [tab, updateTab] = useState<Tab>("home");
  const [trainingMounted, setTrainingMounted] = useState(false);
  const [trainingLocation, setTrainingLocation] = useState<TrainingDestination>({
    page: "academy",
    view: "map",
  });
  const [checklistOk, setChecklistOk] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editToken, setEditToken] = useState(0);

  useEffect(() => {
    const sync = () => {
      const location = readAppLocation(new URL(window.location.href));
      updateTab(location.screen);
      if (location.screen === "academy" || location.screen === "market") {
        setTrainingMounted(true);
        setTrainingLocation(location.training);
      }
    };
    sync();
    window.addEventListener("popstate", sync);
    void Promise.resolve(useTrading.persist.rehydrate()).then(() =>
      useTrading.getState().setHydrated(true),
    );
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(target: Tab | TrainingDestination) {
    const location = appLocationFor(target),
      url = appLocationUrl(new URL(window.location.href), location);
    if (url.href !== window.location.href) window.history.pushState(window.history.state, "", url);
    updateTab(location.screen);
    if (location.screen === "academy" || location.screen === "market") {
      setTrainingMounted(true);
      setTrainingLocation(location.training);
    }
  }
  function setTab(next: Tab) {
    navigate(next);
  }

  function openNewTrade() {
    setEditingId(null);
    setEditToken((value) => value + 1);
    setChecklistOk(true);
    setTab("journal");
  }

  function openEdit(id: string) {
    setEditingId(id);
    setEditToken((value) => value + 1);
    setTab("journal");
  }

  const shown = useCount(stats.rate);

  const inTraining = tab === "academy" || tab === "market";

  return (
    <>
      <div className="app-shell bg-bg text-fg" style={{ display: inTraining ? "none" : undefined }}>
        <section
          className={cn(
            "app-poster flex shrink-0 flex-col text-primary-fg",
            tab === "home" ? "min-h-[28dvh]" : "min-h-[20dvh]",
          )}
        >
          <nav
            className="app-nav mx-auto grid w-full max-w-lg grid-cols-5 gap-1 px-3 pt-[max(env(safe-area-inset-top,0px),0.5rem)]"
            aria-label="页面"
          >
            {tabs.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "min-h-10 rounded-full text-sm font-medium transition duration-300 touch-manipulation",
                    active ? "bg-primary-fg text-primary" : "text-primary-fg/70",
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div
            key={tab}
            className="poster-in mx-auto flex w-full max-w-lg flex-1 flex-col justify-end px-5 pb-4"
          >
            {tab === "home" ? (
              <>
                <p className="text-sm font-medium text-primary-fg/80">
                  {stats.total === 0
                    ? "执行率 · 记下第一笔后开始计算"
                    : `执行率 · 目标 80 · 连续按计划 ${stats.streak} 笔`}
                </p>
                <p className="mt-0.5 text-[4.25rem] font-black leading-none tabular-nums tracking-tight">
                  {stats.total === 0 ? (
                    "—"
                  ) : (
                    <>
                      {shown}
                      <span className="text-2xl">%</span>
                    </>
                  )}
                </p>
              </>
            ) : (
              <h1 className="text-4xl font-black leading-none tracking-tight">{titles[tab]}</h1>
            )}
          </div>
        </section>

        <main className="app-scroll bg-bg">
          <div className="mx-auto max-w-lg px-4 py-4">
            {tab === "home" ? (
              <HomeScreen
                onCheck={() => setTab("checklist")}
                onJournal={() => setTab("journal")}
                onStats={() => setTab("stats")}
                onRules={() => setTab("rules")}
                onAcademy={() => setTab("academy")}
                onMarket={() => setTab("market")}
              />
            ) : null}
            {tab === "checklist" ? (
              <div className="screen-in">
                <ChecklistScreen onPass={openNewTrade} />
              </div>
            ) : null}
            <JournalScreen
              visible={tab === "journal"}
              checklistOk={checklistOk}
              editingId={editingId}
              editToken={editToken}
              onNeedCheck={() => setTab("checklist")}
              onSaved={() => {
                setChecklistOk(false);
                setEditingId(null);
                setTab("stats");
              }}
            />
            {tab === "rules" ? (
              <div className="screen-in">
                <RulesScreen />
              </div>
            ) : null}
            {tab === "stats" ? (
              <div className="screen-in">
                <Suspense fallback={<p className="py-12 text-center text-sm text-muted">正在载入统计…</p>}>
                  <StatsScreen onEdit={openEdit} />
                </Suspense>
              </div>
            ) : null}
          </div>
        </main>

        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--color-surface)",
              color: "var(--color-fg)",
              border: "1px solid var(--color-line)",
            },
          }}
        />
      </div>
      {trainingMounted && (
        <div className="training-pane" hidden={!inTraining}>
          <Suspense
            fallback={
              <div className="app-scroll p-8 text-fg" role="status">
                正在载入交易训练世界…
              </div>
            }
          >
            <TrainingShell
              active={inTraining}
              page={trainingLocation.page}
              destination={trainingLocation}
              onBack={() => setTab("home")}
              onNavigate={navigate}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
