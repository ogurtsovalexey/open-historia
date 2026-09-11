import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ENGINE_SESSION_SCHEMA_V3,
  EngineSessionError,
  backupLegacyEconomySave,
  commitLivingWorldSession,
  readEngineSession,
  setEngineSessionTestHooks,
} from "./engineSessionStore.js";
import { worldV2 } from "@open-historia/engine";
import { canonicalStringify } from "@open-historia/data-packs";
import { minimalScenarioV3 } from "../packages/data-packs/dist-test/test/scenarioV3Fixtures.js";

const roots = [];
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const descriptor = (bytes) => ({ sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) });
const gameDir = () => {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "oh-engine-session-"));
  roots.push(value);
  return value;
};
afterEach(() => {
  setEngineSessionTestHooks({});
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("atomic WorldStateV2 sessions", { concurrency: false }, () => {
  const compiledWorld = () => worldV2.compileScenarioV3(minimalScenarioV3());

  it("stores one canonical world without a writable ownership duplicate", () => {
    const root = gameDir();
    const compiled = compiledWorld();
    const first = commitLivingWorldSession(root, {
      expectedRevision: null,
      gameId: "living-game",
      scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum,
      state: compiled.initialState,
      lastTransition: null,
      strategicState: { schemaVersion: "open-historia-strategic-memory/1", polities: [] },
      agentTurn: null,
      playerIntent: null,
    });
    assert.equal(first.manifest.schema, ENGINE_SESSION_SCHEMA_V3);
    assert.equal(first.manifest.worldRevision, compiled.initialState.revision);
    assert.equal(first.state.revision, compiled.initialState.revision);
    assert.equal(first.ownership, null);
    const directory = path.join(root, "engine-session", "revisions", first.manifest.revision.replace(":", "-"));
    assert.equal(fs.existsSync(path.join(directory, "world-state.json")), true);
    assert.equal(fs.existsSync(path.join(directory, "ownership.json")), false);
    assert.equal(fs.existsSync(path.join(directory, "state.json")), false);
  });

  it("binds scenario, seed and world revision and follows the session CAS chain", () => {
    const root = gameDir();
    const compiled = compiledWorld();
    const first = commitLivingWorldSession(root, {
      expectedRevision: null, gameId: "living-game", scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum, state: compiled.initialState,
    });
    const second = commitLivingWorldSession(root, {
      expectedRevision: first.manifest.revision, gameId: "living-game", scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum, state: compiled.initialState,
      playerIntent: { schemaVersion: "open-historia-player-intent-state/1", status: "pending" },
    });
    assert.equal(second.manifest.parentRevision, first.manifest.revision);
    assert.equal(second.manifest.worldRevision, first.manifest.worldRevision);
    assert.equal(second.playerIntent.status, "pending");
    assert.throws(() => commitLivingWorldSession(root, {
      expectedRevision: first.manifest.revision, gameId: "living-game", scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum, state: compiled.initialState,
    }), (error) => error instanceof EngineSessionError && error.code === "STALE_SESSION");
    assert.throws(() => commitLivingWorldSession(root, {
      expectedRevision: second.manifest.revision, gameId: "living-game", scenarioId: "scenario:other",
      seedChecksum: compiled.seedChecksum, state: compiled.initialState,
    }), /scenario/i);
  });

  it("backs up a pre-V2 economy directory and detects canonical state tampering", () => {
    const root = gameDir();
    const compiled = compiledWorld();
    fs.mkdirSync(path.join(root, "economy"));
    fs.writeFileSync(path.join(root, "economy", "state.json"), "{}\n");
    const backup = backupLegacyEconomySave(root);
    assert.equal(fs.existsSync(path.join(backup, "state.json")), true);
    const committed = commitLivingWorldSession(root, {
      expectedRevision: null, gameId: "living-game", scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum, state: compiled.initialState,
    });
    const directory = path.join(root, "engine-session", "revisions", committed.manifest.revision.replace(":", "-"));
    const statePath = path.join(directory, "world-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.turn += 1;
    fs.writeFileSync(statePath, JSON.stringify(state));
    assert.throws(() => readEngineSession(root), (error) => error instanceof EngineSessionError && error.code === "CORRUPT_SESSION");
  });

  it("reads and rebases only a hash-verified pre-explicit-catalog V2 save", () => {
    const root = gameDir();
    const compiled = compiledWorld();
    const first = commitLivingWorldSession(root, {
      expectedRevision: null, gameId: "living-game", scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum, state: compiled.initialState,
    });
    const firstDirectory = path.join(root, "engine-session", "revisions", first.manifest.revision.replace(":", "-"));
    const legacyState = JSON.parse(fs.readFileSync(path.join(firstDirectory, "world-state.json"), "utf8"));
    for (const region of legacyState.regions) delete region.adjacentRegionIds;
    for (const relationshipType of legacyState.catalogs.relationshipTypes) delete relationshipType.playerProposable;
    const { revision: _revision, ...legacyContent } = legacyState;
    void _revision;
    legacyState.revision = sha256(canonicalStringify(legacyContent));

    const payloads = {
      state: `${JSON.stringify(legacyState)}\n`,
      lastTransition: fs.readFileSync(path.join(firstDirectory, "last-transition.json"), "utf8"),
      strategicState: fs.readFileSync(path.join(firstDirectory, "strategic-state.json"), "utf8"),
      agentTurn: fs.readFileSync(path.join(firstDirectory, "agent-turn.json"), "utf8"),
      playerIntent: fs.readFileSync(path.join(firstDirectory, "player-intent.json"), "utf8"),
    };
    const content = {
      schema: ENGINE_SESSION_SCHEMA_V3, gameId: "living-game", scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum, parentRevision: first.manifest.revision,
      worldRevision: legacyState.revision, gameDate: legacyState.month, turn: legacyState.turn,
      playerDecisionIndex: 0,
      files: Object.fromEntries(Object.entries(payloads).map(([key, bytes]) => [key, descriptor(bytes)])),
    };
    const legacyManifest = { ...content, revision: sha256(canonical(content)) };
    const legacyDirectory = path.join(root, "engine-session", "revisions", legacyManifest.revision.replace(":", "-"));
    fs.mkdirSync(legacyDirectory, { recursive: true });
    const filenames = { state: "world-state.json", lastTransition: "last-transition.json", strategicState: "strategic-state.json", agentTurn: "agent-turn.json", playerIntent: "player-intent.json" };
    for (const [key, filename] of Object.entries(filenames)) fs.writeFileSync(path.join(legacyDirectory, filename), payloads[key]);
    fs.writeFileSync(path.join(legacyDirectory, "manifest.json"), `${canonical(legacyManifest)}\n`);
    fs.writeFileSync(path.join(root, "engine-session", "current.json"), `${canonical({ revision: legacyManifest.revision })}\n`);

    const migrated = readEngineSession(root);
    assert.equal(migrated.manifest.migratedWorldStateV2, true);
    assert.notEqual(migrated.state.revision, legacyState.revision);
    assert.equal(migrated.manifest.worldRevision, migrated.state.revision);
    assert.equal(migrated.state.regions.every((region) => Array.isArray(region.adjacentRegionIds)), true);
    assert.equal(migrated.state.catalogs.relationshipTypes.every((entry) => typeof entry.playerProposable === "boolean"), true);

    const rebased = commitLivingWorldSession(root, {
      expectedRevision: migrated.manifest.revision, gameId: "living-game", scenarioId: compiled.seed.id,
      seedChecksum: compiled.seedChecksum, state: migrated.state,
    });
    assert.equal(rebased.manifest.parentRevision, legacyManifest.revision);
    assert.equal(rebased.manifest.migratedWorldStateV2, undefined);
    assert.equal(rebased.state.revision, migrated.state.revision);
  });

  it("fails closed when a pointer targets a retired session schema", () => {
    const root = gameDir();
    const revision = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const directory = path.join(root, "engine-session", "revisions", revision.replace(":", "-"));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(root, "engine-session", "current.json"), JSON.stringify({ revision }));
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
      schema: "open-historia-engine-session/2",
      revision,
    }));
    assert.throws(() => readEngineSession(root), (error) =>
      error instanceof EngineSessionError && error.code === "LEGACY_SESSION_REQUIRES_MIGRATION");
  });
});
