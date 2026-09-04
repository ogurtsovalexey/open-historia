/*! Open Historia — production runtime bridge for the approved Europe 1935 data pack. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PACK_RELATIVE = path.join("packages", "data-packs", "fixtures", "europe-1935-benchmark");
const ENGINE_FIXTURES_RELATIVE = path.join("packages", "engine", "fixtures");

export const EUROPE_1935_SCENARIO_ID = "europe-1935-strategic-ai";
export const EUROPE_1935_ENGINE_SCENARIO = "europe-1935-benchmark";
export const EUROPE_1935_PLAYABLE_COUNTRIES = Object.freeze([
  "Austria",
  "Czechoslovakia",
  "France",
  "Germany",
  "Italy",
  "Poland",
  "United Kingdom",
]);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

export const resolveEngineFixtureDirectory = (engineScenario, rootDirectory = MODULE_ROOT) => {
  const name = String(engineScenario ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid engineScenario '${engineScenario}'`);
  if (name === EUROPE_1935_ENGINE_SCENARIO) {
    return path.join(rootDirectory, DATA_PACK_RELATIVE, "engine");
  }
  return path.join(rootDirectory, ENGINE_FIXTURES_RELATIVE, name);
};

const countryColors = {
  Austria: [210, 84, 84],
  Czechoslovakia: [93, 181, 118],
  France: [70, 112, 198],
  "Freie Stadt Danzig": [226, 184, 72],
  Germany: [92, 96, 103],
  Italy: [76, 160, 91],
  Poland: [211, 92, 139],
  Saargebiet: [202, 163, 71],
  "Soviet Union": [191, 70, 105],
  "United Kingdom": [122, 77, 170],
  "United States": [61, 127, 181],
};

export const buildEurope1935RuntimeScenario = ({ rootDirectory = MODULE_ROOT } = {}) => {
  const packDirectory = path.join(rootDirectory, DATA_PACK_RELATIVE);
  const engine = readJson(path.join(packDirectory, "engine", "scenario.json"));
  const mapLink = readJson(path.join(packDirectory, "engine", "map-link.json"));
  const sourceRegions = readJson(path.join(packDirectory, "geography", "runtime-regions.geojson"));
  const ownerByPolity = mapLink.polityOwnerNames;
  const polityById = new Map(engine.polities.map((polity) => [polity.id, polity]));
  const countryNameOverrides = Object.fromEntries(engine.polities
    .filter((polity) => EUROPE_1935_PLAYABLE_COUNTRIES.includes(ownerByPolity[polity.id]))
    .map((polity) => [ownerByPolity[polity.id], polity.displayName.ru]));
  const regionOwnershipOverrides = {};

  for (const link of mapLink.regions) {
    const engineRegion = engine.regions.find((region) => region.regionId === link.engineRegionId);
    const owner = ownerByPolity[engineRegion?.controllerId];
    if (!owner) throw new Error(`Europe 1935 region '${link.engineRegionId}' has no runtime owner`);
    for (const mapRegionId of link.mapRegionIds ?? []) regionOwnershipOverrides[mapRegionId] = owner;
  }

  const polityOverrides = Object.fromEntries(Object.entries(ownerByPolity).map(([polityId, owner]) => {
    const polity = polityById.get(polityId);
    return [owner, {
      name: owner,
      aliases: [polity?.displayName?.ru].filter(Boolean),
      color: countryColors[owner] ?? [128, 128, 128],
      note: `${polity?.displayName?.ru ?? owner}: исходное положение на 1 января 1935 года; численные эффекты рассчитывает детерминированный движок.`,
    }];
  }));

  const regions = {
    ...sourceRegions,
    features: sourceRegions.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        owner: ownerByPolity[feature.properties.polityId],
      },
    })),
  };

  return {
    meta: {
      id: EUROPE_1935_SCENARIO_ID,
      name: "Europe 1935 — Strategic AI",
      subtitle: "Историческая Европа с детерминированной экономикой и стратегическим ИИ",
      eyebrow: "Production scenario",
      heroTitle: "Европа, 1935",
      heroSubtitle: "Выберите одну из семи держав и проведите её через европейский кризис.",
      description: "Полный сценарий на 1 января 1935 года: экономика, дипломатия, политика, государственное управление, общество, технологии, армия и кампанийные цели.",
      accentColor: "#d35c8b",
      countryNameOverrides,
      engineDriven: true,
      engineScenario: EUROPE_1935_ENGINE_SCENARIO,
      startView: { longitude: 11.5, latitude: 50.5, zoom: 3.7 },
      builtInContentVersion: "1.0.0",
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
      playCount: 0,
    },
    game: {
      country: "Poland",
      startDate: "1935-01-01",
      gameDate: "1935-01-01",
      difficulty: "standard",
      language: "Russian",
      round: 1,
    },
    world: {
      regionOwnershipOverrides,
      polityOverrides,
      customRegions: true,
      customCities: false,
      author: "Open Historia Europe 1935 benchmark",
      mapCredit: "Dated source geometry and provenance are recorded in the Europe 1935 data pack.",
      difficulty: "standard",
      language: "Russian",
      simulationRules: "Europe on 1 January 1935. Authored scenario facts are immutable starting truth. The deterministic engine owns formulas and state transitions; strategic AI may select only published legal actions and may not invent effects.",
      startingTimelineText: "1 января 1935 года. Европейские державы начинают кампанию в условиях растущего дипломатического, экономического и военного напряжения.",
      ownerCodes: Object.values(ownerByPolity),
      playableOwnerCodes: [...EUROPE_1935_PLAYABLE_COUNTRIES],
      allowedUnitTypes: ["infantry", "armor", "air", "naval", "artillery", "garrison"],
      ownerSchema: 2,
      regionClaimants: {},
    },
    colors: Object.fromEntries(Object.values(ownerByPolity).map((owner) => [owner, countryColors[owner]])),
    tags: Object.fromEntries(Object.values(ownerByPolity).map((owner) => [owner, ["europe-1935"]])),
    regions,
  };
};

export const materializeEurope1935RuntimeScenario = ({ scenariosDirectory, rootDirectory = MODULE_ROOT } = {}) => {
  const scenarioDirectory = path.join(scenariosDirectory, EUROPE_1935_SCENARIO_ID);
  const metaPath = path.join(scenarioDirectory, "scenario.json");
  if (fs.existsSync(metaPath)) return { created: false, scenarioId: EUROPE_1935_SCENARIO_ID };

  const runtime = buildEurope1935RuntimeScenario({ rootDirectory });
  fs.mkdirSync(path.join(scenarioDirectory, "storage"), { recursive: true });
  writeJson(metaPath, runtime.meta);
  writeJson(path.join(scenarioDirectory, "game.json"), runtime.game);
  writeJson(path.join(scenarioDirectory, "world.json"), runtime.world);
  writeJson(path.join(scenarioDirectory, "colors.json"), runtime.colors);
  writeJson(path.join(scenarioDirectory, "tags.json"), runtime.tags);
  writeJson(path.join(scenarioDirectory, "prompts.json"), {});
  writeJson(path.join(scenarioDirectory, "storage", "actions.json"), []);
  writeJson(path.join(scenarioDirectory, "storage", "advisor.json"), []);
  writeJson(path.join(scenarioDirectory, "storage", "chat.json"), []);
  writeJson(path.join(scenarioDirectory, "storage", "events.json"), []);
  writeJson(path.join(scenarioDirectory, "regions.geojson"), runtime.regions);
  return { created: true, scenarioId: EUROPE_1935_SCENARIO_ID };
};
