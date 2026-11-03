import { create } from "zustand";
import {
  readConsistentSnapshot,
  readRecord,
  saveCheckpoint,
  validateCheckpoint,
  type Checkpoint,
} from "./repository.ts";
import type { World, WorldCommand, WorldConfig, WorldReport } from "./types.ts";

type WorkerResult = { world: World | null; ok: boolean; error?: string };
interface WorldStore {
  world: World | null;
  reports: WorldReport[];
  hydrated: boolean;
  busy: boolean;
  advancing: boolean;
  error: string;
  playing: boolean;
  speed: number;
  selectedId: string | null;
  readOnly: boolean;
  maintenance: boolean;
  hydrate: () => Promise<void>;
  create: (config?: Partial<WorldConfig>) => Promise<boolean>;
  dispatch: (cmd: WorldCommand) => Promise<boolean>;
  advance: (seconds: number) => Promise<void>;
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  select: (id: string | null) => void;
  clearError: () => void;
  takeOver: () => Promise<void>;
}
let worker: Worker | null = null;
let counter = 0;
let revision = 0;
let queue = Promise.resolve();
let hydratedPromise: Promise<void> | null = null;
let loadSucceeded = false;
const pending = new Map<
  number,
  { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }
>();
let releaseWriter: (() => void) | undefined;
let channel: BroadcastChannel | null = null;
let ownsWriter = false;
const tabId =
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}`;
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/world.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerResult & { id: number }>) => {
    const p = pending.get(event.data.id);
    if (p) {
      pending.delete(event.data.id);
      p.resolve(event.data);
    }
  };
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new Error("模拟计算中断，状态保留在上次保存点"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}
function request(type: string, data: Record<string, unknown> = {}): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, type, ...data });
  });
}
function relinquish() {
  releaseWriter?.();
  releaseWriter = undefined;
  ownsWriter = false;
}
function failLoad(error: unknown) {
  loadSucceeded = false;
  relinquish();
  useWorld.setState({
    hydrated: true,
    error: error instanceof Error ? error.message : "训练存档暂时不可用",
    playing: false,
    readOnly: true,
  });
}
async function acquireWriter(): Promise<boolean> {
  if (ownsWriter) return true;
  if (typeof navigator === "undefined") return false;
  if (navigator.locks) {
    return new Promise<boolean>((resolve) => {
      void navigator.locks
        .request("td-world-writer", { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          ownsWriter = true;
          resolve(true);
          await new Promise<void>((r) => {
            releaseWriter = r;
          });
          ownsWriter = false;
        })
        .catch(() => resolve(false));
    });
  }
  const prior = localStorage.getItem("td-world-writer-lease");
  if (prior) {
    try {
      const p = JSON.parse(prior) as { id: string; at: number };
      if (p.id !== tabId && Date.now() - p.at < 15000) return false;
    } catch {
      /* expired lease */
    }
  }
  localStorage.setItem("td-world-writer-lease", JSON.stringify({ id: tabId, at: Date.now() }));
  ownsWriter = true;
  releaseWriter = () => {
    const saved = JSON.parse(localStorage.getItem("td-world-writer-lease") ?? "{}") as {
      id?: string;
    };
    if (saved.id === tabId) localStorage.removeItem("td-world-writer-lease");
    ownsWriter = false;
  };
  return true;
}
function checked(value: unknown): Checkpoint | undefined {
  if (value === undefined) return undefined;
  if (!validateCheckpoint(value))
    throw new Error("训练存档校验失败，已停止写入；请保留原数据并恢复有效备份");
  return value;
}
async function loadSaved() {
  const saved = checked(await readRecord<unknown>("state", "current"));
  const result = await request("load", { world: saved?.world ?? null });
  if (!result.ok) throw new Error(result.error ?? "训练存档无法恢复");
  revision = saved?.revision ?? 0;
  loadSucceeded = true;
  useWorld.setState({
    world: saved?.world ?? null,
    reports: saved?.reports ?? [],
    speed: saved?.speed ?? 10,
    selectedId: saved?.selectedId ?? null,
    playing: false,
  });
}
function coordinate() {
  if (typeof BroadcastChannel === "undefined" || channel) return;
  channel = new BroadcastChannel("td-world-coordination");
  channel.onmessage = (event: MessageEvent<{ type: string; tabId: string }>) => {
    if (event.data.tabId === tabId) return;
    if (event.data.type === "takeover" && ownsWriter && !useWorld.getState().maintenance) {
      useWorld.setState({ playing: false, readOnly: true, error: "训练已由另一个标签接管" });
      void queue.then(relinquish);
    }
    if (event.data.type === "saved" && !ownsWriter) {
      void serialized(async () => {
        try {
          await loadSaved();
        } catch (e) {
          failLoad(e);
        }
      });
    }
  };
  window.addEventListener("pagehide", relinquish);
}
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const task = queue.then(fn);
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
async function persist(world: World | null, reports: WorldReport[], archives?: World[]) {
  const state = useWorld.getState();
  await saveCheckpoint(
    {
      version: 1,
      world,
      reports,
      speed: state.speed,
      selectedId: state.selectedId,
      revision: revision + 1,
      ...(archives ? { archives } : {}),
    },
    revision,
  );
  revision++;
  channel?.postMessage({ type: "saved", tabId });
}
async function mutate(type: string, payload: Record<string, unknown>): Promise<boolean> {
  const foreground = type !== "advance";
  const initial = useWorld.getState();
  if (!loadSucceeded || initial.maintenance || initial.readOnly || (foreground && initial.busy))
    return false;
  // Reserve foreground activity synchronously, even when a simulation tick is
  // finishing. Background ticks never make trade forms flash or lose focus.
  if (foreground) useWorld.setState({ busy: true, error: "" });
  return serialized(async () => {
    let previous = useWorld.getState().world;
    try {
      const state = useWorld.getState();
      previous = state.world;
      if (!loadSucceeded || state.maintenance || state.readOnly) return false;
      if (typeof navigator !== "undefined" && !navigator.locks && ownsWriter) {
        try {
          const lease = JSON.parse(localStorage.getItem("td-world-writer-lease") ?? "{}") as {
            id?: string;
          };
          if (lease.id !== tabId) ownsWriter = false;
          else
            localStorage.setItem(
              "td-world-writer-lease",
              JSON.stringify({ id: tabId, at: Date.now() }),
            );
        } catch {
          ownsWriter = false;
        }
      }
      if (!ownsWriter) {
        useWorld.setState({
          error: "另一个标签正在训练，请先接管",
          readOnly: true,
          playing: false,
        });
        return false;
      }
      if (!foreground) useWorld.setState({ advancing: true });
      const result = await request(type, payload);
      if (!result.world) {
        if (result.error) throw new Error(result.error);
        return false;
      }
      const report = result.world.report;
      const reports = report
        ? [...state.reports.filter((r) => r.worldId !== report.worldId), report]
        : state.reports;
      await persist(result.world, reports);
      useWorld.setState({
        world: result.world,
        reports,
        ...(foreground ? { error: result.error ?? "" } : {}),
        playing: result.world.phase === "completed" ? false : useWorld.getState().playing,
      });
      return result.ok;
    } catch (error) {
      await request("load", { world: previous }).catch(() => undefined);
      useWorld.setState({
        playing: false,
        error: error instanceof Error ? error.message : "保存失败，已保留上次状态",
      });
      return false;
    } finally {
      useWorld.setState(foreground ? { busy: false } : { advancing: false });
    }
  });
}
export const useWorld = create<WorldStore>((set, get) => ({
  world: null,
  reports: [],
  hydrated: false,
  busy: false,
  advancing: false,
  error: "",
  playing: false,
  speed: 10,
  selectedId: null,
  readOnly: false,
  maintenance: false,
  hydrate: () => {
    if (hydratedPromise) return hydratedPromise;
    hydratedPromise = (async () => {
      try {
        coordinate();
        const owns = await acquireWriter();
        await loadSaved();
        set({ hydrated: true, readOnly: !owns, playing: false });
      } catch (e) {
        failLoad(e);
      }
    })();
    return hydratedPromise;
  },
  create: async (options = {}) => {
    await get().hydrate();
    if (!loadSucceeded) return false;
    const active = get().world;
    if (active && active.config.mode === "exam" && active.phase !== "completed") {
      set({ error: "正式考核尚未结束，请继续或在考核页登记放弃" });
      return false;
    }
    if (active && active.phase !== "completed") {
      const archived = await mutate("command", {
        command: { id: crypto.randomUUID(), type: "abandon" },
      });
      if (!archived) return false;
    }
    const config: WorldConfig = {
      seed: crypto.randomUUID(),
      mode: "free",
      regime: "rotation",
      spawnPerMinute: 6,
      protection: true,
      duration: 86400,
      ...options,
      runId: crypto.randomUUID(),
    };
    if (config.mode === "free") {
      config.generationProfile ??= "mixed-v1";
      config.assessmentVersion ??= "process-v2-trading";
    }
    if (config.mode === "exam") {
      // Existing frozen assessments keep their original generation profile.
      if (!["process-v1", "process-v2-trading"].includes(config.assessmentVersion ?? ""))
        delete config.generationProfile;
      config.protection = true;
      config.duration = 7200;
      config.spawnPerMinute = 6;
    }
    const done = await mutate("create", { config });
    if (done) set({ selectedId: null, playing: true });
    return done;
  },
  dispatch: async (command) => {
    await get().hydrate();
    return mutate("command", { command });
  },
  advance: async (seconds) => {
    if (
      get().busy ||
      get().advancing ||
      get().maintenance ||
      !get().world ||
      get().world?.phase === "completed"
    )
      return;
    await mutate("advance", { seconds: Math.max(1, Math.min(120, Math.floor(seconds))) });
  },
  setPlaying: (playing) =>
    set({
      playing:
        loadSucceeded &&
        !!get().world &&
        get().world?.phase !== "completed" &&
        !get().readOnly &&
        !get().maintenance &&
        playing,
    }),
  setSpeed: (speed) => set({ speed: [1, 10, 30, 60].includes(speed) ? speed : 10 }),
  select: (selectedId) => set({ selectedId }),
  clearError: () => {
    if (loadSucceeded) set({ error: "" });
  },
  takeOver: async () => {
    channel?.postMessage({ type: "takeover", tabId });
    await new Promise((r) => setTimeout(r, 300));
    if (await acquireWriter()) {
      try {
        await serialized(loadSaved);
        set({ readOnly: false, error: "", playing: false });
      } catch (e) {
        failLoad(e);
      }
    } else set({ error: "接管尚未完成，请关闭其他训练标签后重试" });
  },
}));
export async function assertWorldWriter() {
  await useWorld.getState().hydrate();
  if (!loadSucceeded)
    throw new Error(useWorld.getState().error || "无法读取原训练存档，不能用空数据替代");
  if (!ownsWriter || useWorld.getState().readOnly)
    throw new Error("另一个标签正在训练，请进入随机市场接管后再备份或恢复");
}
export async function serializeWorld(): Promise<Checkpoint> {
  await assertWorldWriter();
  await queue;
  const saved = await readConsistentSnapshot();
  const s = useWorld.getState();
  return saved
    ? { ...saved, speed: s.speed, selectedId: s.selectedId }
    : {
        version: 1,
        world: null,
        reports: [],
        speed: s.speed,
        selectedId: null,
        revision: 0,
        archives: [],
      };
}
export async function restoreWorld(data: Checkpoint): Promise<void> {
  await assertWorldWriter();
  if (!validateCheckpoint(data)) throw new Error("无效世界存档");
  await serialized(async () => {
    await persist(data.world, data.reports, data.archives ?? []);
    await request("load", { world: data.world });
    useWorld.setState({
      world: data.world,
      reports: data.reports,
      selectedId: data.selectedId,
      speed: data.speed,
      playing: false,
      error: "",
    });
  });
}
export async function worldMaintenance(value: boolean) {
  if (value) {
    useWorld.setState({ maintenance: true, playing: false });
    await queue;
  } else useWorld.setState({ maintenance: false });
}

export function worldIsReadable() {
  return loadSucceeded;
}
/** Recovery still requires the exclusive writer, but does not require a readable old save. */
export async function assertRecoveryWriter() {
  await useWorld.getState().hydrate();
  if (!ownsWriter && !(await acquireWriter()))
    throw new Error("另一个标签正在使用训练数据，请先关闭或接管后恢复");
  useWorld.setState({ playing: false, readOnly: false });
  await queue;
}
export async function restoreWorldFromRecovery(data: Checkpoint) {
  if (!ownsWriter || !useWorld.getState().maintenance)
    throw new Error("恢复需要独占写锁与维护冻结");
  if (!validateCheckpoint(data)) throw new Error("恢复世界校验失败");
  const { writeRecoveredCheckpoint } = await import("./repository.ts");
  await serialized(async () => {
    const saved = await writeRecoveredCheckpoint(data);
    const result = await request("load", { world: saved.world });
    if (!result.ok) throw new Error(result.error ?? "恢复计算失败");
    revision = saved.revision;
    loadSucceeded = true;
    useWorld.setState({
      world: saved.world,
      reports: saved.reports,
      selectedId: saved.selectedId,
      speed: saved.speed,
      playing: false,
      readOnly: false,
      error: "",
      hydrated: true,
    });
    channel?.postMessage({ type: "saved", tabId });
  });
}
export function invalidateRecoveredWorld(error: unknown) {
  failLoad(error);
}
