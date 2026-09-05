import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  ENGINE_SESSION_SCHEMA_V3,
  EngineSessionError,
  backupLegacyEconomySave,
  commitEngineSession,
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

const data = (revision, gameDate = "1900-01-01") => ({
  gameId: "game-a", engineScenario: "scenario-a", gameDate, round: 1,
  state: { revision, value: revision }, lastTurn: null, ownership: { "A.1": "A" }, monthlyTicks: 0,
});

describe("atomic engine session store", { concurrency: false }, () => {
  it("initializes and follows a verified parent chain", () => {
    const root = gameDir();
    const first = commitEngineSession(root, { expectedRevision: null, ...data("engine:1") });
    const second = commitEngineSession(root, {
      expectedRevision: first.manifest.revision, ...data("engine:2", "1900-02-01"), round: 2, monthlyTicks: 1,
    });
    assert.equal(readEngineSession(root).manifest.revision, second.manifest.revision);
    assert.equal(second.manifest.parentRevision, first.manifest.revision);
  });

  it("rejects stale CAS and corrupted content", () => {
    const root = gameDir();
    const first = commitEngineSession(root, { expectedRevision: null, ...data("engine:1") });
    assert.throws(
      () => commitEngineSession(root, { expectedRevision: "sha256:stale", ...data("engine:2") }),
      (error) => error instanceof EngineSessionError && error.code === "STALE_SESSION",
    );
    const revisionDir = first.manifest.revision.replace(":", "-");
    const statePath = path.join(root, "engine-session", "revisions", revisionDir, "state.json");
    fs.appendFileSync(statePath, "corrupt");
    assert.throws(() => readEngineSession(root), (error) => error.code === "CORRUPT_SESSION");
  });

  it("upgrades a v1 parent to v2 and preserves agent projections on later economy commits", () => {
    const root = gameDir();
    const first = commitEngineSession(root, { expectedRevision: null, ...data("engine:1") });
    const agentState = { schemaVersion: "open-historia-agent-state/1", polities: [] };
    const second = commitEngineSession(root, {
      expectedRevision: first.manifest.revision, ...data("engine:2", "1900-02-01"),
      agentState, agentTurn: { schemaVersion: "open-historia-agent-turn/1", months: [] },
    });
    assert.equal(second.manifest.schema, "open-historia-engine-session/2");
    assert.deepEqual(second.agentState, agentState);
    const third = commitEngineSession(root, {
      expectedRevision: second.manifest.revision, ...data("engine:3", "1900-03-01"),
    });
    assert.equal(third.manifest.schema, "open-historia-engine-session/2");
    assert.deepEqual(third.agentState, agentState);
    assert.equal(third.manifest.parentRevision, second.manifest.revision);
  });

  it("keeps the previous revision readable when every commit stage fails", () => {
    const root = gameDir();
    const first = commitEngineSession(root, { expectedRevision: null, ...data("engine:1") });
    for (const stage of ["beforeFiles", "afterFiles", "afterManifest", "beforeRevisionPublish", "beforePointerPublish", "afterPointerPublish"]) {
      const restore = setEngineSessionTestHooks({ [stage]: () => { throw new Error(stage); } });
      assert.throws(() => commitEngineSession(root, {
        expectedRevision: first.manifest.revision, ...data(`engine:${stage}`, "1900-02-01"), round: 2,
      }), new RegExp(stage));
      restore();
      assert.equal(readEngineSession(root).manifest.revision, first.manifest.revision);
    }
  });

  it("moves a legacy engine save into a deterministic backup folder", () => {
    const root = gameDir();
    fs.mkdirSync(path.join(root, "economy"));
    fs.writeFileSync(path.join(root, "economy", "state.json"), "{}\n");
    const backup = backupLegacyEconomySave(root);
    assert.equal(fs.existsSync(path.join(root, "economy")), false);
    assert.equal(fs.existsSync(path.join(backup, "state.json")), true);
  });
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

  it("refuses WorldStateV2 through the legacy writer and detects state tampering", () => {
    const root = gameDir();
    const compiled = compiledWorld();
    assert.throws(() => commitEngineSession(root, {
      expectedRevision: null, gameId: "living-game", engineScenario: "legacy-name",
      gameDate: compiled.initialState.month, round: 0, state: compiled.initialState,
    }), /WorldStateV2.*living-world writer/i);
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
});
