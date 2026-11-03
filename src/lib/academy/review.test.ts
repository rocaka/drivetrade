import test from "node:test";
import assert from "node:assert/strict";
import type { WorldReport } from "../world/types.ts";
import { buildWorldReviewQuestions } from "./review.ts";

function report(): WorldReport {
  return {
    worldId: "review-evidence-fixture",
    seed: "review-evidence",
    mode: "exam",
    regime: "rotation",
    marketVariant: "standard",
    elapsed: 7200,
    completed: true,
    initial: 10000,
    final: 9990,
    pnl: -10,
    returnPct: -0.1,
    baselineReturnPct: 0,
    excessPct: -0.1,
    fees: 2,
    trades: 2,
    violations: 0,
    maxDrawdownPct: 1,
    residual: 1,
    discipline: { risk: 100, execution: 80, review: 0 },
    events: [],
  };
}

function processReport(): WorldReport {
  return {
    ...report(),
    assessmentVersion: "process-v1",
    generationProfile: "mixed-v1",
    process: {
      version: "process-v1",
      score: 80,
      decisions: 1,
      checks: [
        {
          id: "exit-commitment",
          label: "按冻结失效价退出",
          passed: false,
          detail: "失效条件出现后没有及时提交退出",
          weight: 20,
          transactionId: "tx-1",
          eventIds: ["e-1"],
        },
      ],
      weaknesses: ["下一场在失效条件触发后及时提交退出"],
    },
    outcomes: [
      {
        tokenId: "token-1",
        symbol: "SIM",
        classification: "rug",
        label: "实际权限攻击",
        reason: "已执行冻结事件导致卖出受限",
        returnPct: -80,
        peakReturnPct: 20,
        ageSeconds: 3600,
        liquidityUsd: 200,
        standardExitUsd: 0,
        sellable: false,
        eventIds: ["e-1"],
      },
    ],
  };
}

test("historical reports retain the same three questions and answer positions", () => {
  const r = report(),
    before = structuredClone(r),
    questions = buildWorldReviewQuestions(r);
  assert.deepEqual(
    questions.map((q) => [q.id, q.answer, q.weight]),
    [
      ["fact", 1, 30],
      ["cause", 0, 30],
      ["next", 0, 40],
    ],
  );
  assert.deepEqual(r, before);
});

test("new review is grounded in actual cost, failed check, exit evidence and token outcome", () => {
  const r = processReport(),
    before = structuredClone(r),
    questions = buildWorldReviewQuestions(r);
  assert.deepEqual(
    questions.map((q) => q.id),
    ["fact", "cost", "execution", "exit", "outcome", "next"],
  );
  assert.equal(
    questions.reduce((sum, q) => sum + q.weight, 0),
    100,
  );
  assert.ok(questions[0].prompt.includes("9990.00"));
  assert.ok(questions[1].prompt.includes("2.00"));
  assert.ok(questions[2].prompt.includes("按冻结失效价退出"));
  assert.ok(questions[2].options[questions[2].answer].includes("未满足"));
  assert.ok(questions[2].explanation.includes("e-1"));
  assert.ok(questions[3].options[questions[3].answer].includes("未能按期退出"));
  assert.equal(questions[4].options[questions[4].answer], r.outcomes![0].reason);
  assert.equal(questions[5].options[questions[5].answer], r.process!.weaknesses[0]);
  assert.deepEqual(r, before);
});

test("same report has stable shuffled choices on retries and JSON restore", () => {
  const r = processReport();
  assert.deepEqual(
    buildWorldReviewQuestions(r),
    buildWorldReviewQuestions(JSON.parse(JSON.stringify(r))),
  );
  assert.ok(buildWorldReviewQuestions(r).some((q) => q.answer !== 0));
});

test("lack of process decisions or outcomes does not become a fabricated mastery or rug claim", () => {
  const r = processReport();
  r.process!.checks = [];
  r.process!.weaknesses = [];
  r.process!.decisions = 0;
  r.outcomes = [];
  const questions = buildWorldReviewQuestions(r);
  const execution = questions.find((q) => q.id === "execution")!;
  const outcome = questions.find((q) => q.id === "outcome")!;
  assert.ok(execution.options[execution.answer].includes("缺少执行样本"));
  assert.ok(outcome.options[outcome.answer].includes("证据不足"));
});
