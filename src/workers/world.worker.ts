/// <reference lib="webworker" />
import { createWorld, stepWorld, applyCommand } from "../lib/world/engine.ts";
import type { World, WorldCommand, WorldConfig } from "../lib/world/types.ts";
let current: World | null = null;
self.onmessage = (
  event: MessageEvent<{
    id: number;
    type: string;
    world?: World | null;
    config?: WorldConfig;
    seconds?: number;
    command?: WorldCommand;
  }>,
) => {
  const m = event.data;
  try {
    let ok = true;
    let error: string | undefined;
    if (m.type === "load") current = m.world ?? null;
    else if (m.type === "create" && m.config) current = createWorld(m.config);
    else if (m.type === "advance" && current) current = stepWorld(current, m.seconds ?? 1);
    else if (m.type === "command" && current && m.command) {
      const result = applyCommand(current, m.command);
      current = result.world;
      ok = result.ok;
      error = result.error;
    }
    self.postMessage({ id: m.id, world: current, ok, error });
  } catch (e) {
    self.postMessage({
      id: m.id,
      ok: false,
      error: e instanceof Error ? e.message : "世界计算失败",
    });
  }
};
