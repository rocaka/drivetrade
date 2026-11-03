import assert from "node:assert/strict";
import test from "node:test";
import { atoms } from "./amount.ts";
import {
  applyCommand,
  createWorld,
  stepWorld,
  settleWorld,
  transactionGas,
  tokenPrice,
} from "./engine.ts";
import { buildProcessReport } from "./process.ts";
import { compactArchive, validateWorld, worldSchema } from "./repository.ts";
import type { World, WorldConfig } from "./types.ts";
const config: WorldConfig = {
  seed: "simple-trading-v2",
  mode: "free",
  regime: "rotation",
  duration: 1800,
  spawnPerMinute: 6,
  protection: true,
  generationProfile: "mixed-v1",
  assessmentVersion: "process-v2-trading",
};
function buy() {
  const w = createWorld(config),
    token = w.tokens.find((t) => t.easterEgg === "btc")!;
  const r = applyCommand(w, {
    id: "buy-simple",
    type: "buy",
    tokenId: token.id,
    amount: atoms("0.002"),
    minOut: "0",
  });
  assert.equal(r.ok, true, r.error);
  return stepWorld(r.world, 10);
}
function valid(w: World) {
  assert.equal(validateWorld(w), true, JSON.stringify(worldSchema.safeParse(w)));
}
test("simple buy captures simulator guidance without a user plan or written reason", () => {
  const w = buy(),
    tx = w.transactions[0];
  assert.equal(tx.status, "confirmed");
  assert.equal(tx.plan, undefined);
  assert.equal(tx.source, "manual");
  assert.equal(tx.process?.origin, "automatic-snapshot");
  assert.equal(tx.process?.guide?.origin, "training-preset");
  assert.equal(tx.process?.guide?.maxHoldSeconds, 900);
  assert.equal(tx.process?.version, "process-v2-trading");
  assert.match(tx.note, /自主买入/);
  valid(w);
  valid(JSON.parse(JSON.stringify(w)));
  const exam = createWorld({ ...config, mode: "exam" });
  const result = applyCommand(exam, {
    id: "no-paperwork",
    type: "buy",
    tokenId: exam.tokens[0].id,
    amount: atoms("0.002"),
    minOut: "0",
  });
  assert.equal(result.ok, true, result.error);
});
test("actual manual partial sell earns exit evidence while later system settlement does not replace its origin", () => {
  let w = buy();
  const tx = w.transactions[0],
    amount = (BigInt(tx.out!) / 2n).toString();
  const r = applyCommand(w, {
    id: "manual-partial",
    type: "sell",
    tokenId: tx.tokenId!,
    amount,
    minOut: "0",
  });
  assert.equal(r.ok, true, r.error);
  w = stepWorld(r.world, 10);
  const lot = w.transactions[0];
  assert.equal(lot.process?.manualReduced, amount);
  assert.equal(lot.process?.manualExitConfirmedId, "manual-partial");
  assert.equal(buildProcessReport(w).checks.find((c) => c.id.endsWith(":exit"))?.passed, true);
  valid(w);
  w = settleWorld(w);
  assert.equal(w.report?.process?.version, "process-v2-trading");
  assert.equal(w.transactions[0].process?.closedBy, "settlement");
  assert.equal(w.report?.process?.checks.find((c) => c.id.endsWith(":exit"))?.passed, true);
  valid(w);
  valid(JSON.parse(JSON.stringify(compactArchive(w))));
  const forged = structuredClone(w);
  forged.report!.process!.score = 0;
  forged.report!.discipline.execution = 0;
  assert.equal(validateWorld(forged), false);
});
test("safety timeout exit stays a safety net and cannot count as manual skill", () => {
  let w = buy();
  w = stepWorld(w, 950);
  const lot = w.transactions[0];
  assert.equal(lot.process?.trigger, "timeout");
  assert.equal(lot.process?.closedBy, "safety");
  assert.ok(lot.process?.automaticExitAt);
  assert.equal(lot.process?.exitAttemptAt, undefined);
  assert.equal(lot.process?.manualReduced, undefined);
  assert.equal(buildProcessReport(w).checks.find((c) => c.id.endsWith(":exit"))?.passed, null);
  valid(w);
  const fake = structuredClone(w),
    safety = fake.transactions.find((tx) => tx.source === "safety")!;
  safety.source = "manual";
  assert.equal(validateWorld(fake), false);
});
test("period-end exits and reverted manual attempts do not fabricate successful manual sells", () => {
  let w = buy(),
    tx = w.transactions[0];
  const r = applyCommand(w, {
    id: "failed-sell",
    type: "sell",
    tokenId: tx.tokenId!,
    amount: tx.out!,
    minOut: atoms("100"),
  });
  assert.equal(r.ok, true);
  w = stepWorld(r.world, 10);
  tx = w.transactions[0];
  assert.equal(w.transactions.find((x) => x.id === "failed-sell")?.status, "reverted");
  assert.equal(tx.process?.manualReduced, undefined);
  assert.ok((tx.process?.sellFeesUsd ?? 0) > 0);
  w = settleWorld(w);
  assert.equal(w.transactions[0].process?.closedBy, "settlement");
  assert.equal(w.report!.process!.checks.find((c) => c.id.endsWith(":exit"))?.passed, null);
  valid(w);
});
test("teaching gas changes only v2; old profiles and process-v1 retain their exact fees", () => {
  const v2 = createWorld(config),
    v1 = createWorld({ ...config, assessmentVersion: "process-v1" }),
    legacy = createWorld({ ...config, assessmentVersion: undefined });
  assert.equal(transactionGas(v2, "solana"), "50");
  assert.equal(transactionGas(v2, "bnb"), "20");
  assert.equal(transactionGas(v2, "base"), "4");
  assert.equal(transactionGas(v1, "solana"), "12000");
  assert.equal(transactionGas(legacy, "base"), "140");
  assert.notEqual(v1.id, v2.id);
  const busy = createWorld({ ...config, regime: "stress", marketVariant: "busy" });
  assert.equal(transactionGas(busy, "solana"), "300");
  assert.equal(buildProcessReport(v2).score, 0);
  const old = settleWorld(v1);
  assert.equal(old.report?.process?.version, "process-v1");
  valid(old);
});
function reprice(w: World, tokenId: string, ratio: number) {
  const token = w.tokens.find((t) => t.id === tokenId)!,
    before = BigInt(token.pool.quote),
    after = BigInt(Math.floor(Number(before) * ratio));
  token.pool.quote = after.toString();
  w.treasury[token.chain].native = (
    BigInt(w.treasury[token.chain].native) +
    before -
    after
  ).toString();
}
test("adding during the crossing tick does not erase an older lot's safety boundary", () => {
  let w = buy();
  const first = w.transactions[0],
    tokenId = first.tokenId!;
  reprice(w, tokenId, 0.86);
  const result = applyCommand(w, {
    id: "add-before-cross",
    type: "buy",
    tokenId,
    amount: atoms("0.001"),
    minOut: "0",
  });
  assert.equal(result.ok, true, result.error);
  w = stepWorld(result.world, 1);
  assert.equal(w.transactions.find((tx) => tx.id === "add-before-cross")?.status, "pending");
  reprice(w, tokenId, 0.8 / 0.86);
  w = stepWorld(w, 1);
  assert.equal(w.transactions.find((tx) => tx.id === "add-before-cross")?.status, "confirmed");
  assert.ok(w.transactions.some((tx) => tx.source === "safety"));
  assert.equal(w.transactions[0].process?.trigger, "stop");
  valid(w);
});
test("explicit user protection survives added size and supersedes preset price triggers", () => {
  let w = buy();
  const tokenId = w.transactions[0].tokenId!,
    initialPrice = tokenPrice(w.tokens.find((t) => t.id === tokenId)!);
  const custom = applyCommand(w, {
    id: "custom-protection",
    type: "protect",
    tokenId,
    stopPrice: initialPrice * 0.7,
    targetPrice: initialPrice * 2,
  });
  assert.equal(custom.ok, true, custom.error);
  w = custom.world;
  reprice(w, tokenId, 0.8);
  const add = applyCommand(w, {
    id: "custom-add",
    type: "buy",
    tokenId,
    amount: atoms("0.001"),
    minOut: "0",
  });
  assert.equal(add.ok, true, add.error);
  w = stepWorld(add.world, 4);
  assert.equal(w.positions[tokenId].protectionSource, "user");
  assert.equal(w.positions[tokenId].stopPrice, initialPrice * 0.7);
  assert.equal(
    w.transactions.some((tx) => tx.source === "safety"),
    false,
  );
  valid(w);
  reprice(w, tokenId, 0.6 / 0.8);
  w = stepWorld(w, 1);
  assert.ok(w.transactions.some((tx) => tx.source === "safety"));
  valid(w);
});
