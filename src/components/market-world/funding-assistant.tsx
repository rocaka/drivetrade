import { useEffect, useRef, useState } from "react";
import { useWorld } from "@/lib/world/store";
import { nextFundingStep } from "@/lib/world/funding";
import type { Atom, ChainId } from "@/lib/world/types";
import { ActionButton } from "./shared";
import { useTrainingActive } from "@/components/training-ui";

export function FundingAssistant({
  chain,
  amount,
  blockedReason,
}: {
  chain: ChainId;
  amount: Atom;
  blockedReason?: string;
}) {
  const world = useWorld((s) => s.world),
    readOnly = useWorld((s) => s.readOnly);
  const [running, setRunning] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0);
  const active = useTrainingActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) {
      generation.current++;
      setRunning(false);
      setMessage("已离开市场，后续调度暂停；已确认与在途资金保留");
    }
  }, [active]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        generation.current++;
        setRunning(false);
        setMessage("后台已暂停调度，已提交的操作保留");
      }
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    generation.current++;
    setRunning(false);
    return () => {
      generation.current++;
    };
  }, [chain, amount]);
  if (!world) return null;
  const step = nextFundingStep(world, chain, amount, "preview");
  if (step.kind === "ready" && !message) return null;
  async function prepare() {
    const start = useWorld.getState().world;
    if (!start || readOnly || blockedReason || !activeRef.current || document.hidden) return;
    const run = ++generation.current;
    setRunning(true);
    useWorld.getState().setPlaying(false);
    let commands = 0;
    try {
      for (let i = 0; i < 100 && generation.current === run; i++) {
        const state = useWorld.getState(),
          current = state.world;
        if (
          !current ||
          current.id !== start.id ||
          state.readOnly ||
          state.maintenance ||
          !activeRef.current ||
          document.hidden
        )
          throw new Error("训练状态已变化，资金调度已停止");
        if (current.now - start.now > 900 || commands > 12)
          throw new Error("本轮调度已到等待上限，已确认的资金操作保留，请稍后继续");
        const next = nextFundingStep(current, chain, amount, crypto.randomUUID());
        setMessage(next.message);
        if (next.kind === "ready") return;
        if (next.kind === "blocked") throw new Error(next.message);
        if (next.kind === "command") {
          if (!(await state.dispatch(next.command)))
            throw new Error(useWorld.getState().error || "资金操作未被接受");
          commands++;
        }
        if (generation.current !== run || !activeRef.current || document.hidden) return;
        const before = useWorld.getState().world!.now;
        await useWorld.getState().advance(15);
        if (useWorld.getState().world?.now === before)
          throw new Error(useWorld.getState().error || "模拟时间未推进，调度已停止");
      }
      if (generation.current === run) setMessage("调度已暂停，已确认与在途资金仍保留");
    } catch (e) {
      if (generation.current === run) setMessage(e instanceof Error ? e.message : "调度已停止");
    } finally {
      if (generation.current === run) setRunning(false);
    }
  }
  return (
    <div className="mw-funding-assistant">
      <p className="mw-muted" role="status">
        {blockedReason ||
          message ||
          "本链资金不足，可从账户现金准备。调度会推进模拟时间，并计入实际兑换、跨链与链费。"}
      </p>
      {running ? (
        <button
          className="mw-control-button"
          onClick={() => {
            generation.current++;
            setRunning(false);
            setMessage("调度已暂停，已确认与在途资金仍保留");
          }}
        >
          停止后续调度
        </button>
      ) : (
        step.kind !== "ready" && (
          <ActionButton
            secondary
            disabled={readOnly || !!blockedReason || step.kind === "blocked"}
            onClick={() => void prepare()}
          >
            自动准备资金
          </ActionButton>
        )
      )}
      {!message && step.kind === "blocked" && <p className="mw-inline-error">{step.message}</p>}
    </div>
  );
}
