import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("Gemini preflight inventories every current tool, four engine schemas and 25 registry tasks offline", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-gemini-preflight-"));
  try {
    const output = path.join(dir, "offline.json");
    execFileSync(process.execPath, ["scripts/gemini-preflight.mjs", "--live", "false", "--output", output], { cwd: path.resolve(".") });
    const result = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(result.status, "offline-pass");
    assert.equal(result.inventory.gameplayToolCount, result.inventory.gameplayTools.length);
    assert.equal(result.inventory.gameplayToolCount, 13);
    assert.equal(result.inventory.engineAgentSchemas.length, 4);
    assert.equal(result.inventory.registry.length, 25);
    assert.equal(result.geometryIncluded, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
