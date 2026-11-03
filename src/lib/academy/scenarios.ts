import { CURRICULUM_VERSION } from "./content.ts";
import { FORMAL_SCENARIOS, PRACTICE_SCENARIOS } from "./trading-scenarios.ts";
import {
  FORMAL_SCENARIOS as oldFormal,
  PRACTICE_SCENARIOS as oldPractice,
} from "./legacy-scenarios.ts";
import type { Scenario } from "./trading-scenarios.ts";
export * from "./trading-scenarios.ts";
export { gradeScenario } from "./legacy-scenarios.ts";
export type { Dimension, ScenarioTask, ScenarioAnswers } from "./legacy-scenarios.ts";
export const LEGACY_FORMAL_SCENARIOS = oldFormal;
export const LEGACY_PRACTICE_SCENARIOS = oldPractice;
export function getScenarioById(id: string): Scenario | undefined {
  return [...FORMAL_SCENARIOS, ...PRACTICE_SCENARIOS, ...oldFormal, ...oldPractice].find(
    (s) => s.id === id,
  );
}
type Round = { id?: string; group: 0 | 1; curriculumVersion?: string };
type Attempt = { roundId: string | null; scenarioId: string };
export function isCurrentFormalRound(round: Round, attempts: readonly Attempt[] = []): boolean {
  return (
    round.curriculumVersion === CURRICULUM_VERSION ||
    (!round.curriculumVersion &&
      attempts.some(
        (a) => a.roundId === round.id && FORMAL_SCENARIOS.some((s) => s.id === a.scenarioId),
      ))
  );
}
export function scenariosForRound(round: Round, attempts: readonly Attempt[] = []): Scenario[] {
  const source = isCurrentFormalRound(round, attempts) ? FORMAL_SCENARIOS : oldFormal;
  return source.slice(round.group * 4, round.group * 4 + 4);
}
