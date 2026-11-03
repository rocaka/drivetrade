import type { Atom, ChainId, World } from "./types";
import { nextFundingStep } from "./funding";
import { useWorld } from "./store";

/** Executes the same visible swap/bridge/topup intents as the wallet. Every
 * stage is saved before proceeding; leaving the trading screen stops the rest. */
export async function prepareTradingBalance(options: {
  worldId: string;
  chain: ChainId;
  amount: (world: World) => Atom;
  continueIf: () => boolean;
  onProgress?: (message: string) => void;
}) {
  const initial = useWorld.getState().world;
  if (!initial || initial.id !== options.worldId) throw new Error("市场已变化，请重新确认");
  useWorld.getState().setPlaying(false);
  let commands = 0;
  const active = () =>
    options.continueIf() && (typeof document === "undefined" || !document.hidden);
  for (let i = 0; i < 100; i++) {
    if (!active()) throw new Error("后续操作已暂停，已准备和在途的余额保留");
    const state = useWorld.getState(),
      world = state.world;
    if (!world || world.id !== initial.id || state.readOnly || state.maintenance)
      throw new Error("训练状态已变化，后续操作停止");
    if (world.now - initial.now > 900 || commands > 12)
      throw new Error("余额准备尚未完成，可稍后继续；已确认的操作保留");
    const step = nextFundingStep(world, options.chain, options.amount(world), crypto.randomUUID());
    options.onProgress?.(step.message);
    if (step.kind === "ready") return;
    if (step.kind === "blocked") throw new Error(step.message);
    if (step.kind === "command") {
      if (!(await state.dispatch(step.command)))
        throw new Error(useWorld.getState().error || "余额准备未完成");
      commands++;
    }
    if (!active()) throw new Error("后续操作已暂停，已提交的操作保留");
    const before = useWorld.getState().world!.now;
    await useWorld.getState().advance(15);
    if (useWorld.getState().world?.now === before)
      throw new Error(useWorld.getState().error || "模拟已暂停，请稍后继续");
  }
  throw new Error("余额准备已暂停，可稍后继续");
}
