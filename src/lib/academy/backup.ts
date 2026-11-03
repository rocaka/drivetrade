import { z } from "zod";
import { packBackupBundle, unpackBackupBundle } from "./bundle";
import { assertBackupEvidence } from "./backup-evidence";
import type { AcademyData } from "./store";
import type { RawWorldSnapshot } from "../world/repository";
import { backupSchema, useTrading, type Rule, type Trade } from "../trading/store";
import type { Checkpoint } from "../world/repository";
import type { World } from "../world/types";

export type PreparedBackup = {
  version: number;
  trades: Trade[];
  rules: Rule[];
  principal: number;
  training?: { schemaVersion: 1; world: Checkpoint; academy: unknown };
};
const reportSchema = z
  .object({
    worldId: z.string(),
    seed: z.string(),
    regime: z.enum(["inflow", "rotation", "outflow", "stress"]),
    mode: z.enum(["free", "practice", "exam"]),
    elapsed: z.number().nonnegative(),
    completed: z.boolean(),
    initial: z.number().positive(),
    final: z.number().finite(),
    pnl: z.number().finite(),
    returnPct: z.number().finite(),
    baselineReturnPct: z.number().finite(),
    excessPct: z.number().finite(),
    fees: z.number().nonnegative(),
    trades: z.number().int().nonnegative(),
    violations: z.number().int().nonnegative(),
    maxDrawdownPct: z.number().finite(),
    residual: z.number().nonnegative(),
    discipline: z.object({
      risk: z.number().min(0).max(100),
      execution: z.number().min(0).max(100),
      review: z.number().min(0).max(100),
    }),
    events: z
      .array(
        z
          .object({
            id: z.string(),
            seq: z.number(),
            at: z.number(),
            type: z.string(),
            message: z.string(),
          })
          .passthrough(),
      )
      .max(100000),
  })
  .passthrough();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function prepareBackup(text: string): Promise<PreparedBackup> {
  if (new Blob([text]).size > 200 * 1024 * 1024)
    throw new Error("备份超过本版本单文件200MB恢复上限，请保留原文件；现有数据没有被覆盖");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const raw =
    parsed?.format === "drivetrade-backup-bundle" ? await unpackBackupBundle(parsed) : parsed;
  const legacy = backupSchema.safeParse(raw);
  if (!legacy.success) throw new Error("不是有效的交易纪律账本");
  const version = typeof raw.version === "number" ? raw.version : 1;
  if (version > 3 || version < 1) throw new Error("备份版本不兼容，请保留原文件");
  const prepared: PreparedBackup = {
    version,
    trades: legacy.data.trades,
    rules: legacy.data.rules,
    principal: legacy.data.principal ?? 0,
  };
  if (raw.training !== undefined) {
    if (version !== 3) throw new Error("训练数据必须使用完整备份版本3");
    const block = z
      .object({
        schemaVersion: z.literal(1),
        world: z.object({
          version: z.literal(1),
          world: z.unknown(),
          archives: z.array(z.unknown()).max(1000).optional(),
          reports: z.array(reportSchema).max(1000),
          speed: z.number(),
          selectedId: z.string().nullable(),
          revision: z.number().int().nonnegative(),
        }),
        academy: z.unknown(),
      })
      .parse(raw.training);
    const [{ validateCheckpoint }, { validateAcademy }] = await Promise.all([
      import("../world/repository"),
      import("./store"),
    ]);
    if (!validateCheckpoint(block.world)) throw new Error("世界或历史存档校验失败，未覆盖现有数据");
    const evidenceWorlds = (block.world.archives ?? []) as World[];
    if (
      block.world.reports.some(
        (r) =>
          !evidenceWorlds.some(
            (w) => w.id === r.worldId && w.report && canonical(w.report) === canonical(r),
          ),
      )
    )
      throw new Error("报告缺少一致的历史世界证据，不能恢复为有效考核");
    if (!validateAcademy(block.academy)) throw new Error("课程证据校验失败，未覆盖现有进度");
    assertBackupEvidence(block.world as Checkpoint, block.academy as AcademyData);
    prepared.training = {
      schemaVersion: 1,
      world: block.world as Checkpoint,
      academy: block.academy,
    };
  }
  return prepared;
}
async function modules() {
  return Promise.all([import("../world/store"), import("./store"), import("../world/repository")]);
}
function legacySnapshot() {
  const raw = localStorage.getItem("td-discipline-v1");
  if (raw) {
    const parsed = backupSchema.safeParse(JSON.parse(raw).state);
    if (!parsed.success) throw new Error("原账本无法读取，已停止覆盖");
    return {
      trades: parsed.data.trades,
      rules: parsed.data.rules,
      principal: parsed.data.principal ?? 0,
    };
  }
  const s = useTrading.getState();
  return { trades: s.trades, rules: s.rules, principal: s.principal };
}
async function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("td-full-backup", { mode: "exclusive" }, fn);
  return fn();
}
async function frozen<T>(
  fn: (
    world: Awaited<ReturnType<typeof modules>>[0],
    academy: Awaited<ReturnType<typeof modules>>[1],
    repo: Awaited<ReturnType<typeof modules>>[2],
  ) => Promise<T>,
): Promise<T> {
  return withBackupLock(async () => {
    const [world, academy, repo] = await modules();
    await world.assertWorldWriter();
    try {
      await world.worldMaintenance(true);
      await academy.setAcademyMaintenance(true);
      return await fn(world, academy, repo);
    } catch (error) {
      try {
        if (
          (await repo.readRecord("imports", "pending")) ||
          (await repo.readRecord("imports", "pending-recovery"))
        )
          world.invalidateRecoveredWorld(error);
      } catch {
        world.invalidateRecoveredWorld(error);
      }
      throw error;
    } finally {
      await Promise.allSettled([
        academy.setAcademyMaintenance(false),
        world.worldMaintenance(false),
      ]);
    }
  });
}
export async function completeBackup(): Promise<string> {
  await useTrading.persist.rehydrate();
  return frozen(async (world, academy) =>
    packBackupBundle({
      version: 3,
      exportTime: new Date().toISOString(),
      ...legacySnapshot(),
      training: {
        schemaVersion: 1,
        world: await world.serializeWorld(),
        academy: await academy.serializeAcademy(),
      },
    }),
  );
}
type ImportJournal = {
  prior: { legacy: ReturnType<typeof legacySnapshot>; world: Checkpoint; academy: unknown };
  targetLegacy: ReturnType<typeof legacySnapshot>;
};
function legacyMatches(target: ReturnType<typeof legacySnapshot>) {
  try {
    return canonical(legacySnapshot()) === canonical(target);
  } catch {
    return false;
  }
}
type RecoveryJournal = {
  kind: "quarantined-recovery";
  quarantineKey: string;
  prior: {
    world: RawWorldSnapshot;
    academy: unknown;
    legacyRaw: string | null;
    pending?: ImportJournal;
  };
  targetLegacy: ReturnType<typeof legacySnapshot>;
};
async function applyRecovery(data: PreparedBackup): Promise<void> {
  await withBackupLock(async () => {
    const [world, academy, repo] = await modules();
    await world.assertRecoveryWriter();
    let journal: RecoveryJournal | undefined;
    let journaled = false;
    let completed = false;
    try {
      await world.worldMaintenance(true);
      await academy.setAcademyMaintenance(true);
      const prior = {
        world: await repo.readRawWorldSnapshot(),
        academy: await academy.readRawAcademy(),
        legacyRaw: localStorage.getItem("td-discipline-v1"),
        pending: await repo.readRecord<ImportJournal>("imports", "pending"),
      };
      const targetLegacy = { trades: data.trades, rules: data.rules, principal: data.principal };
      journal = {
        kind: "quarantined-recovery",
        quarantineKey: `recovery-${crypto.randomUUID()}`,
        prior,
        targetLegacy,
      };
      // This durable copy is written before touching either database. It remains
      // after a successful restore so the original damaged records are recoverable.
      await repo.writeRecord("imports", journal.quarantineKey, {
        ...journal,
        at: new Date().toISOString(),
      });
      await repo.writeRecord("imports", "pending-recovery", journal);
      journaled = true;
      await academy.restoreAcademy(data.training!.academy);
      await world.restoreWorldFromRecovery(data.training!.world);
      if (localStorage.getItem("td-discipline-v1") !== prior.legacyRaw)
        throw new Error("另一个标签更新了账本，本次恢复已取消");
      useTrading.getState().replaceAll(targetLegacy);
      await repo.deleteRecord("imports", "pending");
      await repo.deleteRecord("imports", "pending-recovery");
      completed = true;
    } catch (error) {
      if (journal && journaled) {
        try {
          await academy.restoreRawAcademy(journal.prior.academy);
          await repo.restoreRawWorldSnapshot(journal.prior.world);
          if (journal.prior.pending)
            await repo.writeRecord("imports", "pending", journal.prior.pending);
          if (legacyMatches(journal.targetLegacy)) {
            if (journal.prior.legacyRaw === null) localStorage.removeItem("td-discipline-v1");
            else localStorage.setItem("td-discipline-v1", journal.prior.legacyRaw);
            await Promise.resolve(useTrading.persist.rehydrate()).catch(() => undefined);
          }
          await repo.deleteRecord("imports", "pending-recovery");
        } catch {
          throw new Error("恢复中断，原档与恢复任务已经隔离保留，请重新打开应用继续恢复。");
        }
      }
      world.invalidateRecoveredWorld(error);
      throw error;
    } finally {
      if (!completed)
        world.invalidateRecoveredWorld(new Error("恢复未完成，写入已冻结；原档与恢复任务会保留。"));
      await Promise.allSettled([
        academy.setAcademyMaintenance(false),
        world.worldMaintenance(false),
      ]);
    }
  });
}
export async function applyBackup(data: PreparedBackup, includeTraining: boolean): Promise<void> {
  if (!includeTraining || !data.training) {
    await withBackupLock(async () => {
      useTrading
        .getState()
        .replaceAll({ trades: data.trades, rules: data.rules, principal: data.principal });
    });
    return;
  }
  const [worldModule, academyModule] = await modules();
  await worldModule.useWorld.getState().hydrate();
  try {
    await worldModule.serializeWorld();
    await academyModule.serializeAcademy();
  } catch {
    await applyRecovery(data);
    return;
  }
  await frozen(async (world, academy, repo) => {
    const prior = {
      legacy: legacySnapshot(),
      world: await world.serializeWorld(),
      academy: await academy.serializeAcademy(),
    };
    const targetLegacy = { trades: data.trades, rules: data.rules, principal: data.principal };
    const priorLegacy = canonical(prior.legacy);
    let journaled = false;
    try {
      await repo.writeRecord("imports", "pending", { prior, targetLegacy } satisfies ImportJournal);
      journaled = true;
      await academy.restoreAcademy(data.training!.academy);
      await world.restoreWorld(data.training!.world);
      if (canonical(legacySnapshot()) !== priorLegacy)
        throw new Error("另一个标签更新了真实账本，本次恢复已取消；新记录已保留");
      useTrading.getState().replaceAll(targetLegacy);
      await repo.deleteRecord("imports", "pending");
    } catch (e) {
      if (journaled) {
        try {
          // A different tab may have added a real trade while IDB was restoring.
          // Roll back our own legacy write only; never undo that newer real record.
          if (canonical(legacySnapshot()) === canonical(targetLegacy))
            useTrading.getState().replaceAll(prior.legacy);
          await academy.restoreAcademy(prior.academy);
          await world.restoreWorld(prior.world);
          await repo.deleteRecord("imports", "pending");
        } catch {
          throw new Error(
            "恢复中断，已保留恢复任务。请重新打开应用以继续恢复；不要清除浏览器数据。",
          );
        }
      }
      throw e;
    }
  });
}
export async function recoverFullImport(): Promise<void> {
  const [world, academy, repo] = await modules();
  // Re-read both journals after acquiring the backup lock. A different tab may
  // have completed or replaced the recovery while this tab was waiting.
  await withBackupLock(async () => {
    const interrupted = await repo.readRecord<RecoveryJournal>("imports", "pending-recovery");
    const task = await repo.readRecord<ImportJournal>("imports", "pending");
    if (!interrupted && !task) return;
    if (interrupted) await world.assertRecoveryWriter();
    else await world.assertWorldWriter();
    let completed = false;
    try {
      await world.worldMaintenance(true);
      await academy.setAcademyMaintenance(true);
      if (interrupted) {
        await academy.restoreRawAcademy(interrupted.prior.academy);
        await repo.restoreRawWorldSnapshot(interrupted.prior.world);
        if (interrupted.prior.pending)
          await repo.writeRecord("imports", "pending", interrupted.prior.pending);
        if (legacyMatches(interrupted.targetLegacy)) {
          if (interrupted.prior.legacyRaw === null) localStorage.removeItem("td-discipline-v1");
          else localStorage.setItem("td-discipline-v1", interrupted.prior.legacyRaw);
          await Promise.resolve(useTrading.persist.rehydrate()).catch(() => undefined);
        }
        await repo.deleteRecord("imports", "pending-recovery");
        world.invalidateRecoveredWorld(
          new Error("上次恢复未完成，原数据已保留，请重新导入有效完整备份。"),
        );
      } else if (task) {
        if (legacyMatches(task.targetLegacy)) useTrading.getState().replaceAll(task.prior.legacy);
        await academy.restoreAcademy(task.prior.academy);
        await world.restoreWorld(task.prior.world);
        await repo.deleteRecord("imports", "pending");
      }
      completed = true;
    } finally {
      if (interrupted || !completed)
        world.invalidateRecoveredWorld(
          new Error("恢复任务尚需核对，写入已冻结；请保留原档并重新导入有效完整备份。"),
        );
      await Promise.allSettled([
        academy.setAcademyMaintenance(false),
        world.worldMaintenance(false),
      ]);
    }
  });
}
export function downloadJson(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
