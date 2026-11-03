import test from "node:test";
import assert from "node:assert/strict";
import { appLocationFor, appLocationUrl, readAppLocation } from "./navigation.ts";
test("training views and a specific review survive refresh without changing preview path", () => {
  const url = new URL("https://preview.grokgsac.com/hds-app-8080-demo/?keep=1");
  for (const target of [
    { page: "academy", view: "practice" },
    { page: "academy", view: "exams", reviewSeed: "profit-1-inflow-2" },
    { page: "market", view: "account" },
    { page: "market", view: "review" },
  ] as const) {
    const next = appLocationUrl(url, appLocationFor(target));
    assert.equal(next.pathname, url.pathname);
    assert.equal(next.searchParams.get("keep"), "1");
    assert.deepEqual(readAppLocation(next), appLocationFor(target));
  }
});
test("ledger navigation clears stale training view and unknown links safely default", () => {
  const current = new URL(
    "https://example.test/?screen=academy&view=exams&review=old&platform=ios",
  );
  const home = appLocationUrl(current, appLocationFor("home"));
  assert.equal(home.searchParams.get("screen"), null);
  assert.equal(home.searchParams.get("review"), null);
  assert.equal(home.searchParams.get("platform"), "ios");
  assert.equal(
    readAppLocation(new URL("https://example.test/?screen=unknown&view=invalid")).screen,
    "home",
  );
  assert.deepEqual(
    readAppLocation(new URL("https://example.test/?screen=market&view=invalid")).training,
    { page: "market", view: "market" },
  );
});
