import { z } from "zod";

/** Pure helpers for the ledger AI review: validation, parsing and rate limiting. */

export type Analysis = {
  verdict: string;
  data: string[];
  positions: string[];
  next: string[];
};

export const MAX_SUMMARY = 2000;
export const MAX_LINE = 180;
export const MAX_LINES = 120;

export const analysisPayload = z.object({
  summary: z.string().trim().min(1).max(MAX_SUMMARY),
  lines: z.array(z.string().trim().min(1).max(MAX_LINE)).min(1).max(MAX_LINES),
});
export type AnalysisPayload = z.infer<typeof analysisPayload>;

const text = z
  .unknown()
  .transform((v) => (typeof v === "string" ? v.trim().slice(0, 400) : ""));
const list = (max: number) =>
  z
    .unknown()
    .transform((v) => (Array.isArray(v) ? v : []))
    .pipe(z.array(text))
    .transform((items) => items.filter(Boolean).slice(0, max));

const analysisShape = z.object({
  verdict: text,
  data: list(4),
  positions: list(5),
  next: list(3),
});

/** Extract and validate the model's JSON answer; null when it is unusable. */
export function parseAnalysis(raw: string): Analysis | null {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = analysisShape.safeParse(json);
  if (!parsed.success) return null;
  const result = parsed.data;
  if (!result.verdict || result.next.length === 0) return null;
  return result;
}

/**
 * Per-instance budget for a paid upstream: a rolling hourly cap plus a
 * concurrency cap. It is not a global quota (each serverless instance has its
 * own), but it bounds how fast one instance can spend the key.
 */
export function createLimiter(opts: { hourly: number; concurrent: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let windowStart = 0;
  let used = 0;
  let active = 0;
  return {
    /** Returns a release function, or a reason the call was refused. */
    acquire(): { ok: true; release: () => void } | { ok: false; reason: "hourly" | "busy" } {
      const t = now();
      if (t - windowStart > 3_600_000) {
        windowStart = t;
        used = 0;
      }
      if (used >= opts.hourly) return { ok: false, reason: "hourly" };
      if (active >= opts.concurrent) return { ok: false, reason: "busy" };
      used++;
      active++;
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          active--;
        },
      };
    },
  };
}

export function hourlyLimitFromEnv(value: string | undefined, fallback = 10) {
  const n = Number(value);
  return Math.max(1, Math.min(100, Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback));
}
