import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFocusedDiplomaticMapContext,
  classifyDiplomaticTurn,
  mergeDiplomaticPlan,
  normalizeDiplomaticCountries,
} from "./diplomacyRouting.js";

test("normalizes country objects without turning them into [object Object]", () => {
  assert.deepEqual(normalizeDiplomaticCountries([{ name: "Russia", code: "RUS" }, "Turkey"]), [
    { name: "Russia", code: "RUS" },
    { name: "Turkey", code: "" },
  ]);
});

test("routes greetings low, trade medium and territorial division high", () => {
  assert.equal(classifyDiplomaticTurn({ message: "С Новым годом!", countries: ["Russia"] }).complexity, "low");
  assert.equal(classifyDiplomaticTurn({ message: "Предлагаем расширить торговлю", countries: ["Russia"] }).complexity, "medium");
  assert.equal(classifyDiplomaticTurn({ message: "Предлагаем разделить Турцию", countries: ["Russia"] }).complexity, "high");
});

test("planner can add a canonical third-country target without lowering complexity", () => {
  const route = classifyDiplomaticTurn({ message: "Предлагаем разделить её", countries: ["Russia"] });
  const merged = mergeDiplomaticPlan(route, { complexity: "medium", entities: ["Turkey"] }, ["Russia", "Turkey"]);
  assert.equal(merged.complexity, "high");
  assert.deepEqual(merged.mentionedEntities, ["Turkey"]);
});

test("focused map omits province lists for ordinary chat and adds only requested targets for high", () => {
  const regions = [
    { id: "GEO.1", name: "Tbilisi", country: "Georgia", countryCode: "GEO" },
    { id: "RUS.1", name: "Moscow", country: "Russia", countryCode: "RUS" },
    { id: "TUR.1", name: "Ankara", country: "Turkey", countryCode: "TUR" },
  ];
  const common = { game: { country: "Georgia", gameDate: "2016-01-02" }, regions, participants: ["Russia"], speakingAs: "Russia" };
  const compact = buildFocusedDiplomaticMapContext({ ...common, route: { complexity: "low", mentionedEntities: [] } });
  assert.match(compact, /Russia: 1 mapped regions/);
  assert.doesNotMatch(compact, /Ankara \(TUR\.1\)/);

  const detailed = buildFocusedDiplomaticMapContext({ ...common, route: { complexity: "high", mentionedEntities: ["Turkey"] } });
  assert.match(detailed, /Turkey \[1\]: Ankara \(TUR\.1\)/);
  assert.doesNotMatch(detailed, /Moscow \(RUS\.1\)/);
});
