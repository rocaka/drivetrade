import { LESSONS, KNOWLEDGE_QUESTIONS, CURRICULUM_VERSION } from "./trading-content.ts";
import { LESSONS as oldLessons, KNOWLEDGE_QUESTIONS as oldQuestions } from "./legacy-content.ts";
import type { Lesson, Question } from "./legacy-content.ts";
export * from "./trading-content.ts";
export { checkAnswers } from "./legacy-content.ts";
export type { Lesson, Question } from "./legacy-content.ts";
export {
  CURRICULUM_VERSION as LEGACY_CURRICULUM_VERSION,
  STATIONS as LEGACY_STATIONS,
} from "./legacy-content.ts";
export const LEGACY_LESSONS = oldLessons;
export const LEGACY_KNOWLEDGE_QUESTIONS = oldQuestions;
export const REFERENCE_LESSONS = oldLessons.filter((l) =>
  ["lesson-4", "lesson-5", "lesson-6", "lesson-10", "lesson-12", "lesson-14"].includes(l.id),
);
export function getLessonById(id: string): Lesson | undefined {
  return [...LESSONS, ...oldLessons].find((l) => l.id === id);
}
export function getKnowledgeQuestionById(id: string): Question | undefined {
  return [...KNOWLEDGE_QUESTIONS, ...oldQuestions].find((q) => q.id === id);
}
export function getKnowledgeQuestionsForAttempt(attempt: {
  answers: Record<string, number>;
  curriculumVersion?: string;
}): Question[] {
  return attempt.curriculumVersion === CURRICULUM_VERSION ||
    Object.keys(attempt.answers).some((id) => id.startsWith("trade-q-"))
    ? KNOWLEDGE_QUESTIONS
    : oldQuestions;
}
