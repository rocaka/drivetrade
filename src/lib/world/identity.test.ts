import test from "node:test";
import assert from "node:assert/strict";
import { deriveIdentity, avatarSeed, IDENTITY_CULTURES } from "./identity.ts";
import { random } from "./random.ts";

test("a long-running market has 1,200 distinct composed names across eight cultures", () => {
  const identities = Array.from({ length: 1200 }, (_, i) =>
    deriveIdentity("identity-diversity-fixture", i),
  );
  assert.equal(new Set(identities.map((token) => token.name)).size, 1200);
  assert.ok(new Set(identities.map((token) => token.symbol)).size >= 1150);
  const counts = new Map<string, number>();
  for (const token of identities) {
    const culture = token.narrative.split(" · ")[0];
    counts.set(culture, (counts.get(culture) ?? 0) + 1);
    assert.match(token.symbol, /^[A-Z]{5,10}$/);
    assert.doesNotMatch(token.name, /\d+$/);
    assert.doesNotMatch(token.narrative, /rug|金狗|土狗|必涨|安全币|高质量/i);
  }
  assert.deepEqual([...counts.keys()].sort(), [...IDENTITY_CULTURES].sort());
  for (const count of counts.values()) assert.ok(count >= 100);
  assert.ok(
    identities.filter((token) => /[\u4e00-\u9fff]/.test(token.name) && /[a-z]/i.test(token.name))
      .length > 400,
  );
  assert.ok(identities.filter((token) => /^[A-Za-z &]+$/.test(token.name)).length > 100);
});

test("at least 300 births stay diverse in different world seeds", () => {
  for (const seed of ["market-alpha", "market-beta", "正式训练-未知场次", "restored-world"]) {
    const tokens = Array.from({ length: 300 }, (_, i) => deriveIdentity(seed, i));
    assert.ok(new Set(tokens.map((token) => token.name)).size >= 296, seed);
    assert.equal(new Set(tokens.map((token) => token.narrative.split(" · ")[0])).size, 8);
  }
});

test("identity is reproducible out of order without consuming the economy or Math.random", () => {
  const first = deriveIdentity("identity-diversity-fixture", 0);
  assert.deepEqual(first, {
    name: "失眠Otter飞船",
    symbol: "SLOTRSH",
    narrative: "动物模因 · 水獭主题的网络文化共创",
  });
  const before = random("separate-streams", "intent", 17);
  const previousRandom = Math.random;
  try {
    Math.random = () => {
      throw new Error("cosmetic identity must be stateless");
    };
    const expected = deriveIdentity("separate-streams", 17);
    for (let i = 399; i >= 0; i--) deriveIdentity("separate-streams", i);
    assert.deepEqual(deriveIdentity("separate-streams", 17), expected);
    assert.equal(random("separate-streams", "intent", 17), before);
  } finally {
    Math.random = previousRandom;
  }
});

test("large birth indexes do not degrade into serial-number tickers", () => {
  const tokens = [1000, 10000, 1000000, Number.MAX_SAFE_INTEGER].map((i) =>
    deriveIdentity("long-market", i),
  );
  assert.equal(new Set(tokens.map((token) => token.name)).size, 4);
  for (const token of tokens) {
    assert.ok(token.name.length >= 5 && token.name.length <= 60);
    assert.match(token.symbol, /^[A-Z]{5,10}$/);
    assert.doesNotMatch(token.name, /\d/);
  }
  for (const invalid of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => deriveIdentity("invalid", invalid), RangeError);
});

test("avatar seed survives JSON snapshot restoration and ignores hidden risk and display names", () => {
  const token = {
    id: "world-t17",
    address: "SIM:base:123abc",
    name: "Old name",
    symbol: "OLD",
    latent: { intent: "honest" },
  };
  const snapshot = JSON.parse(JSON.stringify(token));
  assert.equal(avatarSeed(token), 2255567327);
  assert.equal(avatarSeed(snapshot), avatarSeed(token));
  snapshot.name = "New name";
  snapshot.symbol = "NEW";
  snapshot.latent.intent = "pull";
  assert.equal(avatarSeed(snapshot), avatarSeed(token));
  assert.equal(avatarSeed({ ...token, id: "another-render-or-archive-id" }), avatarSeed(token));
});

test("300 addresses produce distinct avatar fingerprints and all six template buckets", () => {
  const values = Array.from({ length: 300 }, (_, i) =>
    avatarSeed({ id: `t${i}`, address: `SIM:solana:${i.toString(16).padStart(8, "0")}` }),
  );
  assert.equal(new Set(values).size, 300);
  assert.equal(new Set(values.map((seed) => seed % 6)).size, 6);
  assert.equal(new Set(values.map((seed) => (seed >>> 8) % 16)).size, 16);
  for (const value of values)
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff);
});

test("missing addresses have a stable id fallback, while distinct chains keep distinct identities", () => {
  assert.equal(
    avatarSeed({ id: "same-id", address: "" }),
    avatarSeed({ id: "same-id", address: "  " }),
  );
  assert.notEqual(
    avatarSeed({ id: "other-id", address: "" }),
    avatarSeed({ id: "same-id", address: "" }),
  );
  assert.notEqual(
    avatarSeed({ id: "same-id", address: "SIM:base:abcd" }),
    avatarSeed({ id: "same-id", address: "SIM:solana:abcd" }),
  );
});
