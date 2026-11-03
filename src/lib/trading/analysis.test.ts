import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisPayload, createLimiter, hourlyLimitFromEnv, parseAnalysis } from "./analysis.ts";

test("parseAnalysis accepts fenced JSON and caps list sizes", () => {
  const raw =
    '```json\n{"verdict":" 太冲动 ","data":["a","b","c","d","e"],"positions":[1,"PEPE 重仓",""],"next":["x","y","z","w"]}\n```';
  const a = parseAnalysis(raw);
  assert.ok(a);
  assert.equal(a.verdict, "太冲动");
  assert.deepEqual(a.data, ["a", "b", "c", "d"]);
  assert.deepEqual(a.positions, ["PEPE 重仓"]);
  assert.deepEqual(a.next, ["x", "y", "z"]);
});

test("parseAnalysis rejects missing verdict, missing next steps and junk", () => {
  assert.equal(parseAnalysis('{"verdict":"","next":["x"]}'), null);
  assert.equal(parseAnalysis('{"verdict":"ok","next":[]}'), null);
  assert.equal(parseAnalysis("not json"), null);
  assert.equal(parseAnalysis("{broken"), null);
  assert.equal(parseAnalysis('{"verdict":"ok","next":"x"}'), null);
});

test("analysisPayload enforces size limits", () => {
  assert.ok(analysisPayload.safeParse({ summary: "s", lines: ["l"] }).success);
  assert.equal(analysisPayload.safeParse({ summary: "", lines: ["l"] }).success, false);
  assert.equal(analysisPayload.safeParse({ summary: "s", lines: [] }).success, false);
  assert.equal(analysisPayload.safeParse({ summary: "s", lines: ["x".repeat(181)] }).success, false);
  assert.equal(
    analysisPayload.safeParse({ summary: "s", lines: Array(121).fill("l") }).success,
    false,
  );
  assert.equal(analysisPayload.safeParse(null).success, false);
});

test("limiter caps hourly use and concurrency, and resets after an hour", () => {
  let t = 1_000_000;
  const lim = createLimiter({ hourly: 3, concurrent: 2, now: () => t });
  const a = lim.acquire();
  const b = lim.acquire();
  assert.ok(a.ok && b.ok);
  assert.deepEqual(lim.acquire(), { ok: false, reason: "busy" });
  if (a.ok) {
    a.release();
    a.release(); // double release must not free a second slot
  }
  const c = lim.acquire();
  assert.ok(c.ok);
  if (c.ok) c.release();
  if (b.ok) b.release();
  assert.deepEqual(lim.acquire(), { ok: false, reason: "hourly" });
  t += 3_600_001;
  assert.ok(lim.acquire().ok);
});

test("hourlyLimitFromEnv clamps to 1..100", () => {
  assert.equal(hourlyLimitFromEnv(undefined), 10);
  assert.equal(hourlyLimitFromEnv("abc"), 10);
  assert.equal(hourlyLimitFromEnv("0"), 10);
  assert.equal(hourlyLimitFromEnv("5"), 5);
  assert.equal(hourlyLimitFromEnv("1000"), 100);
});
