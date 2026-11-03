/** These fault tests use an in-memory IndexedDB implementation. They verify the
 * repository transaction contract, not browser crash/power-loss durability. */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createWorld, settleWorld, stepWorld } from "./engine.ts";
import {
  compactArchive,
  readArchives,
  readConsistentSnapshot,
  readRawWorldSnapshot,
  readRecord,
  restoreRawWorldSnapshot,
  saveCheckpoint,
  validateCheckpoint,
  worldDb,
  writeRecord,
  writeRecoveredCheckpoint,
  type Checkpoint,
  type RawWorldSnapshot,
} from "./repository.ts";

beforeEach(async () => {
  const db = await worldDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["state", "history", "imports"], "readwrite");
    for (const name of ["state", "history", "imports"]) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
});
function fixture(seed: string, done = false) {
  const w = createWorld({
    seed,
    mode: "free",
    regime: "rotation",
    duration: 7200,
    spawnPerMinute: 2,
    protection: false,
  });
  return done ? settleWorld(stepWorld(w, 60)) : w;
}
function checkpoint(seed: string, revision = 1, archiveSeeds: string[] = []): Checkpoint {
  const archives = archiveSeeds.map((s) => fixture(s, true));
  return {
    version: 1,
    world: fixture(seed),
    reports: archives.map((w) => w.report!),
    speed: 10,
    selectedId: null,
    revision,
    archives,
  };
}
/** Abort after the history write request is enqueued, when state.put and
 * history.clear have already been issued in the same real IDB transaction. */
async function abortAfterHistoryPut<T>(task: () => Promise<T>): Promise<T> {
  const put = IDBObjectStore.prototype.put;
  let injected = false;
  IDBObjectStore.prototype.put = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    if (this.name === "history" && !injected) {
      injected = true;
      const tx = this.transaction;
      queueMicrotask(() => tx.abort());
    }
    return request;
  };
  try {
    return await task();
  } finally {
    IDBObjectStore.prototype.put = put;
    assert.equal(injected, true, "the fault must have reached the history write");
  }
}

test("checkpoint and archives commit as one consistent saved snapshot", async () => {
  const cp = checkpoint("current", 1, ["archived-a", "archived-b"]);
  await saveCheckpoint(cp, 0);
  const saved = await readConsistentSnapshot();
  assert.ok(saved && validateCheckpoint(saved));
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.world, cp.world);
  assert.deepEqual(
    saved.archives,
    cp.archives!.map(compactArchive).sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(saved.reports, cp.reports);
});
test("a revision conflict rejects the stale writer without replacing its current world or history", async () => {
  await saveCheckpoint(checkpoint("old", 1, ["old-history"]), 0);
  const before = await readRawWorldSnapshot();
  await assert.rejects(
    saveCheckpoint(checkpoint("stale", 2, ["stale-history"]), 0),
    /版本无效|状态已变化/,
  );
  assert.deepEqual(await readRawWorldSnapshot(), before);
  const first = checkpoint("writer-a", 2, ["archive-a"]),
    second = checkpoint("writer-b", 2, ["archive-b"]);
  const results = await Promise.allSettled([saveCheckpoint(first, 1), saveCheckpoint(second, 1)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const winner = results[0].status === "fulfilled" ? first : second;
  const saved = (await readConsistentSnapshot())!;
  assert.deepEqual(saved.world, winner.world);
  assert.deepEqual(
    saved.archives,
    winner.archives!.map(compactArchive).sort((a, b) => a.id.localeCompare(b.id)),
  );
});
test("transaction abort after replacement has started rolls back both state and cleared archives", async () => {
  await saveCheckpoint(checkpoint("old", 1, ["old-a", "old-b"]), 0);
  const before = await readRawWorldSnapshot();
  await assert.rejects(
    abortAfterHistoryPut(() => saveCheckpoint(checkpoint("new", 2, ["new-a"]), 1)),
    /状态已变化|中断|失败/,
  );
  assert.deepEqual(await readRawWorldSnapshot(), before);
  assert.equal((await readConsistentSnapshot())!.revision, 1);
});
test("an aborted import replacement preserves the old checkpoint and its complete archive set", async () => {
  await saveCheckpoint(checkpoint("original", 1, ["retained"]), 0);
  const before = await readRawWorldSnapshot();
  const imported = checkpoint("imported", 500, ["imported-a", "imported-b"]);
  await assert.rejects(
    abortAfterHistoryPut(() => writeRecoveredCheckpoint(imported)),
    /中断|Abort/,
  );
  assert.deepEqual(await readRawWorldSnapshot(), before);
  const recovered = await writeRecoveredCheckpoint(imported);
  assert.equal(
    recovered.revision,
    2,
    "incoming backup revision must not overwrite the local writer epoch",
  );
  const saved = (await readConsistentSnapshot())!;
  assert.equal(saved.world!.id, imported.world!.id);
  assert.equal(saved.revision, 2);
  assert.deepEqual(
    saved.archives,
    imported.archives!.map(compactArchive).sort((a, b) => a.id.localeCompare(b.id)),
  );
});
test("raw quarantine preserves corrupt records and structured-clone keys while valid recovery replaces only evidence stores", async () => {
  const badCurrent = { version: 1, revision: "damaged", marker: new Uint8Array([7, 8, 9]) };
  await writeRecord("state", "current", badCurrent);
  const db = await worldDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").put({ broken: true }, ["unusual", 2]);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  await assert.rejects(readConsistentSnapshot(), /快照校验失败/);
  await assert.rejects(readArchives(), /损坏/);
  const raw = await readRawWorldSnapshot();
  assert.deepEqual(raw.current, badCurrent);
  assert.deepEqual(raw.history, [{ key: ["unusual", 2], value: { broken: true } }]);
  await writeRecord("imports", "quarantine-test", { raw, stage: "quarantined" });
  const recovered = await writeRecoveredCheckpoint(
    checkpoint("restored", 55, ["restored-archive"]),
  );
  assert.equal(recovered.revision, 1, "corrupt revision starts a fresh valid writer epoch");
  assert.ok(await readConsistentSnapshot());
  assert.deepEqual(await readRecord("imports", "quarantine-test"), { raw, stage: "quarantined" });
  await restoreRawWorldSnapshot(raw);
  assert.deepEqual(
    await readRawWorldSnapshot(),
    raw,
    "rollback restores structured records without reinterpreting broken evidence",
  );
});
test("rollback itself is atomic and a fresh empty raw snapshot restores the actual absence of state", async () => {
  await saveCheckpoint(checkpoint("baseline", 1, ["baseline-archive"]), 0);
  const before = await readRawWorldSnapshot();
  const target: RawWorldSnapshot = {
    current: { unreadable: true },
    history: [{ key: "replacement", value: { unreadable: true } }],
  };
  await assert.rejects(
    abortAfterHistoryPut(() => restoreRawWorldSnapshot(target)),
    /中断|Abort/,
  );
  assert.deepEqual(await readRawWorldSnapshot(), before);
  await restoreRawWorldSnapshot({ current: undefined, history: [] });
  assert.equal(await readConsistentSnapshot(), undefined);
  assert.deepEqual(await readRawWorldSnapshot(), { current: undefined, history: [] });
});
test("an interrupted consistent read rejects instead of exporting a partial checkpoint", async () => {
  await saveCheckpoint(checkpoint("snapshot", 1, ["history"]), 0);
  const db = await worldDb(),
    transaction = db.transaction.bind(db);
  let injected = false;
  Object.defineProperty(db, "transaction", {
    configurable: true,
    value: (...args: Parameters<IDBDatabase["transaction"]>) => {
      const tx = transaction(...args),
        names = typeof args[0] === "string" ? [args[0]] : [...args[0]];
      if (args[1] === "readonly" && names.includes("state") && names.includes("history")) {
        injected = true;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    },
  });
  try {
    await assert.rejects(readConsistentSnapshot(), /中断|Abort|读取失败/);
    assert.equal(injected, true);
  } finally {
    Object.defineProperty(db, "transaction", { configurable: true, value: transaction });
  }
  assert.equal((await readConsistentSnapshot())!.world!.id, checkpoint("snapshot").world!.id);
});
