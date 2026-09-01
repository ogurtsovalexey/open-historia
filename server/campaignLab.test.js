import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";

let temp;
const script = path.resolve("scripts/campaign-lab.mjs");
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], {
  cwd: path.resolve("."), encoding: "utf8", env: { ...process.env, CAMPAIGN_LAB_RUNS_DIR: temp },
}));

before(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-campaign-lab-")); });
after(() => { fs.rmSync(temp, { recursive: true, force: true }); });

test("mock Campaign Lab start/status/resume produces a deterministic final card and chronicle", () => {
  const started = run("start", "--run", "test-mock", "--player", "germany", "--strategy", "historical", "--mode", "mock");
  assert.equal(started.status, "ready");
  assert.equal(run("status", "--run", "test-mock").scenarioChecksum, started.scenarioChecksum);
  const completed = run("resume", "--run", "test-mock");
  assert.equal(completed.status, "completed");
  const card = JSON.parse(fs.readFileSync(path.join(temp, "test-mock", "final-card.json"), "utf8"));
  assert.equal(card.finalMonth, "1940-07-01");
  assert.equal(card.polities.length, 9);
  assert.equal(card.telemetry.engineResolutions, 66);
  assert.ok(fs.statSync(path.join(temp, "test-mock", "chronicle.jsonl")).size > 0);
});
