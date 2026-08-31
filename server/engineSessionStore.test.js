import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  EngineSessionError,
  backupLegacyEconomySave,
  commitEngineSession,
  readEngineSession,
  setEngineSessionTestHooks,
} from "./engineSessionStore.js";

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
