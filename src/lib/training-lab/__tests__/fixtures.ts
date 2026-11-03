/** Test-only executable paths. Never imported by UI or production grading. */
import { LAB_CHALLENGES, makeLabRun } from "../engine.ts";
import type { LabAction, LabRun } from "../types.ts";
const buy = (tokenId = "token-a", cents = 400): LabAction => ({
  type: "buy",
  tokenId,
  cents,
  slippageBps: 500,
  ttlSteps: 6,
});
const sell = (tokenId = "token-a", percent: 25 | 50 | 100 = 100): LabAction => ({
  type: "sell",
  tokenId,
  percent,
});
const wait = (steps = 1): LabAction => ({ type: "wait", steps });
export function passingTradingActions(index: number): LabAction[] {
  const a: LabAction[] = [];
  if ([1, 12].includes(index)) a.push(buy(), sell());
  if ([2, 5].includes(index)) a.push(wait(2), buy(), sell());
  if (index === 3) a.push(wait(2), sell());
  if (index === 4) a.push(wait(2), sell("token-a", 50), sell());
  if (index === 6) a.push(buy("token-b"), sell("token-b"));
  if (index === 7) a.push(sell(), wait(4));
  if (index === 8) a.push(sell(), sell("token-b"));
  if (index === 9) a.push(wait(), buy("token-b"), sell("token-b"));
  if (index === 10) a.push(wait(2), buy(), wait(2), sell());
  if (index === 11) a.push(buy(), sell(), buy("token-b"), sell("token-b"));
  a.push({ type: "finish" });
  return a;
}
export function makePassingTradingRuns(seed: string): LabRun[] {
  return LAB_CHALLENGES.map((challenge, index) =>
    makeLabRun(challenge.id, seed, passingTradingActions(index + 1)),
  );
}
