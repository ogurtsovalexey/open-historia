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
scenario.modules.diplomacy = true;
scenario.modules.finance = true;
scenario.modules.intelligence = true;
scenario.modules.politics = true;
scenario.modules.armedForces = true;
scenario.modules.combat = true;
const polityIds = ["polity:austria", "polity:czechia", "polity:france", "polity:germany", "polity:poland", "polity:slovakia"];
const relations = [];
const tradeRoutes = [];
for (let left = 0; left < polityIds.length; left += 1) {
  for (let right = left + 1; right < polityIds.length; right += 1) {
    const pair = [polityIds[left], polityIds[right]];
    const germanPair = pair.includes("polity:germany");
    relations.push({ polities: pair, opinion: germanPair ? -1200 : 500, trust: germanPair ? 3200 : 5000, threat: germanPair ? 5800 : 2200 });
    tradeRoutes.push({ polities: pair, monthlyCapacity: pair.includes("polity:france") ? 180000 : 120000 });
  }
}
scenario.diplomacy = { relations, tradeRoutes };

const politySlugs = polityIds.map((id) => id.slice("polity:".length));
const polityNames = {
  austria: { en: "Austria", ru: "Австрия" }, czechia: { en: "Czechia", ru: "Чехия" },
  france: { en: "France", ru: "Франция" }, germany: { en: "Germany", ru: "Германия" },
  poland: { en: "Poland", ru: "Польша" }, slovakia: { en: "Slovakia", ru: "Словакия" },
};
const politics = { polities: [], factions: [], characters: [] };
for (const slug of politySlugs) {
  const polityId = `polity:${slug}`;
  const names = polityNames[slug] || { en: slug, ru: slug };
  const rulerId = `character:${slug}-ruler`;
  const heirId = `character:${slug}-heir`;
  const laborId = `character:${slug}-labor`;
  const nationalistId = `character:${slug}-nationalist`;
  politics.polities.push({
    polityId, legitimacyBp: 6200, stabilityBp: 6000, unrestBp: 2800,
    successionLaw: "hereditary", rulerCharacterId: rulerId, heirCharacterId: heirId,
  });
  politics.factions.push(
    { factionId: `faction:${slug}-establishment`, polityId, displayName: { en: `${names.en} Establishment`, ru: `${names.ru}: истеблишмент` }, leaderCharacterId: rulerId, powerBp: 4200, supportBp: 6200, idealTaxBurdenBp: 9500, preferredBudgetCategory: "administration", foreignPolicy: "status-quo", ideology: "traditionalist", traditionalismBp: 7500, escalation: "calm" },
    { factionId: `faction:${slug}-labor`, polityId, displayName: { en: `${names.en} Labour`, ru: `${names.ru}: трудящиеся` }, leaderCharacterId: laborId, powerBp: 3000, supportBp: slug === "austria" ? 2800 : 5200, idealTaxBurdenBp: 11500, preferredBudgetCategory: "industry", foreignPolicy: "pacifist", ideology: "socialist", traditionalismBp: 2500, escalation: slug === "austria" ? "demands" : "calm" },
    { factionId: `faction:${slug}-national`, polityId, displayName: { en: `${names.en} National Bloc`, ru: `${names.ru}: национальный блок` }, leaderCharacterId: nationalistId, powerBp: 2800, supportBp: slug === "germany" ? 1800 : 5000, idealTaxBurdenBp: 10500, preferredBudgetCategory: "military", foreignPolicy: "hawk", ideology: "nationalist", traditionalismBp: 6000, escalation: slug === "germany" ? "protest" : "calm" },
  );
  const character = (characterId, en, ru, factionId, office, traits, loyaltyBp, ambitionBp, relations) => ({
    characterId, polityId, displayName: { en, ru }, origin: "authored", factionId, office,
    startingTraits: traits, experienceTraits: [], loyaltyBp, ambitionBp, relations,
  });
  politics.characters.push(
    character(rulerId, `${names.en} Ruler`, `${names.ru}: правитель`, `faction:${slug}-establishment`, "ruler", ["administrator"], 7200, 4200, [{ characterId: heirId, sentiment: "family" }, { characterId: nationalistId, sentiment: "rival" }]),
    character(heirId, `${names.en} Heir`, `${names.ru}: наследник`, `faction:${slug}-establishment`, "heir", ["diplomat"], 6800, 4800, [{ characterId: rulerId, sentiment: "family" }]),
    character(laborId, `${names.en} Labour Leader`, `${names.ru}: лидер трудящихся`, `faction:${slug}-labor`, null, ["populist"], 4600, 6500, [{ characterId: nationalistId, sentiment: "rival" }]),
    character(nationalistId, `${names.en} National Leader`, `${names.ru}: национальный лидер`, `faction:${slug}-national`, null, ["commander", "ambitious"], 3800, 8200, [{ characterId: rulerId, sentiment: "rival" }, { characterId: laborId, sentiment: "rival" }]),
  );
}
scenario.politics = politics;

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
const finance = scenario.polities.map((polity) => ({
  polityId: polity.id,
  taxBurdenBp: 10000,
  exemptionBp: 500,
  priorities: { administration: 2500, science: 1500, industry: 2500, security: 1500, military: 2000 },
  debtPrincipal: 0,
  annualInterestBp: 600,
  creditLimit: polity.treasury * 3,
}));
const capacities = scenario.polities.map((polity) => {
  const count = scenario.regions.filter((region) => region.controllerId === polity.id).length;
  return { polityId: polity.id, administration: Math.max(2, Math.ceil(count / 4)), science: Math.max(1, Math.ceil(count / 8)), industry: Math.max(2, Math.ceil(count / 3)) };
});
const projectTemplates = [{
  templateId: "project-template:infrastructure", displayName: { en: "Regional infrastructure", ru: "Региональная инфраструктура" },
  kind: "construction", budgetCategory: "industry", totalCost: 600, durationMonths: 3,
  capacity: { kind: "industry", amount: 2 }, effect: { kind: "infrastructure", gainBp: 500 },
}, {
  templateId: "project-template:tax-administration", displayName: { en: "Tax administration reform", ru: "Реформа налогового управления" },
  kind: "reform", budgetCategory: "administration", totalCost: 500, durationMonths: 3,
  capacity: { kind: "administration", amount: 2 }, effect: { kind: "credit-limit", amount: 1000 },
}, {
  templateId: "project-template:intelligence-assessment", displayName: { en: "Intelligence assessment", ru: "Разведывательная оценка" },
  kind: "intelligence", budgetCategory: "security", totalCost: 300, durationMonths: 2,
  capacity: { kind: "administration", amount: 1 }, effect: { kind: "reveal-intelligence" },
}];
const factSummaries = {
  austria: ["Austria's public debt administration has limited emergency headroom.", "Управление государственным долгом Австрии имеет ограниченный резерв для чрезвычайных расходов."],
  czechia: ["Czechoslovak border fortifications consume substantial industrial maintenance capacity.", "Чехословацкие пограничные укрепления требуют значительных промышленных мощностей для обслуживания."],
  france: ["The French cabinet is divided over the cost of new eastern guarantees.", "Французский кабинет разделён во мнениях о цене новых восточных гарантий."],
  germany: ["German liquid-fuel reserves are insufficient for a prolonged high-tempo campaign.", "Германских запасов жидкого топлива недостаточно для длительной кампании высокого темпа."],
  poland: ["Poland's east-west rail network has a documented mobilisation bottleneck.", "Польская железнодорожная сеть восток-запад имеет подтверждённое узкое место для мобилизации."],
  slovakia: ["Slovakia's new administration lacks experienced provincial officials.", "Новой администрации Словакии не хватает опытных провинциальных чиновников."],
};
const intelligenceFacts = polityIds.map((polityId) => {
  const slug = polityId.split(":")[1];
  return {
    factId: `intel:${slug}-statecraft-1938`, subjectPolityId: polityId,
    domain: slug === "france" || slug === "slovakia" ? "politics" : slug === "austria" ? "economy" : "war",
    summary: { en: factSummaries[slug][0], ru: factSummaries[slug][1] },
    evidenceId: `evidence:scenario-1938-${slug}-brief`,
  };
});
const knowledgeSeeds = polityIds.map((polityId) => {
  const slug = polityId.split(":")[1];
  return {
    observerPolityId: polityId, factId: `intel:${slug}-statecraft-1938`, confidence: "high",
    evidenceId: `evidence:scenario-1938-${slug}-brief`, staleAfterMonths: 24,
  };
});
scenario.statecraft = { finance, capacities, projectTemplates, intelligenceFacts, knowledgeSeeds };
const forceRegion = {
  austria: "region:gadm:AUT.5_1", czechia: "region:gadm:CZE.1_1", france: "region:gadm:FRA.4_1",
  germany: "region:gadm:DEU.2_1", poland: "region:gadm:POL.1_1", slovakia: "region:gadm:SVK.2_1",
};
const militaryPolities = politySlugs.map((slug) => ({ polityId: `polity:${slug}`, maxMobilizationBp: 800, equipmentReserve: 24000 }));
const commanders = politySlugs.map((slug, index) => ({
  commanderId: `commander:${slug}-chief`, polityId: `polity:${slug}`,
  displayName: { en: `${polityNames[slug].en} Field Commander`, ru: `${polityNames[slug].ru}: полевой командующий` },
  skill: slug === "austria" ? 4 : slug === "germany" ? 2 : 2 + (index % 3),
  traits: slug === "austria" ? ["offensive", "logistician"] : slug === "germany" ? ["defensive", "organizer"] : index % 2 === 0 ? ["defensive", "logistician"] : ["offensive", "organizer"],
}));
const formations = politySlugs.map((slug) => ({
  formationId: `formation:${slug}-first`, polityId: `polity:${slug}`,
  displayName: { en: `${polityNames[slug].en} First Army`, ru: `${polityNames[slug].ru}: первая армия` },
  manpower: 6000, equipment: 6000, homeRegionId: forceRegion[slug], locationRegionId: forceRegion[slug],
  commanderId: `commander:${slug}-chief`, moraleBp: 7600,
}));
const supplyLinks = [];
for (const slug of politySlugs) {
  const ids = scenario.regions.filter((region) => region.controllerId === `polity:${slug}`).map((region) => region.regionId).sort();
  for (let index = 1; index < ids.length; index += 1) supplyLinks.push({ regions: [ids[index - 1], ids[index]], capacity: 12000 });
}
const crossLinks = [
  ["region:gadm:AUT.5_1", "region:gadm:DEU.2_1"],
  ["region:gadm:AUT.3_1", "region:gadm:CZE.1_1"],
  ["region:gadm:CZE.1_1", "region:gadm:DEU.13_1"],
  ["region:gadm:CZE.10_1", "region:gadm:POL.1_1"],
  ["region:gadm:FRA.4_1", "region:gadm:DEU.1_1"],
  ["region:gadm:POL.12_1", "region:gadm:SVK.2_1"],
];
for (const pair of crossLinks) supplyLinks.push({ regions: [...pair].sort(), capacity: 12000 });
scenario.military = { combatSeed: 193801, polities: militaryPolities, commanders, formations,
  supplyLinks: supplyLinks.sort((a, b) => `${a.regions[0]}|${a.regions[1]}`.localeCompare(`${b.regions[0]}|${b.regions[1]}`)) };
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
  description: "Playable development scenario for deterministic economy, diplomacy, statecraft, politics and aggregate war. Economic and military values are synthetic test balance; no historical outcome is predetermined.",
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
world.simulationRules = "Alternate history, 1 January 1938. Austria, Czechia, France, Germany, Poland and Slovakia are independent sovereign states. Slovakia became independent in 1937. There are no active or predetermined wars, annexations, occupations or territorial transfers. The deterministic engine owns every authoritative number and state transition. All authored economic and military values are synthetic development-test balance. Runtime diplomacy, politics, mobilization and war require validated typed commands; AI may propose strategy but never invent outcomes.";
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
