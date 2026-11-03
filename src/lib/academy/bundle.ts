import { z } from "zod";

const partSchema = z
  .object({
    id: z.string().regex(/^(main|academy|world-\d{4})$/),
    kind: z.enum(["main", "academy", "world"]),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const bundleSchema = z
  .object({
    format: z.literal("drivetrade-backup-bundle"),
    schemaVersion: z.literal(1),
    manifest: z
      .object({
        backupVersion: z.literal(3),
        createdAt: z.string().max(100),
        parts: z.array(partSchema).min(2).max(1002),
      })
      .strict(),
    chunks: z
      .array(z.object({ id: z.string(), payload: z.unknown() }).strict())
      .min(2)
      .max(1002),
  })
  .strict();
async function describe(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    bytes: bytes.byteLength,
    sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}
/** One portable file contains individually checksummed logical parts. */
export async function packBackupBundle(data: Record<string, unknown>): Promise<string> {
  const training = data.training as {
    schemaVersion: 1;
    world: Record<string, unknown> & { archives?: unknown[] };
    academy: unknown;
  };
  const archives = training.world.archives ?? [];
  const chunks: { id: string; payload: unknown }[] = [
    {
      id: "main",
      payload: {
        ...data,
        training: { ...training, world: { ...training.world, archives: [] }, academy: null },
      },
    },
    { id: "academy", payload: training.academy },
    ...archives.map((payload, i) => ({ id: `world-${String(i).padStart(4, "0")}`, payload })),
  ];
  const parts = await Promise.all(
    chunks.map(async (p) => ({
      id: p.id,
      kind: (p.id === "main" ? "main" : p.id === "academy" ? "academy" : "world") as
        "main" | "academy" | "world",
      ...(await describe(p.payload)),
    })),
  );
  return JSON.stringify({
    format: "drivetrade-backup-bundle",
    schemaVersion: 1,
    manifest: { backupVersion: 3, createdAt: new Date().toISOString(), parts },
    chunks,
  });
}
export async function unpackBackupBundle(raw: unknown): Promise<Record<string, unknown>> {
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) throw new Error("完整备份清单无效，请保留原文件");
  const bundle = parsed.data;
  const ids = bundle.manifest.parts.map((p) => p.id),
    chunkIds = bundle.chunks.map((c) => c.id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(chunkIds).size !== chunkIds.length ||
    ids.length !== chunkIds.length ||
    ids.some((id) => !chunkIds.includes(id)) ||
    !ids.includes("main") ||
    !ids.includes("academy")
  )
    throw new Error("备份分块缺失或重复，未覆盖现有数据");
  const chunks = new Map(bundle.chunks.map((c) => [c.id, c.payload]));
  for (const part of bundle.manifest.parts) {
    const expectedKind = part.id === "main" ? "main" : part.id === "academy" ? "academy" : "world";
    if (part.kind !== expectedKind) throw new Error("备份分块类型不一致");
    const actual = await describe(chunks.get(part.id));
    if (actual.sha256 !== part.sha256 || actual.bytes !== part.bytes)
      throw new Error(`备份分块 ${part.id} 校验失败，未覆盖现有数据`);
  }
  const main = chunks.get("main") as Record<string, unknown>;
  if (
    !main ||
    typeof main !== "object" ||
    Array.isArray(main) ||
    main.version !== 3 ||
    !main.training ||
    typeof main.training !== "object"
  )
    throw new Error("主备份分块无效");
  const training = main.training as Record<string, unknown>;
  if (!training.world || typeof training.world !== "object" || Array.isArray(training.world))
    throw new Error("世界主分块无效");
  const worldParts = bundle.manifest.parts
    .filter((p) => p.kind === "world")
    .sort((a, b) => a.id.localeCompare(b.id));
  if (worldParts.some((p, i) => p.id !== `world-${String(i).padStart(4, "0")}`))
    throw new Error("历史世界分块编号不连续");
  return {
    ...main,
    training: {
      ...training,
      academy: chunks.get("academy"),
      world: { ...training.world, archives: worldParts.map((p) => chunks.get(p.id)) },
    },
  };
}
