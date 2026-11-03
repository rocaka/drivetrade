import { z } from "zod";
import * as legacy from "./legacy.ts";
import {
  applyTradingLabAction,
  createTradingLab,
  tradingExtraActionSchema,
  tradingLabResult,
  TRADING_LAB_CHALLENGES,
} from "./trading.ts";
import type { LabAction, LabRun, LabState } from "./types.ts";
export type {
  LabAction,
  LabChallenge,
  LabCheck,
  LabResult,
  LabRun,
  LabState,
  LabTradePlan,
} from "./types.ts";
export { labPrice, labSellQuote, labEquity, labConservation } from "./legacy.ts";
export { tradingBuyQuote, planRiskReward } from "./trading.ts";
export const LEGACY_LAB_CHALLENGES = legacy.LAB_CHALLENGES;
export const LAB_CHALLENGES = TRADING_LAB_CHALLENGES;
export const ALL_LAB_CHALLENGES = [...LAB_CHALLENGES, ...LEGACY_LAB_CHALLENGES];
export const getLabChallenge = (id: string) => ALL_LAB_CHALLENGES.find((c) => c.id === id);
export function createLab(id: string, seed: string): LabState {
  return id.startsWith("trade-practice-") ? createTradingLab(id, seed) : legacy.createLab(id, seed);
}
export function applyLabAction(state: LabState, action: LabAction): LabState {
  return state.version === "lab-v2-trading"
    ? applyTradingLabAction(state, action)
    : legacy.applyLabAction(state, action);
}
export function labResult(state: LabState) {
  return state.version === "lab-v2-trading" ? tradingLabResult(state) : legacy.labResult(state);
}
export const labActionSchema = z.union([legacy.labActionSchema, tradingExtraActionSchema]);
const tradingActionSchema = labActionSchema.refine(
  (action) => ["buy", "sell", "wait", "finish", "journal"].includes(action.type),
  "交易实操只记录买入、卖出、观察、结束与可选笔记",
);
export const labRunSchema = z.union([
  legacy.labRunSchema,
  z
    .object({
      version: z.literal("lab-v2-trading"),
      challengeId: z.string().refine((id) => LAB_CHALLENGES.some((c) => c.id === id)),
      seed: z.string().min(1).max(120),
      actions: z.array(tradingActionSchema).min(1).max(200),
      result: legacy.labRunSchema.shape.result,
    })
    .strict(),
]);
export function replayLabRun(run: Pick<LabRun, "challengeId" | "seed" | "actions">): LabState {
  let s = createLab(run.challengeId, run.seed);
  if (run.actions.length > 200) throw new Error("操作记录过长");
  for (const action of run.actions) {
    if (s.finished) throw new Error("封存后不能追加动作");
    s = applyLabAction(
      s,
      s.version === "lab-v1"
        ? legacy.labActionSchema.parse(action)
        : tradingActionSchema.parse(action),
    );
  }
  return s;
}
export function makeLabRun(id: string, seed: string, actions: LabAction[]): LabRun {
  const s = replayLabRun({ challengeId: id, seed, actions });
  return {
    version: s.version,
    challengeId: id,
    seed,
    actions: structuredClone(actions),
    result: labResult(s),
  };
}
export function validateLabRun(value: unknown): value is LabRun {
  const parsed = labRunSchema.safeParse(value);
  if (!parsed.success) return false;
  if (parsed.data.version === "lab-v1") return legacy.validateLabRun(value);
  try {
    const state = replayLabRun(parsed.data);
    return (
      state.version === parsed.data.version &&
      state.finished &&
      JSON.stringify(labResult(state)) === JSON.stringify(parsed.data.result) &&
      legacy.labConservation(state) === state.initialConservation &&
      state.tokens.every(
        (t) =>
          t.poolUnits + t.npcUnits + (state.positions[t.id]?.units ?? 0) === t.initialPoolUnits,
      )
    );
  } catch {
    return false;
  }
}
export function evaluateLabs(runs: readonly LabRun[]) {
  const valid = runs.filter((r) => r.version === "lab-v2-trading" && validateLabRun(r));
  const checks = LAB_CHALLENGES.map((c) => {
    const attempts = valid.filter((r) => r.challengeId === c.id);
    return {
      id: c.id,
      title: c.title,
      passed: attempts.some((r) => r.result.passed),
      bestScore: Math.max(0, ...attempts.map((r) => r.result.score)),
    };
  });
  return {
    passed: checks.every((c) => c.passed),
    completed: checks.filter((c) => c.passed).length,
    required: checks.length,
    checks,
    weaknesses: checks.filter((c) => !c.passed).map((c) => c.title),
  };
}
