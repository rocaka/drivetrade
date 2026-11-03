import type { Checkpoint } from "../world/repository.ts";
import type { World } from "../world/types.ts";
import type { AcademyData } from "./store.ts";

// JSON property order is irrelevant, but every report field is evidence. In
// particular, fees and discipline must not be replaced by a separately edited
// copy in the learning database. Actual review answers live in reviewAttempts.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * Call after the independent world and academy schema checks, before any write.
 * Lesson/practice-only backups need no market history. Every stored academy
 * market report, including reports in abandoned/older groups, needs the same
 * original report in an archived or current world.
 */
export function assertBackupEvidence(world: Checkpoint, academy: AcademyData): void {
  const evidence = new Map<string, World>();
  for (const candidate of [...(world.archives ?? []), ...(world.world ? [world.world] : [])]) {
    const previous = evidence.get(candidate.id);
    if (
      previous &&
      (canonical(previous.report) !== canonical(candidate.report) ||
        previous.config.seed !== candidate.config.seed ||
        previous.config.mode !== candidate.config.mode ||
        previous.config.regime !== candidate.config.regime ||
        previous.config.generationProfile !== candidate.config.generationProfile ||
        previous.config.assessmentVersion !== candidate.config.assessmentVersion ||
        (previous.config.marketVariant ?? "standard") !==
          (candidate.config.marketVariant ?? "standard"))
    )
      throw new Error("同一世界的当前存档与历史证据不一致，未覆盖现有数据");
    evidence.set(candidate.id, candidate);
  }

  for (const group of academy.profitGroups) {
    for (const slot of group.slots) {
      const report = slot.report;
      if (!report) continue;
      const original = evidence.get(report.worldId);
      if (!original?.report || canonical(report) !== canonical(original.report))
        throw new Error("学院成绩缺少一致的原始世界证据，未覆盖现有进度");

      // Older standard groups did not persist marketVariant. Match them to
      // standard worlds; never let that compatibility substitute a holdout slot.
      const variant = slot.marketVariant ?? "standard";
      if (
        original.phase !== "completed" ||
        original.config.mode !== "exam" ||
        original.config.seed !== slot.seed ||
        original.config.regime !== slot.regime ||
        (original.config.marketVariant ?? "standard") !== variant ||
        report.worldId !== original.id ||
        report.mode !== "exam" ||
        report.seed !== slot.seed ||
        report.regime !== slot.regime ||
        original.config.generationProfile !== slot.generationProfile ||
        original.config.assessmentVersion !== slot.assessmentVersion ||
        report.generationProfile !== slot.generationProfile ||
        report.assessmentVersion !== slot.assessmentVersion ||
        (report.marketVariant ?? "standard") !== variant ||
        (group.configVersion !== "legacy-standard" && report.marketVariant !== slot.marketVariant)
      )
        throw new Error("学院成绩与冻结世界的种子、环境或配置不一致，未覆盖现有进度");
    }
  }
}
