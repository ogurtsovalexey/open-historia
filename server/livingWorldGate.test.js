import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  EUROPE_1935_BASELINE,
  LIVING_WORLD_CONTRACTS,
  assertContractVersion,
  checkTargetContracts,
  compareReplaySnapshots,
  requireGateFile,
  runBaselineGate,
} from "../scripts/living-world-gate.mjs";
import { canonicalOf, sha256OfString } from "../packages/engine/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("living-world WP0 gate", () => {
  it("pins Europe 1935 fixtures, current contracts, and deterministic replay", async () => {
    const result = await runBaselineGate();

    assert.equal(result.ok, true);
    assert.equal(result.mode, "baseline");
    assert.deepEqual(result.contracts, LIVING_WORLD_CONTRACTS.baseline);
    assert.deepEqual(result.checksums, EUROPE_1935_BASELINE);
    assert.deepEqual(result.replay, { turns: 3, snapshots: 4 });
    assert.equal(result.target.required, false);
  });

  it("detects a deliberately changed integer in a replay snapshot", () => {
    const expected = [{ schemaVersion: "probe/1", turn: 7, stockpile: 100 }];
    const changed = structuredClone(expected);
    changed[0].stockpile += 1;

    const result = compareReplaySnapshots(expected, changed, canonicalOf, sha256OfString);

    assert.equal(result.ok, false);
    assert.equal(result.mismatches.length, 1);
    assert.equal(result.mismatches[0].turn, 0);
    assert.notEqual(result.mismatches[0].expectedChecksum, result.mismatches[0].actualChecksum);
  });

  it("fails closed for a missing fixture or contract version", () => {
    assert.throws(
      () => requireGateFile(path.join(ROOT, "packages/engine/fixtures/does-not-exist/scenario.json")),
      /required fixture or build output is missing/,
    );
    assert.throws(
      () => assertContractVersion(undefined, "open-historia-world/2", "target world"),
      /target world contract changed.*received missing/,
    );
  });

  it("keeps future contract assertions explicit and outside the baseline gate", async () => {
    const baseline = await runBaselineGate();
    const target = checkTargetContracts(path.join(ROOT, "not-a-living-world-tree"));

    assert.equal(target.ok, false);
    assert.ok(target.missing.some((entry) => entry.includes("open-historia-world/2") || entry.includes("world/schema.ts")));
    assert.equal(baseline.target.required, false);
    assert.equal(LIVING_WORLD_CONTRACTS.target.scenario, "open-historia-scenario/3");
  });
});
