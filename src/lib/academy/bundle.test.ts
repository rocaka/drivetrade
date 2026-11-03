import test from "node:test";
import assert from "node:assert/strict";
import { packBackupBundle, unpackBackupBundle } from "./bundle.ts";
const data = {
  version: 3,
  trades: [{ id: "old-trade" }],
  rules: [{ id: "new-rule" }],
  principal: 100,
  training: {
    schemaVersion: 1,
    world: {
      version: 1,
      world: { id: "current" },
      archives: [{ id: "history-1" }, { id: "history-2" }],
      reports: [],
    },
    academy: { schemaVersion: 1, attempts: [1, 2] },
  },
};
test("all legacy rules, learning evidence and separate worlds round trip through manifest", async () => {
  const text = await packBackupBundle(data);
  const parsed = JSON.parse(text);
  assert.equal(parsed.manifest.parts.length, 4);
  assert.deepEqual(await unpackBackupBundle(parsed), data);
});
test("a missing, duplicated or corrupted part is never restored as an incomplete success", async () => {
  const original = JSON.parse(await packBackupBundle(data));
  for (const alter of [
    (v: any) => v.chunks.pop(),
    (v: any) => v.chunks.push(v.chunks[0]),
    (v: any) => (v.chunks[2].payload.id = "tampered"),
    (v: any) => (v.manifest.parts[0].sha256 = "0".repeat(64)),
  ]) {
    const v = structuredClone(original);
    alter(v);
    await assert.rejects(() => unpackBackupBundle(v));
  }
});
test("unknown bundle version and changed part type fail closed", async () => {
  const v = JSON.parse(await packBackupBundle(data));
  await assert.rejects(() => unpackBackupBundle({ ...v, schemaVersion: 2 }));
  v.manifest.parts[2].kind = "academy";
  await assert.rejects(() => unpackBackupBundle(v));
});
