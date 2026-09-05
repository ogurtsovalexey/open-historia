import assert from "node:assert/strict";
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
import { minimalScenarioV3 } from "../packages/data-packs/dist-test/test/scenarioV3Fixtures.js";

const roots = [];
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
