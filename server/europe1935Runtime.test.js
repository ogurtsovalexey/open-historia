import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EUROPE_1935_ENGINE_SCENARIO,
  EUROPE_1935_PLAYABLE_COUNTRIES,
  buildEurope1935RuntimeScenario,
  resolveEngineFixtureDirectory,
} from "./europe1935Runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Europe 1935 production runtime", () => {
  it("routes the approved data pack into the deterministic engine", () => {
    const directory = resolveEngineFixtureDirectory(EUROPE_1935_ENGINE_SCENARIO, ROOT);
    const scenario = JSON.parse(fs.readFileSync(path.join(directory, "scenario.json"), "utf8"));
    const mapLink = JSON.parse(fs.readFileSync(path.join(directory, "map-link.json"), "utf8"));

    assert.equal(scenario.scenarioId, "scenario:europe-1935-benchmark");
    assert.equal(scenario.startMonth, "1935-01-01");
    assert.equal(Object.values(scenario.modules).every(Boolean), true);
    assert.equal(scenario.polities.length, 11);
    assert.equal(scenario.regions.length, 116);
    assert.equal(mapLink.regions.length, 116);
  });

  it("builds a Russian-localized engine-driven scenario with seven playable countries", () => {
    const runtime = buildEurope1935RuntimeScenario({ rootDirectory: ROOT });

    assert.equal(runtime.meta.engineDriven, true);
    assert.equal(runtime.meta.engineScenario, EUROPE_1935_ENGINE_SCENARIO);
    assert.equal(runtime.game.startDate, "1935-01-01");
    assert.equal(runtime.game.language, "Russian");
    assert.deepEqual(runtime.world.playableOwnerCodes, EUROPE_1935_PLAYABLE_COUNTRIES);
    assert.equal(runtime.meta.countryNameOverrides.Poland, "Польша");
    assert.equal(runtime.world.ownerCodes.length, 11);
    assert.equal(runtime.regions.features.length, 110);
    assert.equal(runtime.regions.features.every((feature) => feature.properties.nameRu), true);
    assert.equal(runtime.world.regionOwnershipOverrides["e1935-cs-sudety"], "Czechoslovakia");
    assert.equal(runtime.world.ownerCodes.includes("Saargebiet"), true);
    assert.equal(runtime.world.playableOwnerCodes.includes("Saargebiet"), false);
    assert.equal(runtime.world.playableOwnerCodes.includes("Freie Stadt Danzig"), false);
    assert.equal(runtime.world.playableOwnerCodes.includes("Soviet Union"), false);
    assert.equal(runtime.world.playableOwnerCodes.includes("United States"), false);
  });
});
