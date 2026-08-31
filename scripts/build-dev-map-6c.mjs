/*! Build the checked-in six-polity P3b playtest scenario from the release GADM source. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(process.argv[2] || path.join(root, "server/data/scenarios/default/regions.geojson"));
if (!fs.existsSync(sourcePath)) {
  throw new Error(`GADM source not found: ${sourcePath}. Pass default-regions-names.geojson as argv[2].`);
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const copyJson = (from, to) => writeJson(to, readJson(from));

const sourceMap = readJson(sourcePath);
const countryByGid = new Map([["AUT", "Austria"], ["CZE", "Czechia"], ["DEU", "Germany"],
  ["SVK", "Slovakia"], ["FRA", "France"], ["POL", "Poland"]]);
const features = sourceMap.features
  .filter((feature) => countryByGid.has(feature.properties?.gid0))
  .sort((left, right) => left.properties.id.localeCompare(right.properties.id));
const expectedCounts = { AUT: 9, CZE: 14, DEU: 16, FRA: 13, POL: 16, SVK: 8 };
for (const [gid0, expected] of Object.entries(expectedCounts)) {
  const actual = features.filter((feature) => feature.properties.gid0 === gid0).length;
  if (actual !== expected) throw new Error(`${gid0}: expected ${expected} admin-1 regions, found ${actual}`);
}
for (const feature of features) feature.properties.owner = countryByGid.get(feature.properties.gid0);

const baseFixtureDir = path.join(root, "packages/engine/fixtures/scenario-dev-map-4c");
const fixtureDir = path.join(root, "packages/engine/fixtures/scenario-dev-map-6c");
const scenario = readJson(path.join(baseFixtureDir, "scenario.json"));
scenario.scenarioId = "scenario:dev-map-6c";
scenario.displayName = {
  en: "European Crisis, 1938 — Alternate History",
  ru: "Европейский кризис, 1938 — альтернативная история",
};

const stockpile = (food, wood, coal, iron, goods) => [
  { resource: "food", amount: food }, { resource: "wood", amount: wood },
  { resource: "coal", amount: coal }, { resource: "iron", amount: iron },
  { resource: "goods", amount: goods },
];
scenario.polities.push(
  { id: "polity:france", displayName: { en: "France", ru: "Франция" }, treasury: 18000, stockpile: stockpile(420, 210, 90, 80, 55) },
  { id: "polity:poland", displayName: { en: "Poland", ru: "Польша" }, treasury: 10000, stockpile: stockpile(340, 180, 190, 125, 30) },
);

const populations = {
  "FRA.1_1": 3600000, "FRA.10_1": 4100000, "FRA.11_1": 3800000, "FRA.12_1": 2700000,
  "FRA.13_1": 3200000, "FRA.2_1": 2900000, "FRA.3_1": 2600000, "FRA.4_1": 2100000,
  "FRA.5_1": 300000, "FRA.6_1": 4200000, "FRA.7_1": 4000000, "FRA.8_1": 6800000,
  "FRA.9_1": 3100000,
  "POL.1_1": 2400000, "POL.10_1": 1300000, "POL.11_1": 1900000, "POL.12_1": 4300000,
  "POL.13_1": 1200000, "POL.14_1": 1400000, "POL.15_1": 3500000, "POL.16_1": 1700000,
  "POL.2_1": 1900000, "POL.3_1": 2600000, "POL.4_1": 2200000, "POL.5_1": 1000000,
  "POL.6_1": 3300000, "POL.7_1": 4700000, "POL.8_1": 900000, "POL.9_1": 2100000,
};
const activities = {
  "FRA.1_1": "iron", "FRA.10_1": "food", "FRA.11_1": "food", "FRA.12_1": "food",
  "FRA.13_1": "wood", "FRA.2_1": "iron", "FRA.3_1": "food", "FRA.4_1": "food",
  "FRA.5_1": "wood", "FRA.6_1": "coal", "FRA.7_1": "coal", "FRA.8_1": "goods",
  "FRA.9_1": "wood",
  "POL.1_1": "coal", "POL.10_1": "food", "POL.11_1": "wood", "POL.12_1": "coal",
  "POL.13_1": "iron", "POL.14_1": "wood", "POL.15_1": "food", "POL.16_1": "wood",
  "POL.2_1": "iron", "POL.3_1": "iron", "POL.4_1": "food", "POL.5_1": "wood",
  "POL.6_1": "food", "POL.7_1": "goods", "POL.8_1": "coal", "POL.9_1": "food",
};
const newRegions = features.filter((feature) => ["FRA", "POL"].includes(feature.properties.gid0)).map((feature, index) => {
  const id = feature.properties.id;
  const population = populations[id];
  const activity = activities[id];
  if (!population || !activity) throw new Error(`missing authored economy inputs for ${id}`);
  const processing = activity === "goods";
  const infrastructureBp = (feature.properties.gid0 === "FRA" ? 4400 : 3600) + (index % 5) * 250;
  const baseMonthlyCapacity = processing ? 9000 : Math.max(45000, Math.floor(population / 5));
  return {
    regionId: `region:gadm:${id}`,
    controllerId: `polity:${feature.properties.gid0 === "FRA" ? "france" : "poland"}`,
    displayName: { en: feature.properties.name, ru: feature.properties.name },
    activity: processing ? { kind: "processing", activity: "basic_goods" } : { kind: "extraction", resource: activity },
    population,
    annualBirthRateBp: feature.properties.gid0 === "FRA" ? 155 : 240,
    annualDeathRateBp: feature.properties.gid0 === "FRA" ? 145 : 175,
    workforceRateBp: feature.properties.gid0 === "FRA" ? 4300 : 4100,
    infrastructureBp,
    damageBp: 0,
    baseMonthlyCapacity,
    outputPerWorker: processing ? 1 : 2,
    capacityCeiling: baseMonthlyCapacity * 2,
  };
});
scenario.regions.push(...newRegions);
writeJson(path.join(fixtureDir, "scenario.json"), scenario);

const baseLink = readJson(path.join(baseFixtureDir, "map-link.json"));
baseLink.note = "Six European polities on their real GADM admin-1 regions.";
baseLink.polityOwnerNames["polity:france"] = "France";
baseLink.polityOwnerNames["polity:poland"] = "Poland";
baseLink.regions.push(...features.filter((feature) => ["FRA", "POL"].includes(feature.properties.gid0)).map((feature) => ({
  engineRegionId: `region:gadm:${feature.properties.id}`,
  mapRegionId: feature.properties.id,
  mapName: feature.properties.name,
})));
writeJson(path.join(fixtureDir, "map-link.json"), baseLink);

const baseServerDir = path.join(root, "server/data/scenarios/dev-map-4c");
const serverDir = path.join(root, "server/data/scenarios/dev-map-6c");
writeJson(path.join(serverDir, "regions.geojson"), { type: "FeatureCollection", features });
const meta = readJson(path.join(baseServerDir, "scenario.json"));
Object.assign(meta, {
  id: "dev-map-6c",
  name: "European Crisis, 1938 — Alternate History",
  subtitle: "Alternative 1938 playtest — 6 independent polities, 76 regions",
  heroTitle: "European Crisis, 1938",
  heroSubtitle: "Austria, Czechia, France, Germany, Poland and Slovakia enter an open regional crisis.",
  description: "P3b development scenario for deterministic economy, diplomacy and trade. Economic values are synthetic test balance; no historical outcome is predetermined.",
  engineScenario: "scenario-dev-map-6c",
  startView: { longitude: 11.5, latitude: 49.5, zoom: 4.2 },
  playCount: 0,
});
writeJson(path.join(serverDir, "scenario.json"), meta);
copyJson(path.join(baseServerDir, "game.json"), path.join(serverDir, "game.json"));
for (const name of ["actions.json", "advisor.json", "chat.json", "events.json"]) {
  copyJson(path.join(baseServerDir, "storage", name), path.join(serverDir, "storage", name));
}

const world = readJson(path.join(baseServerDir, "world.json"));
world.regionOwnershipOverrides = Object.fromEntries(features.map((feature) => [feature.properties.id, feature.properties.owner]));
world.polityOverrides.France = {
  name: "France", aliases: ["French Republic", "Франция", "Французская Республика"], color: [74, 126, 211],
  note: "EN: France balances collective security, domestic caution and protection of its eastern frontier. RU: Франция балансирует между коллективной безопасностью, внутренней осторожностью и защитой восточной границы.",
};
world.polityOverrides.Poland = {
  name: "Poland", aliases: ["Republic of Poland", "Польша", "Польская Республика"], color: [220, 120, 165],
  note: "EN: Poland protects sovereignty between stronger neighbours and seeks credible guarantees. RU: Польша защищает суверенитет между более сильными соседями и ищет надёжные гарантии.",
};
world.simulationRules = "Alternate history, 1 January 1938. Austria, Czechia, France, Germany, Poland and Slovakia are independent sovereign states. Slovakia became independent in 1937. There are no active or predetermined wars, annexations, occupations or territorial transfers. The deterministic engine owns every authoritative number and state transition. All authored economic values are synthetic development-test balance. Runtime diplomacy and trade require validated typed commands; AI may propose strategy but never invent outcomes.";
world.startingTimelineText = "January 1938. Six European states enter an open alternate-history crisis. Germany seeks regional dominance; Austria, Czechia, France, Poland and Slovakia pursue their own security and economic interests. Every state begins independent and at peace; no historical annexation or war is scripted.";
world.ownerCodes = ["Austria", "Czechia", "France", "Germany", "Poland", "Slovakia"];
writeJson(path.join(serverDir, "world.json"), world);

const colors = readJson(path.join(baseServerDir, "colors.json"));
colors.France = [74, 126, 211];
colors.Poland = [220, 120, 165];
writeJson(path.join(serverDir, "colors.json"), colors);
const tags = readJson(path.join(baseServerDir, "tags.json"));
tags.France = ["independent", "regional-power", "collective-security", "defensive"];
tags.Poland = ["independent", "sovereignty-focused", "guarantee-seeking", "balancing"];
writeJson(path.join(serverDir, "tags.json"), tags);

console.log(`Built ${scenario.polities.length} polities and ${scenario.regions.length} regions into ${path.relative(root, fixtureDir)} and ${path.relative(root, serverDir)}`);
