import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createWorld, quoteTrade, stepWorld, settleWorld } from "./engine.ts";
import { atoms } from "./amount.ts";
import { validateWorld, validateCheckpoint, compactArchive, worldSchema } from "./repository.ts";
import type { World } from "./types.ts";
const make = () =>
  createWorld({
    seed: "repository-fixture",
    mode: "free",
    regime: "rotation",
    duration: 7200,
    spawnPerMinute: 6,
    protection: false,
  });
test("valid world survives JSON and compact archive without changing evidence", () => {
  const w = stepWorld(make(), 90);
  assert.equal(validateWorld(w), true);
  const restored = JSON.parse(JSON.stringify(w));
  assert.equal(validateWorld(restored), true);
  const done = settleWorld(w);
  assert.equal(validateWorld(done), true);
  assert.equal(validateWorld(compactArchive(done)), true);
  assert.equal(
    validateCheckpoint({
      version: 1,
      world: done,
      reports: [done.report],
      speed: 10,
      selectedId: null,
      revision: 1,
      archives: [compactArchive(done)],
    }),
    true,
  );
});

test("mixed checkpoints preserve pre-entry history and positions exactly without upgrading legacy worlds", () => {
  let w = createWorld({
    ...make().config,
    seed: "mixed-repository",
    generationProfile: "mixed-v1",
  });
  const token = w.tokens.find((t) => quoteTrade(w, t.id, "buy", atoms("0.01")).ok)!;
  w = stepWorld(
    applyCommand(w, {
      id: "restore-mixed-holding",
      type: "buy",
      tokenId: token.id,
      amount: atoms("0.01"),
      minOut: "0",
      note: "保存真实持仓与原市场",
    }).world,
    3,
  );
  assert.ok(BigInt(w.positions[token.id].quantity) > 0n);
  assert.equal(validateWorld(w), true);
  const restored = JSON.parse(JSON.stringify(w));
  const before = JSON.stringify(restored);
  assert.equal(validateWorld(restored), true);
  assert.equal(
    JSON.stringify(restored),
    before,
    "validation never regenerates or reprices a stored market",
  );
  assert.equal(JSON.stringify(restored), JSON.stringify(w));
  assert.deepEqual(restored.positions, w.positions);
  assert.deepEqual(restored.tokens, w.tokens);
  assert.ok(
    restored.tokens.some((t: World["tokens"][number]) => t.history.some((h) => h.t < -120)),
  );
  const legacy = make(),
    oldBefore = JSON.stringify(legacy);
  assert.equal(validateWorld(legacy), true);
  assert.equal(JSON.stringify(legacy), oldBefore);
  for (const corrupt of [
    (copy: World) => {
      copy.engineVersion = "world-2.0.0";
    },
    (copy: World) => {
      delete copy.config.generationProfile;
    },
    (copy: World) => {
      copy.config.mode = "practice";
    },
    (copy: World) => {
      copy.config.mode = "exam";
    },
    (copy: World) => {
      (copy.config as { generationProfile: string }).generationProfile = "unknown";
    },
  ]) {
    const copy = structuredClone(w);
    corrupt(copy);
    assert.equal(validateWorld(copy), false);
  }
  const falselyUpgraded = make();
  falselyUpgraded.engineVersion = w.engineVersion;
  assert.equal(validateWorld(falselyUpgraded), false);
});

test("mapping metadata is optional for existing saves but strict when present", () => {
  const w = createWorld({ ...make().config, generationProfile: "mixed-v1" });
  assert.equal(validateWorld(w), true);
  const olderMixed = structuredClone(w);
  for (const token of olderMixed.tokens) delete token.easterEgg;
  const olderJson = JSON.stringify(olderMixed);
  assert.equal(validateWorld(olderMixed), true);
  assert.equal(
    JSON.stringify(olderMixed),
    olderJson,
    "do not insert mapping assets into an existing save",
  );
  for (const corrupt of [
    (copy: World) => {
      (copy.tokens[0] as { easterEgg: string }).easterEgg = "ltc";
    },
    (copy: World) => {
      copy.tokens[4].easterEgg = "btc";
    },
    (copy: World) => {
      copy.tokens[0].symbol = "FAKE";
    },
    (copy: World) => {
      copy.tokens[0].mintAuthority = true;
    },
    (copy: World) => {
      copy.tokens[0].pool.lpLocked = false;
    },
    (copy: World) => {
      copy.tokens[0].latent.intent = "dump";
    },
  ]) {
    const copy = structuredClone(w);
    corrupt(copy);
    assert.equal(validateWorld(copy), false);
  }
  const legacy = make();
  legacy.tokens[0].easterEgg = "btc";
  assert.equal(validateWorld(legacy), false);
});
test("missing or corrupt latent, pool and phase fields are rejected", () => {
  for (const corrupt of [
    (w: World) => {
      delete (w.tokens[0] as Partial<World["tokens"][number]>).latent;
    },
    (w: World) => {
      (w.tokens[0].pool as { kind: string }).kind = "orderbook";
    },
    (w: World) => {
      (w as { phase: string }).phase = "profitable";
    },
    (w: World) => {
      w.tokens[0].latent.incidentAt = Infinity;
    },
    (w: World) => {
      w.tokens[0].pool.quote = "-1";
    },
    (w: World) => {
      w.wallet.solana.native = "abc";
    },
    (w: World) => {
      w.wallet.base.native = "9".repeat(36);
    },
    (w: World) => {
      w.engineVersion = "unsupported-version";
    },
  ]) {
    const w = make();
    corrupt(w);
    assert.equal(validateWorld(w), false);
    assert.equal(worldSchema.safeParse(w).success, false);
  }
});
test("asset references, token supply and platform capability constraints are validated", () => {
  const wrongChain = make();
  wrongChain.tokens[0].chain = "base";
  assert.equal(validateWorld(wrongChain), false);
  const wrongSupply = make();
  wrongSupply.tokens[0].supply = "1";
  assert.equal(validateWorld(wrongSupply), false);
  const fakePermission = make();
  const t = fakePermission.tokens.find((t) => t.pool.lpLocked)!;
  t.mintAuthority = true;
  assert.equal(validateWorld(fakePermission), false);
  const missingToken = make();
  missingToken.participants[0].tokens.missing = "1";
  assert.equal(validateWorld(missingToken), false);
});
test("inconsistent report figures and missing archive evidence cannot pass checkpoint validation", () => {
  const done = settleWorld(make());
  done.report!.pnl += 100;
  assert.equal(validateWorld(done), false);
  const valid = settleWorld(make());
  assert.equal(
    validateCheckpoint({
      version: 1,
      world: null,
      reports: [valid.report],
      speed: 10,
      selectedId: null,
      revision: 1,
      archives: [],
    }),
    false,
  );
  const mismatched = structuredClone(valid.report!);
  mismatched.seed = "other-seed";
  assert.equal(
    validateCheckpoint({
      version: 1,
      world: null,
      reports: [mismatched],
      speed: 10,
      selectedId: null,
      revision: 1,
      archives: [valid],
    }),
    false,
  );
});
test("formal timing and protection cannot be modified through a restored config", () => {
  const w = createWorld({
    seed: "exam-restore",
    mode: "exam",
    regime: "stress",
    duration: 7200,
    spawnPerMinute: 6,
    protection: true,
  });
  assert.equal(validateWorld(w), true);
  w.config.protection = false;
  assert.equal(validateWorld(w), false);
});

test("variant, deadline and continuation metadata survive strict restore", () => {
  const w = createWorld({
    seed: "new-metadata",
    mode: "free",
    regime: "rotation",
    marketVariant: "busy",
    duration: 86400 * 7,
    spawnPerMinute: 6,
    protection: true,
  });
  assert.equal(validateWorld(w), true);
  (w.config as { marketVariant: string }).marketVariant = "magic-profit";
  assert.equal(validateWorld(w), false);
  const done = settleWorld(make()),
    report = structuredClone(done.report!);
  report.discipline.risk = 0;
  assert.equal(
    validateCheckpoint({
      version: 1,
      world: done,
      reports: [report],
      speed: 10,
      selectedId: null,
      revision: 1,
      archives: [done],
    }),
    false,
    "reports must exactly match archived evidence",
  );
});
