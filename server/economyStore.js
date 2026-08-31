/*! Open Historia — game-scoped bridge to the deterministic economy engine. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOwnershipOverrides, checkMapLink, initState, parseMapLink, parseScenario,
  parseTurnCommands, parseWorldState, runTurn,
} from "@open-historia/engine";
import { getGameDetails, getGameDirectory, invalidateLibraryCatalogs } from "./libraryStore.js";
import {
  EngineSessionError, backupLegacyEconomySave, commitEngineSession, readEngineSession,
} from "./engineSessionStore.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_FIXTURES_DIR = path.join(REPO_ROOT, "packages", "engine", "fixtures");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const loadFixture = (engineScenario) => {
  const name = String(engineScenario ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`invalid engineScenario '${engineScenario}'`);
  const dir = path.join(ENGINE_FIXTURES_DIR, name);
  if (!fs.existsSync(path.join(dir, "scenario.json"))) throw new Error(`engine scenario '${name}' has no scenario.json`);
  const scenario = parseScenario(readJson(path.join(dir, "scenario.json")));
  const linkPath = path.join(dir, "map-link.json");
  const link = fs.existsSync(linkPath) ? parseMapLink(readJson(linkPath)) : null;
  if (link) {
    const mismatches = checkMapLink(scenario, link);
    if (mismatches.length) throw new Error(`map-link does not match scenario: ${JSON.stringify(mismatches)}`);
  }
  return { scenario, link };
};

const requireEngineGame = (gameId) => {
  const id = String(gameId ?? "").trim();
  if (!id) throw new Error("gameId is required");
  const details = getGameDetails(id);
  if (!details.game.engineDriven) throw new Error(`game '${id}' is not engine-driven`);
  return { ...details.game, savedGame: details.data.game };
};

const leap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const daysInMonth = (year, month) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

export const parseCalendarDate = (value, field = "date") => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) throw new Error(`${field} must be an ISO calendar date (YYYY-MM-DD)`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`${field} is not a valid Gregorian calendar date`);
  }
  return { text: match[0], year, month, day };
};

/** Count first-of-month boundaries crossed; elapsed days are never rounded. */
export const countMonthlyTicks = (fromDate, targetDate) => {
  const from = parseCalendarDate(fromDate, "current game date");
  const target = parseCalendarDate(targetDate, "targetDate");
  if (target.text < from.text) throw new Error("targetDate cannot move backwards");
  const count = (target.year - from.year) * 12 + target.month - from.month;
  if (count > 120) throw new Error("a time jump cannot cross more than 120 monthly boundaries");
  return count;
};

const turnPayload = (completed) => completed ? ({
  month: completed.result.ledger.month,
  ledger: completed.result.ledger,
  events: completed.result.events,
  rejections: completed.result.rejections,
  report: completed.report,
  invariantsChecked: completed.result.invariantsChecked,
}) : null;

const playerPolityId = (game, link) => {
  const playerName = String(game.savedGame?.country ?? "").trim().toLocaleLowerCase("en-US");
  if (!playerName || !link) throw new Error("the saved player country cannot be mapped to an engine polity");
  const matches = Object.entries(link.polityOwnerNames)
    .filter(([, ownerName]) => String(ownerName).trim().toLocaleLowerCase("en-US") === playerName)
    .map(([polityId]) => polityId);
  if (matches.length !== 1) throw new Error(`the saved player country maps to ${matches.length} engine polities; exactly one is required`);
  return matches[0];
};

const ownershipFor = (link, state) => link ? buildOwnershipOverrides(link, state.regions) : {};

const diplomacyForPlayer = (state, playerId) => {
  if (!state.diplomacy) return null;
  const maySee = (terms) => terms?.fromPolityId === playerId || terms?.toPolityId === playerId;
  return {
    relations: state.diplomacy.relations,
    proposals: state.diplomacy.proposals.map((proposal) => maySee(proposal.terms) ? proposal : {
      proposalId: proposal.proposalId, proposerId: proposal.proposerId, recipientId: proposal.recipientId,
      createdMonth: proposal.createdMonth, parentProposalId: proposal.parentProposalId, terms: null,
    }),
    agreements: state.diplomacy.agreements.map((agreement) => maySee(agreement.terms) ? agreement : {
      agreementId: agreement.agreementId, sourceProposalId: agreement.sourceProposalId,
      acceptedMonth: agreement.acceptedMonth,
      parties: [agreement.terms.fromPolityId, agreement.terms.toPolityId].sort(), terms: null,
    }),
  };
};

const tradeForPlayer = (state, playerId) => state.trade ? ({
  routes: state.trade.routes.filter((route) => route.polities.includes(playerId)),
  contracts: state.trade.contracts.filter((contract) =>
    contract.terms.fromPolityId === playerId || contract.terms.toPolityId === playerId),
}) : null;

const statecraftForPlayer = (state, playerId) => {
  if (!state.finance && !state.projects && !state.intelligence) return null;
  const known = (state.intelligence?.knownFacts ?? []).filter((entry) => entry.observerPolityId === playerId).map((entry) => {
    const truth = state.intelligence.truths.find((fact) => fact.factId === entry.factId);
    return { ...entry, subjectPolityId: truth?.subjectPolityId, domain: truth?.domain, summary: truth?.summary };
  });
  return {
    finance: state.finance?.polities.find((entry) => entry.polityId === playerId) ?? null,
    capacities: state.projects?.capacities.find((entry) => entry.polityId === playerId) ?? null,
    templates: state.projects?.templates ?? [],
    projects: (state.projects?.projects ?? []).filter((entry) => entry.actorPolityId === playerId),
    familiarity: (state.projects?.familiarity ?? []).filter((entry) => entry.polityId === playerId),
    knownFacts: known,
  };
};

const turnForPlayer = (turn, playerId) => {
  if (!turn?.ledger) return turn;
  const involved = (entry) => entry.fromPolityId === playerId || entry.toPolityId === playerId;
  return {
    ...turn,
    ledger: {
      ...turn.ledger,
      ...(turn.ledger.trade ? { trade: {
        executions: turn.ledger.trade.executions.filter(involved),
        resourceTransfers: turn.ledger.trade.resourceTransfers.filter(involved),
        treasuryTransfers: turn.ledger.trade.treasuryTransfers.filter(involved),
      } } : {}),
      ...(turn.ledger.statecraft ? { statecraft: {
        finance: turn.ledger.statecraft.finance.filter((entry) => entry.polityId === playerId),
        projectAllocations: turn.ledger.statecraft.projectAllocations.filter((entry) => entry.polityId === playerId),
      } } : {}),
    },
  };
};

const makeSnapshot = (game, fixture, session, actualMonthlyTicks = session.manifest.monthlyTicks) => {
  const { state, lastTurn, ownership, manifest } = session;
  const playerId = playerPolityId(game, fixture.link);
  return {
    gameId: game.id,
    engineScenario: game.engineScenario,
    scenario: { scenarioId: fixture.scenario.scenarioId, displayName: fixture.scenario.displayName, label: fixture.scenario.label },
    gameDate: manifest.gameDate,
    round: manifest.round,
    sessionRevision: manifest.revision,
    parentSessionRevision: manifest.parentRevision,
    actualMonthlyTicks,
    engineTurn: state.turn,
    turn: state.turn,
    month: state.month,
    revision: state.revision,
    playerPolityId: playerId,
    activeResources: state.activeResources,
    modules: state.modules ?? null,
    economy: state.economy,
    diplomacy: diplomacyForPlayer(state, playerId),
    trade: tradeForPlayer(state, playerId),
    statecraft: statecraftForPlayer(state, playerId),
    polities: state.polities,
    regions: state.regions,
    ownershipOverrides: ownership,
    mapLink: fixture.link ? { dataset: fixture.link.dataset, polityOwnerNames: fixture.link.polityOwnerNames, regions: fixture.link.regions } : null,
    lastTurn: turnForPlayer(lastTurn, playerId),
    agentState: session.agentState ?? null,
    agentTurn: session.agentTurn ?? null,
  };
};

const loadOrInitialize = (game) => {
  const gameDir = getGameDirectory(game.id);
  const fixture = loadFixture(game.engineScenario);
  let session = readEngineSession(gameDir);
  if (!session) {
    backupLegacyEconomySave(gameDir);
    const state = initState(fixture.scenario);
    const gameDate = String(game.savedGame?.gameDate || game.savedGame?.startDate || state.month);
    parseCalendarDate(gameDate, "saved game date");
    session = commitEngineSession(gameDir, {
      expectedRevision: null, gameId: game.id, engineScenario: game.engineScenario, gameDate,
      round: Math.max(1, Math.trunc(Number(game.savedGame?.round) || 1)), state, lastTurn: null,
      ownership: ownershipFor(fixture.link, state), monthlyTicks: 0,
    });
  }
  if (session.manifest.gameId !== game.id || session.manifest.engineScenario !== game.engineScenario) {
    throw new EngineSessionError("CORRUPT_SESSION", "engine session belongs to a different game or scenario");
  }
  session.state = parseWorldState(session.state);
  return { fixture, session };
};

/** Trusted orchestration context. Model-facing code receives projections, never this raw object. */
export const loadEconomyContext = (gameId) => {
  const game = requireEngineGame(gameId);
  const { fixture, session } = loadOrInitialize(game);
  return { game, fixture, session, playerPolityId: playerPolityId(game, fixture.link) };
};

export const commitAgentEconomy = (gameId, {
  targetDate, expectedSessionRevision, monthlyCommands, agentState, agentTurn, advanceRound = true,
}) => {
  const { game, fixture, session } = loadEconomyContext(gameId);
  if (expectedSessionRevision !== session.manifest.revision) {
    throw new EngineSessionError("STALE_SESSION", `stale engine session: expected ${expectedSessionRevision}, current is ${session.manifest.revision}`);
  }
  const monthlyTicks = countMonthlyTicks(session.manifest.gameDate, targetDate);
  if (!Array.isArray(monthlyCommands) || monthlyCommands.length !== monthlyTicks) {
    throw new Error(`agent trace must contain exactly ${monthlyTicks} monthly command sets`);
  }
  let state = session.state;
  let last = null;
  const resolvedMonths = [];
  for (let index = 0; index < monthlyTicks; index += 1) {
    const commands = parseTurnCommands({ commands: monthlyCommands[index] ?? [] }).commands;
    for (const command of commands) {
      if (command.expectedRevision !== state.revision || command.effectiveMonth !== state.month) {
        throw new Error(`agent command ${command.commandId} is not bound to the replayed month revision`);
      }
    }
    last = runTurn(state, { commands });
    if (last.result.rejections.length) {
      throw new Error(`agent trace replay rejected command: ${last.result.rejections.map((entry) => `${entry.reason}: ${entry.detail}`).join("; ")}`);
    }
    resolvedMonths.push(turnPayload(last));
    state = last.result.state;
  }
  const completeAgentTurn = { ...agentTurn, resolvedMonths };
  const committed = commitEngineSession(getGameDirectory(game.id), {
    expectedRevision: expectedSessionRevision,
    gameId: game.id, engineScenario: game.engineScenario,
    gameDate: parseCalendarDate(targetDate, "targetDate").text,
    round: session.manifest.round + (advanceRound ? 1 : 0), state,
    lastTurn: monthlyTicks ? turnPayload(last) : session.lastTurn,
    ownership: ownershipFor(fixture.link, state), monthlyTicks,
    agentState, agentTurn: completeAgentTurn,
  });
  invalidateLibraryCatalogs();
  return makeSnapshot(game, fixture, committed, monthlyTicks);
};

export const readEconomyState = (gameId) => {
  const game = requireEngineGame(gameId);
  const { fixture, session } = loadOrInitialize(game);
  return makeSnapshot(game, fixture, session);
};

const validatePlayerCommands = (commands, state, playerId, monthlyTicks) => {
  const parsed = parseTurnCommands({ commands });
  if (parsed.commands.length && monthlyTicks === 0) throw new Error("commands require crossing at least one monthly boundary");
  const controlled = new Set(state.regions.filter((region) => region.controllerId === playerId).map((region) => region.regionId));
  for (const command of parsed.commands) {
    if (command.actorPolityId !== playerId) throw new Error(`command actor ${command.actorPolityId} is not the player's polity`);
    if (command.kind === "economy.invest-region" && !controlled.has(command.targetRegionId)) {
      throw new Error(`region ${command.targetRegionId} is not controlled by the player's polity`);
    }
  }
  return parsed.commands;
};

export const advanceEconomy = (gameId, { targetDate, expectedSessionRevision, commands = [] } = {}) => {
  const game = requireEngineGame(gameId);
  const { fixture, session } = loadOrInitialize(game);
  if (typeof expectedSessionRevision !== "string" || !expectedSessionRevision) throw new Error("expectedSessionRevision is required");
  if (expectedSessionRevision !== session.manifest.revision) {
    throw new EngineSessionError("STALE_SESSION", `stale engine session: expected ${expectedSessionRevision}, current is ${session.manifest.revision}`);
  }
  const monthlyTicks = countMonthlyTicks(session.manifest.gameDate, targetDate);
  const acceptedCommands = validatePlayerCommands(
    Array.isArray(commands) ? commands : [], session.state, playerPolityId(game, fixture.link), monthlyTicks,
  );
  let state = session.state;
  let last = null;
  for (let index = 0; index < monthlyTicks; index += 1) {
    const tickCommands = index === 0 ? acceptedCommands.map((command) => ({
      ...command, expectedRevision: state.revision, effectiveMonth: state.month,
    })) : [];
    last = runTurn(state, { commands: tickCommands });
    if (last.result.rejections.length) {
      throw new Error(`engine rejected command: ${last.result.rejections.map((entry) => `${entry.reason}: ${entry.detail}`).join("; ")}`);
    }
    state = last.result.state;
  }
  const committed = commitEngineSession(getGameDirectory(game.id), {
    expectedRevision: expectedSessionRevision,
    gameId: game.id, engineScenario: game.engineScenario,
    gameDate: parseCalendarDate(targetDate, "targetDate").text,
    round: session.manifest.round + 1, state,
    lastTurn: monthlyTicks ? turnPayload(last) : session.lastTurn,
    ownership: ownershipFor(fixture.link, state), monthlyTicks,
    ...(session.agentState ? { agentState: session.agentState, agentTurn: session.agentTurn } : {}),
  });
  invalidateLibraryCatalogs();
  return makeSnapshot(game, fixture, committed, monthlyTicks);
};

/** Read-only projection used by runtime readers; legacy games return null. */
export const readEngineRuntimeOverlay = (gameId) => {
  let game;
  try { game = requireEngineGame(gameId); } catch { return null; }
  const { session } = loadOrInitialize(game);
  return {
    game: { gameDate: session.manifest.gameDate, round: session.manifest.round },
    world: { regionOwnershipOverrides: session.ownership },
    sessionRevision: session.manifest.revision,
  };
};
