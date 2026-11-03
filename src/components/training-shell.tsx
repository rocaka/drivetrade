import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { MarketWorld } from "./market-world/market-world";
import { AcademyScreen } from "./academy/academy";
import { WorldClock } from "./market-world/clock";
import { Button } from "./discipline/ui";
import {
  TextReveal,
  TrainingActivityProvider,
  TrainingNavigationProvider,
  type TrainingDestination,
} from "./training-ui";
import { useWorld, worldIsReadable } from "@/lib/world/store";
import { recoverFullImport } from "@/lib/academy/backup";
import type { WorldConfig } from "@/lib/world/types";
export function TrainingShell({
  page,
  active = true,
  destination,
  onBack,
  onNavigate,
}: {
  page: "academy" | "market";
  active?: boolean;
  destination: TrainingDestination;
  onBack: () => void;
  onNavigate: (target: TrainingDestination) => void;
}) {
  const readOnly = useWorld((s) => s.readOnly),
    worldError = useWorld((s) => s.error);
  const hydrateWorld = useWorld((s) => s.hydrate);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [confirmStart, setConfirmStart] = useState(false);
  const resolveStart = useRef<((value: boolean) => void) | null>(null);
  const [academyView, setAcademyView] = useState<"map" | "practice" | "exams" | "report">(
    destination.page === "academy" ? (destination.view ?? "map") : "map",
  );
  const [marketView, setMarketView] = useState<"market" | "account" | "review">(
    destination.page === "market" ? (destination.view ?? "market") : "market",
  );
  const [reviewSeed, setReviewSeed] = useState<string | undefined>(
    destination.page === "academy" ? destination.reviewSeed : undefined,
  );
  useEffect(() => {
    if (destination.page === "academy") {
      setAcademyView(destination.view ?? "map");
      setReviewSeed(destination.reviewSeed);
    } else setMarketView(destination.view ?? "market");
  }, [destination]);
  useEffect(() => {
    let active = true;
    setReady(false);
    void (async () => {
      try {
        await hydrateWorld();
        await recoverFullImport();
        if (active) setReady(true);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "恢复任务未完成");
      }
    })();
    return () => {
      active = false;
      resolveStart.current?.(false);
    };
  }, [hydrateWorld]);
  useEffect(() => {
    if (!active || page !== "market") useWorld.getState().setPlaying(false);
    if (!active) {
      resolveStart.current?.(false);
      resolveStart.current = null;
      setConfirmStart(false);
    }
  }, [page, active]);
  function leave() {
    useWorld.getState().setPlaying(false);
    onBack();
  }
  function navigate(target: TrainingDestination) {
    if (target.page !== "market") useWorld.getState().setPlaying(false);
    if (target.page === "market" && (target.view ?? "market") === "market")
      useWorld.getState().select(null);
    onNavigate(target);
  }
  async function market(config?: Partial<WorldConfig>): Promise<boolean> {
    const existing = useWorld.getState().world;
    if (config && existing?.phase !== "completed" && existing?.config.seed === config.seed) {
      navigate({ page: "market", view: "market" });
      return true;
    }
    if (config && existing && existing.phase !== "completed") {
      if (existing.config.mode === "exam") {
        toast.error("先完成或明确放弃当前正式世界，再开启下一场");
        return false;
      }
      const accepted = await new Promise<boolean>((resolve) => {
        resolveStart.current = resolve;
        setConfirmStart(true);
      });
      if (!accepted) return false;
    }
    if (config && existing?.phase === "completed" && existing.config.seed === config.seed) {
      toast.info("这场已经结算，请先核对本场复盘");
      navigate({ page: "market", view: "review" });
      return false;
    }
    if (config && !(await useWorld.getState().create(config))) {
      toast.error(useWorld.getState().error || "新世界尚未保存，请重试");
      return false;
    }
    navigate({ page: "market", view: "market" });
    return true;
  }
  function confirm(value: boolean) {
    resolveStart.current?.(value);
    resolveStart.current = null;
    setConfirmStart(false);
  }
  const unreadable = ready && !worldIsReadable();
  const unavailable =
    error ||
    (!ready
      ? "正在核对训练存档…"
      : unreadable
        ? worldError || "请回到账本导入有效的完整备份，原存档将先隔离保留。"
        : page === "academy" && readOnly
          ? worldError || "另一个标签正在训练。接管后继续，现有记录会保留。"
          : "");
  if (unavailable)
    return (
      <div className="training-flow-state">
        <div>
          <TextReveal
            as="h1"
            text={
              !ready && !error
                ? "恢复你的训练"
                : error || unreadable
                  ? "训练存档需要恢复"
                  : "在另一个标签训练中"
            }
          />
          <p role="status">{unavailable}</p>
          {ready && readOnly && !error && !unreadable && (
            <Button onClick={() => void useWorld.getState().takeOver()}>接管训练</Button>
          )}
          <Button variant="ghost" onClick={leave}>
            回到账本
          </Button>
        </div>
      </div>
    );
  return (
    <TrainingNavigationProvider value={{ page, academyView, onBack: leave, navigate }}>
      <WorldClock active={active && page === "market"} />
      <TrainingActivityProvider value={active && page === "market"}>
        <div hidden={page !== "market"} className="training-pane">
          <MarketWorld
            initialView={marketView}
            navigationKey={page === "market" ? destination : undefined}
            onViewChange={(view) => {
              if (active && page === "market" && view !== marketView)
                onNavigate({ page: "market", view });
            }}
            onBack={leave}
            onAcademy={(seed) =>
              navigate({
                page: "academy",
                view: seed ? "exams" : "practice",
                ...(seed ? { reviewSeed: seed } : {}),
              })
            }
          />
        </div>
      </TrainingActivityProvider>
      <div hidden={page !== "academy"} className="training-pane">
        <AcademyScreen
          initialView={academyView}
          initialReviewSeed={reviewSeed}
          onBack={leave}
          onMarket={market}
          onNavigate={(target) => {
            if (active && page === "academy") navigate(target);
          }}
        />
      </div>
      {confirmStart && (
        <div
          className="training-flow-modal"
          role="dialog"
          aria-modal="true"
          aria-label="保留当前练习，开始考核"
        >
          <section>
            <TextReveal as="h2" text="保留当前练习，开始考核？" />
            <p id="start-exam-title">
              当前自由世界会保留为未完成记录。新考核使用独立虚拟资金，不会覆盖原账本，也不把自由练习计入毕业。
            </p>
            <div className="training-flow-actions">
              <Button onClick={() => confirm(true)}>保留记录，开始考核</Button>
              <Button variant="ghost" onClick={() => confirm(false)}>
                继续当前练习
              </Button>
            </div>
          </section>
        </div>
      )}
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
    </TrainingNavigationProvider>
  );
}
