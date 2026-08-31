/*! Open Historia — resumable, non-authoritative P3a agent-turn drafts. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { exportJsonSchema } from "@open-historia/domain";
import { parseTurnCommands, runTurn } from "@open-historia/engine";
import {
  EMPTY_AGENT_STATE,
  agentStateSchema,
  buildDiplomacyBatch,
  buildFallbackBatch,
  buildOpponentBatches,
  buildPolityBrief,
  commandBudgetFor,
  opponentBatchResultSchema,
  playerOrderInterpretationSchema,
  playerReportResultSchema,
  selectOpponentPolities,
  validateOpponentBatch,
  validateDiplomacyBatch,
  opponentDiplomacyBatchResultSchema,
} from "@open-historia/agent-runtime";
import { getGameDirectory, getScenarioAgentProfiles } from "./libraryStore.js";
import { commitAgentEconomy, countMonthlyTicks, loadEconomyContext } from "./economyStore.js";
import { EngineSessionError } from "./engineSessionStore.js";

const DRAFT_FILE = "agent-turn-draft.json";
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const deterministicCommandId = (seed) => {
  const hex = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
};
const withoutModelCommandIds = (value) => {
  if (Array.isArray(value)) return value.map(withoutModelCommandIds);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "commandId")
    .map(([key, entry]) => [key, withoutModelCommandIds(entry)]));
  if (Array.isArray(result.required)) result.required = result.required.filter((key) => key !== "commandId");
  return result;
};
const hydratePlayerCommandIds = (raw, draft) => ({
  ...raw,
  actions: Array.isArray(raw?.actions) ? raw.actions.map((action, index) => ({
    ...action,
    command: action?.command && typeof action.command === "object" ? {
      ...action.command,
      commandId: deterministicCommandId(`${draft.turnToken}|player|${action.actionId}|${index}`),
    } : action?.command,
  })) : raw?.actions,
});
const hydrateOpponentCommandIds = (raw, batch) => ({
  ...raw,
  decisions: Array.isArray(raw?.decisions) ? raw.decisions.map((decision, index) => ({
    ...decision,
    command: decision?.command && typeof decision.command === "object" ? {
      ...decision.command,
      commandId: deterministicCommandId(`${batch.baseRevision}|${batch.month}|${decision.polityId}|${index}`),
    } : decision?.command,
  })) : raw?.decisions,
});
const hydrateStrategicCommandIds = (raw, batch) => ({
  ...raw,
  decisions: Array.isArray(raw?.decisions) ? raw.decisions.map((decision, index) => ({
    ...decision,
    command: decision?.command && typeof decision.command === "object" ? {
      ...decision.command,
      commandId: deterministicCommandId(`${batch.baseRevision}|${batch.month}|strategy|${decision.polityId}|${index}`),
    } : decision?.command,
  })) : raw?.decisions,
});
const diagnosticCode = (value) => String(value ?? "unknown-provider-failure")
  .replace(/[\r\n\t]+/g, " ").trim().slice(0, 500) || "unknown-provider-failure";
const draftPath = (gameId) => path.join(getGameDirectory(gameId), "engine-session", DRAFT_FILE);
const writeDraft = (gameId, draft) => {
  const file = draftPath(gameId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${canonical(draft)}\n`, "utf8");
  fs.renameSync(temp, file);
  return draft;
};
const readDraftFile = (gameId) => {
  const file = draftPath(gameId);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const assertCurrent = (gameId, draft) => {
  const context = loadEconomyContext(gameId);
  if (context.session.manifest.revision !== draft.expectedSessionRevision) {
    throw new EngineSessionError("STALE_SESSION", "the agent-turn draft was superseded by another session revision");
  }
  return context;
};
const publicDraft = (draft) => ({
  turnToken: draft.turnToken,
  phase: draft.phase,
  targetDate: draft.targetDate,
  expectedSessionRevision: draft.expectedSessionRevision,
  monthIndex: draft.monthlyCommands.length,
  monthlyTicks: draft.monthlyTicks,
  confirmation: draft.confirmation ?? null,
  tasks: draft.tasks ?? [],
  turnDigest: draft.phase === "ready" ? sha256(canonical({
    token: draft.turnToken, commands: draft.monthlyCommands, agentState: draft.agentState,
    actionDispositions: draft.interpretedActions, monthTraces: draft.monthTraces, reports: draft.reports,
  })) : null,
});

const interpreterTasks = (draft) => {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const action of draft.actions) {
    const size = action.text.length;
    if (size > 12000) throw new Error(`action ${action.id} exceeds the 12000 character interpreter limit`);
    if (current.length && (current.length >= 16 || chars + size > 12000)) {
      chunks.push(current); current = []; chars = 0;
    }
    current.push(action); chars += size;
  }
  if (current.length) chunks.push(current);
  const toolSchema = withoutModelCommandIds(exportJsonSchema(playerOrderInterpretationSchema));
  return chunks.map((actions, index) => ({
    taskId: "orders.interpret-economy",
    taskVersion: 1,
    taskKey: `interpreter-${index}`,
    systemPrompt: "Route every player action exactly once. Investment orders become typed economy commands. Requests to inspect, summarize, brief or report on the player's economy use disposition report with command null. Unsupported diplomacy, war, transfers and other unavailable mechanics use unsupported. Never invent effects.",
    userPrompt: JSON.stringify({
      polityId: draft.playerPolityId,
      month: draft.state.month,
      revision: draft.state.revision,
      treasury: draft.state.polities.find((entry) => entry.id === draft.playerPolityId)?.treasury,
      controlledRegions: draft.state.regions.filter((entry) => entry.controllerId === draft.playerPolityId).map((entry) => ({
        regionId: entry.regionId, name: entry.displayName, activity: entry.activity, infrastructureBp: entry.infrastructureBp,
      })),
      actions,
    }),
    tool: { name: "submit_player_economy_orders", description: "Submit the strict interpretation", schema: toolSchema },
  }));
};

const makeOpponentTasks = (draft) => {
  const selected = selectOpponentPolities(draft.state, draft.playerPolityId, draft.agentState, draft.lastLedger);
  const batches = buildOpponentBatches(draft.state, selected, (polityId) => buildPolityBrief(draft.state, polityId, {
    difficulty: draft.difficulty,
    lastLedger: draft.lastLedger,
    agentState: draft.agentState,
    scenarioNote: draft.profiles[polityId]?.note,
    tags: draft.profiles[polityId]?.tags,
  }));
  draft.pendingBatches = batches;
  const schema = withoutModelCommandIds(exportJsonSchema(opponentBatchResultSchema));
  draft.tasks = batches.map((batch) => ({
    taskId: "opponents.plan-economy",
    taskVersion: 1,
    taskKey: batch.batchId,
    systemPrompt: `Act independently for every requested polity. Choose at most one listed investment candidate per polity. Do not predict numeric effects. Non-null command budget: ${commandBudgetFor(draft.difficulty, batch.polityIds.length)}.`,
    userPrompt: JSON.stringify({ month: batch.month, revision: batch.baseRevision, briefs: batch.briefs }),
    tool: { name: "submit_opponent_economy_decisions", description: "Submit every requested polity decision", schema },
    context: { fullMapIncluded: false, characterCount: batch.characterCount, polityCount: batch.polityIds.length },
  }));
  draft.phase = batches.length ? "plan-opponents" : "resolve-empty-month";
  return draft;
};

const makeStrategicTasks = (draft) => {
  const batch = buildDiplomacyBatch(draft.state, draft.playerPolityId);
  if (!batch) return makeOpponentTasks(draft);
  draft.pendingStrategicBatch = batch;
  const schema = withoutModelCommandIds(exportJsonSchema(opponentDiplomacyBatchResultSchema));
  draft.tasks = [{
    taskId: draft.state.modules?.finance || draft.state.modules?.projects ? "opponents.plan-statecraft" : "opponents.plan-diplomacy",
    taskVersion: 1,
    taskKey: batch.batchId,
    systemPrompt: "Act independently for every requested polity. Return exactly one decision per polity and at most one material command. Use hold with a null command unless diplomacy, trade, finance or a listed project is justified by the supplied public state. Intelligence may target a polity but must never name a hidden fact id. Commands must use the supplied month and revision. Do not invent actors, resources, routes, templates, regions or effects.",
    userPrompt: JSON.stringify({ month: batch.month, revision: batch.baseRevision, briefs: batch.briefs }),
    tool: { name: "submit_opponent_strategy_decisions", description: "Submit every requested polity strategic decision", schema },
    context: { fullMapIncluded: false, characterCount: batch.characterCount, polityCount: batch.polityIds.length },
  }];
  draft.phase = "plan-strategy";
  return draft;
};

export const resolveStrategicMonth = (draft, outputs) => {
  if (!draft.pendingStrategicBatch) throw new Error("strategic batch is missing");
  if (!Array.isArray(outputs) || outputs.length !== 1) throw new Error("exactly one strategic output is required");
  const batch = draft.pendingStrategicBatch;
  const result = validateDiplomacyBatch(hydrateStrategicCommandIds(outputs[0], batch), batch);
  draft.strategicCommands = result.decisions.flatMap((entry) => entry.command ? [entry.command] : []);
  draft.strategicDecisions = result.decisions;
  draft.pendingStrategicBatch = null;
  draft.tasks = [];
  makeOpponentTasks(draft);
};

const makePlayerReportTask = (draft) => {
  const requests = draft.interpretedActions.filter((entry) => entry.disposition === "report")
    .map((entry) => ({ actionId: entry.actionId, request: draft.actions.find((action) => action.id === entry.actionId)?.text ?? entry.summary }));
  if (!requests.length) {
    draft.reports = [];
    draft.tasks = [];
    draft.phase = "ready";
    return;
  }
  const polity = draft.state.polities.find((entry) => entry.id === draft.playerPolityId);
  const ledger = draft.lastLedger?.polities?.find((entry) => entry.polityId === draft.playerPolityId) ?? null;
  const context = {
    asOfMonth: draft.state.month,
    polity: polity ? { id: polity.id, name: polity.displayName, population: polity.population, treasury: polity.treasury, stockpile: polity.stockpile } : null,
    lastResolvedMonth: ledger ? {
      month: draft.lastLedger.month,
      populationOpening: ledger.populationOpening,
      populationClosing: ledger.populationClosing,
      treasuryOpening: ledger.treasuryOpening,
      treasuryClosing: ledger.treasuryClosing,
      taxTotal: ledger.taxTotal,
      food: ledger.food,
      goods: ledger.goods,
      investment: ledger.investment,
      production: ledger.production.map((entry) => ({ resource: entry.resource, total: entry.total })),
    } : null,
    requests,
  };
  const userPrompt = JSON.stringify(context);
  if (userPrompt.length > 12000) throw new Error("bounded player economy report exceeds 12000 characters");
  draft.tasks = [{
    taskId: "reports.explain-economy",
    taskVersion: 1,
    taskKey: "player-economy-report",
    systemPrompt: `Write a concise government economic report in ${draft.locale === "ru" ? "Russian" : "English"} using only the supplied engine figures. Explain material strengths, shortages and changes. Do not invent facts, totals, causes or recommendations outside the data. Return one report for every request action id.`,
    userPrompt,
    tool: { name: "submit_player_economy_reports", description: "Submit grounded reports for every report request", schema: exportJsonSchema(playerReportResultSchema) },
    context: { fullMapIncluded: false, characterCount: userPrompt.length, polityCount: 1 },
  }];
  draft.phase = "report-player";
};

const resolvePlayerReports = (draft, outputs) => {
  let reports;
  try {
    const parsed = playerReportResultSchema.parse(Array.isArray(outputs) ? outputs[0] : null);
    const expected = draft.interpretedActions.filter((entry) => entry.disposition === "report").map((entry) => entry.actionId).sort();
    const actual = parsed.reports.map((entry) => entry.actionId).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("report task must return every and only requested action id");
    reports = parsed.reports.map((entry) => ({ ...entry, source: "model", failureCode: null }));
  } catch (error) {
    const failureCode = diagnosticCode(error?.message);
    reports = draft.interpretedActions.filter((entry) => entry.disposition === "report").map((entry) => ({
      actionId: entry.actionId,
      title: draft.locale === "ru" ? "Экономический отчёт" : "Economic report",
      body: draft.locale === "ru"
        ? `Детерминированный расчёт экономики выполнен по состоянию на ${draft.targetDate}. Полная ведомость и причины изменений доступны в панели «Экономика».`
        : `The deterministic economy was resolved through ${draft.targetDate}. Open the Economy panel for the complete ledger and causal breakdown.`,
      source: "fallback",
      failureCode,
    }));
  }
  draft.reports = reports;
  draft.tasks = [];
  draft.phase = "ready";
};

const validatePlayerInterpretations = (draft, outputs) => {
  if (!Array.isArray(outputs) || outputs.length !== draft.tasks.length) throw new Error("one interpreter output is required for every task");
  const actions = outputs.flatMap((output) => playerOrderInterpretationSchema.parse(hydratePlayerCommandIds(output, draft)).actions);
  const expected = draft.actions.map((entry) => entry.id).sort();
  const actual = actions.map((entry) => entry.actionId).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("interpreter must return every and only submitted action id");
  const controlled = new Set(draft.state.regions.filter((entry) => entry.controllerId === draft.playerPolityId).map((entry) => entry.regionId));
  const commands = actions.flatMap((entry) => entry.command ? [entry.command] : []);
  if (commands.length + draft.playerCommands.length > 1) throw new Error("P3a permits at most one player investment per monthly tick");
  for (const command of commands) {
    if (command.actorPolityId !== draft.playerPolityId || !controlled.has(command.targetRegionId)) throw new Error("player command actor or target is not controlled");
    if (command.expectedRevision !== draft.state.revision || command.effectiveMonth !== draft.state.month) throw new Error("player command is stale or for the wrong month");
  }
  draft.playerCommands.push(...commands);
  draft.interpretedActions = actions;
  draft.agentState = agentStateSchema.parse({
    ...draft.agentState,
    consumedActionIds: [...new Set([...draft.agentState.consumedActionIds, ...actions.map((entry) => entry.actionId)])].sort(),
  });
  draft.confirmation = actions.map((entry) => ({
    actionId: entry.actionId,
    summary: entry.summary,
    disposition: entry.disposition,
    command: entry.command ? {
      kind: entry.command.kind,
      region: draft.state.regions.find((region) => region.regionId === entry.command.targetRegionId)?.displayName ?? entry.command.targetRegionId,
      spend: entry.command.spend,
    } : null,
  }));
  draft.tasks = [];
  if (commands.length || draft.playerCommands.length) draft.phase = "confirm-player";
  else if (actions.some((entry) => entry.disposition === "report")) {
    draft.targetDate = draft.currentGameDate;
    draft.monthlyTicks = 0;
    draft.readOnly = true;
    makePlayerReportTask(draft);
  } else draft.phase = "no-executable-action";
};

const resolveOpponentMonth = (draft, outcomes) => {
  const byId = new Map((Array.isArray(outcomes) ? outcomes : []).map((entry) => [entry.taskKey, entry]));
  const decisions = [];
  const sources = [];
  const batchOutcomes = [];
  for (const batch of draft.pendingBatches ?? []) {
    const outcome = byId.get(batch.batchId);
    let result;
    let source = "model";
    let failureCode = null;
    try {
      if (!outcome?.output) throw new Error(outcome?.failureCode || "missing-output");
      result = validateOpponentBatch(hydrateOpponentCommandIds(outcome.output, batch), batch, draft.difficulty);
    } catch (error) {
      result = buildFallbackBatch(draft.state, batch);
      source = "fallback";
      failureCode = diagnosticCode(error?.message);
    }
    batchOutcomes.push({ batchId: batch.batchId, source, failureCode });
    decisions.push(...result.decisions);
    for (const decision of result.decisions) sources.push([decision.polityId, source]);
  }
  const commands = [
    ...(draft.monthlyCommands.length === 0 ? draft.playerCommands : []),
    ...(draft.strategicCommands ?? []),
    ...decisions.flatMap((entry) => entry.command ? [entry.command] : []),
  ].sort((left, right) => left.actorPolityId.localeCompare(right.actorPolityId) || left.kind.localeCompare(right.kind));
  const result = runTurn(draft.state, { commands });
  if (result.result.rejections.length) throw new Error(`agent month rejected a prevalidated command: ${result.result.rejections.map((entry) => entry.reason).join(", ")}`);
  const sourceById = new Map(sources);
  const commandByPolity = new Map(commands.map((entry) => [entry.actorPolityId, entry]));
  const selected = new Set(decisions.map((entry) => entry.polityId));
  draft.agentState = agentStateSchema.parse({
    schemaVersion: "open-historia-agent-state/1",
    consumedActionIds: draft.agentState.consumedActionIds,
    polities: [
      ...draft.agentState.polities.filter((entry) => !selected.has(entry.polityId)),
      ...decisions.map((entry) => ({
        polityId: entry.polityId,
        lastDecisionMonth: draft.state.month,
        lastBriefFingerprint: draft.state.revision,
        intent: entry.intent,
        rationale: entry.rationale,
        source: sourceById.get(entry.polityId),
        lastOutcome: commandByPolity.has(entry.polityId) ? "accepted" : "noop",
        triggerFingerprint: `${(result.result.ledger.polities.find((row) => row.polityId === entry.polityId)?.food.shortfall ?? 0) > 0 ? "shortfall" : "fed"}|${(result.result.ledger.polities.find((row) => row.polityId === entry.polityId)?.goods?.limitingInputs ?? []).sort().join(",")}|${(result.result.state.polities.find((row) => row.id === entry.polityId)?.treasury ?? 0) >= 100 ? "afford" : "poor"}`,
      })),
    ].sort((left, right) => left.polityId.localeCompare(right.polityId)),
  });
  draft.monthlyCommands.push(commands);
  draft.monthTraces.push({
    month: draft.state.month,
    baseRevision: draft.state.revision,
    batchOutcomes,
    strategicDecisions: (draft.strategicDecisions ?? []).map((entry) => ({ ...entry, source: "model" })),
    decisions: decisions.map((entry) => ({ ...entry, source: sourceById.get(entry.polityId) })),
  });
  draft.state = result.result.state;
  draft.lastLedger = result.result.ledger;
  draft.pendingBatches = [];
  draft.strategicCommands = [];
  draft.strategicDecisions = [];
  draft.tasks = [];
  if (draft.monthlyCommands.length >= draft.monthlyTicks) makePlayerReportTask(draft);
  else makeStrategicTasks(draft);
};

export const prepareAgentTurn = (gameId, { targetDate, expectedSessionRevision, actions = [], commands = [], locale = "en" } = {}) => {
  const { game, session, playerPolityId } = loadEconomyContext(gameId);
  if (session.manifest.revision !== expectedSessionRevision) throw new EngineSessionError("STALE_SESSION", "stale agent-turn preparation");
  if (!Array.isArray(actions)) throw new Error("actions must be an array");
  const agentState = session.agentState ? agentStateSchema.parse(session.agentState) : structuredClone(EMPTY_AGENT_STATE);
  const consumed = new Set(agentState.consumedActionIds);
  const normalized = actions.map((entry) => ({ id: String(entry?.id ?? "").trim(), text: String(entry?.text ?? "").trim() }))
    .filter((entry) => !consumed.has(entry.id));
  if (normalized.some((entry) => !entry.id || !entry.text)) throw new Error("every action requires id and text");
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) throw new Error("action ids must be unique");
  const directCommands = parseTurnCommands({ commands }).commands;
  if (directCommands.length > 8) throw new Error("a player turn accepts at most eight direct commands");
  const controlled = new Set(session.state.regions.filter((entry) => entry.controllerId === playerPolityId).map((entry) => entry.regionId));
  for (const command of directCommands) {
    if (command.actorPolityId !== playerPolityId) throw new Error("direct player command actor is not the player's polity");
    if (command.kind === "territory.transfer-region") throw new Error("direct territorial transfer is not a player action");
    if (command.kind === "economy.invest-region" && !controlled.has(command.targetRegionId)) throw new Error("direct player command target is not controlled");
    if (command.expectedRevision !== session.state.revision || command.effectiveMonth !== session.state.month) {
      throw new Error("direct player command is stale or for the wrong month");
    }
  }
  const monthlyTicks = countMonthlyTicks(session.manifest.gameDate, targetDate);
  const token = sha256(canonical({ gameId, expectedSessionRevision, targetDate, actions: normalized, commands: directCommands }));
  const profilesByName = getScenarioAgentProfiles(game.scenarioId);
  const profiles = Object.fromEntries(session.state.polities.map((polity) => [polity.id, profilesByName[polity.displayName.en] ?? { note: "", tags: [] }]));
  const draft = {
    schemaVersion: "open-historia-agent-turn-draft/1",
    turnToken: token,
    expectedSessionRevision,
    currentGameDate: session.manifest.gameDate,
    targetDate,
    locale: locale === "ru" ? "ru" : "en",
    monthlyTicks,
    playerPolityId,
    difficulty: game.savedGame?.difficulty ?? "medium",
    actions: normalized,
    playerCommands: directCommands,
    interpretedActions: [],
    state: session.state,
    lastLedger: session.lastTurn?.ledger ?? null,
    agentState,
    profiles,
    monthlyCommands: [],
    monthTraces: [],
    reports: [],
    readOnly: false,
    pendingBatches: [],
    pendingStrategicBatch: null,
    strategicCommands: [],
    strategicDecisions: [],
    tasks: [],
    phase: normalized.length ? "interpret-player" : "confirm-player",
    confirmation: normalized.length ? null : directCommands.map((command) => ({
      actionId: null,
      summary: command.kind === "economy.invest-region"
        ? `Invest ${command.spend} in ${session.state.regions.find((region) => region.regionId === command.targetRegionId)?.displayName.en ?? command.targetRegionId}`
        : command.kind === "diplomacy.propose" ? `Send proposal ${command.proposalId} to ${command.recipientPolityId}`
          : command.kind === "diplomacy.counter" ? `Counter proposal ${command.proposalId}`
            : command.kind === "diplomacy.respond" ? `${command.response} proposal ${command.proposalId}`
              : command.kind === "diplomacy.terminate-agreement" ? `Terminate ${command.agreementId}`
                : command.kind,
      disposition: "command",
      command: command.kind === "economy.invest-region" ? {
        kind: command.kind,
        region: session.state.regions.find((region) => region.regionId === command.targetRegionId)?.displayName ?? command.targetRegionId,
        spend: command.spend,
      } : { kind: command.kind },
    })),
  };
  if (normalized.length) draft.tasks = interpreterTasks(draft);
  writeDraft(gameId, draft);
  return publicDraft(draft);
};

export const stepAgentTurn = (gameId, { turnToken, action, outputs, outcomes } = {}) => {
  const draft = readDraftFile(gameId);
  if (!draft || draft.turnToken !== turnToken) throw new Error("unknown agent-turn draft");
  assertCurrent(gameId, draft);
  if (action === "submit-interpretation" && draft.phase === "interpret-player") validatePlayerInterpretations(draft, outputs);
  else if (action === "confirm-player" && draft.phase === "confirm-player") {
    if (draft.monthlyTicks === 0) makePlayerReportTask(draft);
    else makeStrategicTasks(draft);
  } else if (action === "submit-strategy" && draft.phase === "plan-strategy") {
    resolveStrategicMonth(draft, outputs);
  } else if (action === "submit-opponents" && draft.phase === "plan-opponents") resolveOpponentMonth(draft, outcomes);
  else if (action === "resolve-empty-month" && draft.phase === "resolve-empty-month") resolveOpponentMonth(draft, []);
  else if (action === "submit-reports" && draft.phase === "report-player") resolvePlayerReports(draft, outputs);
  else throw new Error(`action ${action} is invalid during ${draft.phase}`);
  writeDraft(gameId, draft);
  return publicDraft(draft);
};

export const commitPreparedAgentTurn = (gameId, { turnToken, turnDigest } = {}) => {
  const draft = readDraftFile(gameId);
  if (!draft || draft.turnToken !== turnToken || draft.phase !== "ready") throw new Error("agent-turn draft is not ready");
  assertCurrent(gameId, draft);
  const expectedDigest = publicDraft(draft).turnDigest;
  if (turnDigest !== expectedDigest) throw new Error("agent-turn digest mismatch");
  const result = commitAgentEconomy(gameId, {
    targetDate: draft.targetDate,
    expectedSessionRevision: draft.expectedSessionRevision,
    monthlyCommands: draft.monthlyCommands,
    agentState: draft.agentState,
    agentTurn: {
      schemaVersion: "open-historia-agent-turn/1",
      targetDate: draft.targetDate,
      actionDispositions: draft.interpretedActions.map(({ actionId, summary, disposition }) => ({ actionId, summary, disposition })),
      months: draft.monthTraces,
      reports: draft.reports,
    },
    advanceRound: !draft.readOnly,
  });
  fs.rmSync(draftPath(gameId), { force: true });
  return result;
};

export const readAgentTurnDraft = (gameId) => {
  const draft = readDraftFile(gameId);
  if (!draft) return null;
  assertCurrent(gameId, draft);
  return publicDraft(draft);
};

export const cancelAgentTurnDraft = (gameId) => {
  const existed = fs.existsSync(draftPath(gameId));
  fs.rmSync(draftPath(gameId), { force: true });
  return { cancelled: existed };
};
