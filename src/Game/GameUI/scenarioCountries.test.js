import assert from "node:assert/strict";
import test from "node:test";
import { buildScenarioCountryOptions } from "./scenarioCountries.js";

test("explicit playableOwnerCodes exclude inert and baseline map polities", () => {
  const options = buildScenarioCountryOptions({
    ownerCodes: ["Austria", "Saargebiet", "Soviet Union"],
    playableOwnerCodes: ["Austria"],
    polityOverrides: {
      Austria: { name: "Austria" },
      Saargebiet: { name: "Saargebiet" },
      "Soviet Union": { name: "Soviet Union" },
    },
  }, []);
  assert.deepEqual(options, [{ code: "Austria", name: "Austria" }]);
});

test("legacy scenarios still union territorial owners and landless polities", () => {
  const options = buildScenarioCountryOptions({
    ownerCodes: ["France"],
    polityOverrides: { Exiles: { name: "Government in Exile" } },
  }, []);
  assert.deepEqual(options, [
    { code: "France", name: "France" },
    { code: "Exiles", name: "Government in Exile" },
  ]);
});
