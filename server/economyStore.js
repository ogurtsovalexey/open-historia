/*!
 * Open Historia — bridge between the deterministic economy engine
 * (@open-historia/engine) and the game's stored world state.
 *
 * The engine owns every number and speaks its own branded ids; the game map
 * keys everything by GADM-style region id and owner display name. The engine's
 * map-link fixture is the only translation table (docs/canon/04-economy-slice.md,
 * "Map linkage"), so neither side learns the other's identifiers.
 *
 * State lives under the game directory, so each session advances independently:
 *   <game>/economy/state.json      current engine world state
 *   <game>/economy/turn-NNN/…      per-turn artifacts written by the engine
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOwnershipOverrides,
  checkMapLink,
  initState,
  parseMapLink,
  parseScenario,
  parseWorldState,
  runTurn,
  writeTurnResult,
} from "@open-historia/engine";
import {
  getActiveGameSummary,
  getGameDirectory,
  getGameJsonPath,
} from "./libraryStore.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_FIXTURES_DIR = path.join(REPO_ROOT, "packages", "engine", "fixtures");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const writeJsonAtomic = (filePath, value) => {
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, filePath);
};

/** Engine scenario folder names are scenario-authored; keep them path-safe. */
const resolveEngineFixture = (engineScenario) => {
  const name = String(engineScenario ?? "").trim();
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`invalid engineScenario '${engineScenario}'`);
  }
  const dir = path.join(ENGINE_FIXTURES_DIR, name);
  if (!fs.existsSync(path.join(dir, "scenario.json"))) {
    throw new Error(`engine scenario '${name}' has no scenario.json`);
  }
  return dir;
};

const loadFixture = (engineScenario) => {
  const dir = resolveEngineFixture(engineScenario);
  const scenarioRaw = readJson(path.join(dir, "scenario.json"));
  const scenario = parseScenario(scenarioRaw);
  const linkPath = path.join(dir, "map-link.json");
  const link = fs.existsSync(linkPath) ? parseMapLink(readJson(linkPath)) : null;
  if (link) {
    const mismatches = checkMapLink(scenario, link);
    if (mismatches.length > 0) {
      throw new Error(`map-link does not match scenario: ${JSON.stringify(mismatches)}`);
    }
  }
  return { scenarioRaw, scenario, link };
};

/** The active game, refusing to guess when the scenario is not engine-driven. */
const requireEngineGame = () => {
  const game = getActiveGameSummary();
  if (!game) throw new Error("no active game");
  if (!game.engineDriven) {
    throw new Error(`game '${game.id}' is not engine-driven`);
  }
  return game;
};

const economyDir = (gameId) => path.join(getGameDirectory(gameId), "economy");
const statePath = (gameId) => path.join(economyDir(gameId), "state.json");

const loadOrInitState = (game) => {
  const { scenarioRaw, scenario, link } = loadFixture(game.engineScenario);
  const file = statePath(game.id);
  if (fs.existsSync(file)) {
    return { state: parseWorldState(readJson(file)), scenario, scenarioRaw, link };
  }
  fs.mkdirSync(economyDir(game.id), { recursive: true });
  const state = initState(scenario);
  writeJsonAtomic(file, state);
  return { state, scenario, scenarioRaw, link };
};

/**
 * Push engine ownership into the game's world.json so the existing map layer
 * renders it — the map code stays untouched.
 */
const syncWorldOwnership = (gameId, link, regions) => {
  if (!link) return null;
  const overrides = buildOwnershipOverrides(link, regions);
  const worldPath = getGameJsonPath(gameId, "world");
  const world = fs.existsSync(worldPath) ? readJson(worldPath) : {};
  const merged = { ...world, regionOwnershipOverrides: { ...world.regionOwnershipOverrides, ...overrides } };
  writeJsonAtomic(worldPath, merged);
  return overrides;
};

const snapshot = ({ game, state, scenario, link, lastTurn }) => ({
  gameId: game.id,
  engineScenario: game.engineScenario,
  scenario: { scenarioId: scenario.scenarioId, displayName: scenario.displayName, label: scenario.label },
  turn: state.turn,
  month: state.month,
  revision: state.revision,
  activeResources: state.activeResources,
  economy: state.economy,
  polities: state.polities,
  regions: state.regions,
  mapLink: link
    ? { dataset: link.dataset, polityOwnerNames: link.polityOwnerNames, regions: link.regions }
    : null,
  lastTurn: lastTurn ?? null,
});

const turnPayload = (completed) => ({
  month: completed.result.ledger.month,
  ledger: completed.result.ledger,
  events: completed.result.events,
  rejections: completed.result.rejections,
  report: completed.report,
  invariantsChecked: completed.result.invariantsChecked,
});

export const readEconomyState = () => {
  const game = requireEngineGame();
  const { state, scenario, link } = loadOrInitState(game);
  const lastTurnPath = path.join(economyDir(game.id), "last-turn.json");
  const lastTurn = fs.existsSync(lastTurnPath) ? readJson(lastTurnPath) : null;
  return snapshot({ game, state, scenario, link, lastTurn });
};

/**
 * Resolve `months` monthly ticks. The engine is driven by game time: one tick
 * per 1st of month (canon 04, "How the tick is driven"). Commands apply to the
 * first month only — later months in the same jump resolve with none.
 */
export const runEconomyTurns = ({ months = 1, commands = [] } = {}) => {
  const count = Number(months);
  if (!Number.isInteger(count) || count < 1 || count > 120) {
    throw new Error(`months must be an integer between 1 and 120, got ${months}`);
  }
  const game = requireEngineGame();
  const { state: initial, scenario, link } = loadOrInitState(game);

  let state = initial;
  let last = null;
  const resolved = [];
  for (let index = 0; index < count; index += 1) {
    const turnCommands = index === 0 ? { commands } : { commands: [] };
    const completed = runTurn(state, turnCommands);
    writeTurnResult(economyDir(game.id), {
      turn: completed.result.state.turn,
      month: completed.result.ledger.month,
      baseRevision: completed.baseRevision,
      state: completed.result.state,
      events: completed.result.events,
      ledger: completed.result.ledger,
      report: completed.report,
      commands: turnCommands,
    });
    state = completed.result.state;
    last = completed;
    resolved.push({ turn: state.turn, month: completed.result.ledger.month, revision: state.revision });
  }

  writeJsonAtomic(statePath(game.id), state);
  const lastTurn = turnPayload(last);
  writeJsonAtomic(path.join(economyDir(game.id), "last-turn.json"), lastTurn);
  const ownership = syncWorldOwnership(game.id, link, state.regions);

  return {
    ...snapshot({ game, state, scenario, link, lastTurn }),
    resolved,
    ownershipOverrides: ownership,
  };
};

/** Drop engine state so the session restarts from the scenario. */
export const resetEconomyState = () => {
  const game = requireEngineGame();
  fs.rmSync(economyDir(game.id), { recursive: true, force: true });
  const { state, scenario, link } = loadOrInitState(game);
  syncWorldOwnership(game.id, link, state.regions);
  return snapshot({ game, state, scenario, link, lastTurn: null });
};
