import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compileHistoricalProjection, initState, parseTurnCommands, parseWorldState, runTurn,
} from "../packages/engine/dist/index.js";
import {
  buildStrategicBatchesV2, buildStrategicBriefV2, materializeStrategicBatchV2,
  materializeStrategicDecisionV2, strategicDecisionBatchV2Schema, strategicDecisionV2Schema,
} from "../packages/agent-runtime/dist/index.js";
import {
  AUTONOMY_V2_CELLS, CAMPAIGN_MAX_CALLS, FREE10_CELLS, MAX_OUTPUT_TOKENS, PACIFIC_DAILY_CALL_LIMIT, PACING_RPM, PACING_TPM,
  decisionTriggerReasons, isRetryableGeminiFailure, pacificQuotaDay, reduceChronicleAlerts,
} from "./lib/campaign-lab-policy.mjs";
import { CAMPAIGN_DECISION_RESPONSE_SCHEMA, CAMPAIGN_DECISION_TOOLS, normalizeCampaignDecisionWire } from "./lib/campaign-lab-contract.mjs";
import { getGeminiHeaders, getGeminiThinkingConfig, getGeminiUrl } from "../src/Game/AI/geminiProtocol.js";
import { GAMEPLAY_TOOLS } from "../src/Game/AI/gameplaySchemas.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = path.join(ROOT, "packages/data-packs/fixtures/europe-1935-benchmark");
const RUNS_DIR = process.env.CAMPAIGN_LAB_RUNS_DIR ? path.resolve(process.env.CAMPAIGN_LAB_RUNS_DIR) : path.join(ROOT, "runs/campaign-lab");
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const SUPPORTED_PLAYERS = ["germany", "austria", "czechoslovakia", "poland", "france", "united-kingdom", "italy"].map((id) => `polity:${id}`);
const STRATEGIES = ["historical", "alternative", "free"];
const MAX_CONTEXT_CHARS = 40000;
const MAX_MEMORY_CHARS = 6000;
const MAX_MEMORY_FACTS = 12;
const QUOTA_LEDGER_FILE = path.join(RUNS_DIR, "quota-ledger.json");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
};
const appendJsonl = (file, value) => fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const addMonths = (month, count) => {
  const [year, value] = month.slice(0, 7).split("-").map(Number); const absolute = year * 12 + value - 1 + count;
  return `${String(Math.floor(absolute / 12)).padStart(4, "0")}-${String((absolute % 12) + 1).padStart(2, "0")}-01`;
};
const gitRevision = () => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
};
const assertCleanWorktree = () => {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (status) throw new Error("live Campaign Lab freeze requires a clean git worktree");
};
const parseArgs = (values) => {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]; const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid arguments near ${key ?? ""}`);
    args[key.slice(2)] = value;
  }
  return args;
};
const runDir = (id) => path.join(RUNS_DIR, id);
const fileOf = (id, name) => path.join(runDir(id), name);
const safeRunId = (id) => {
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(id)) throw new Error("run id must be a safe lowercase token");
  return id;
};
class QuotaPauseError extends Error {
  constructor(message, quotaDay) { super(message); this.name = "QuotaPauseError"; this.quotaDay = quotaDay; }
}
const loadQuotaLedger = () => fs.existsSync(QUOTA_LEDGER_FILE) ? readJson(QUOTA_LEDGER_FILE) : {
  schemaVersion: "open-historia-gemini-quota-ledger/1", timezone: "America/Los_Angeles", days: {},
};
const saveQuotaLedger = (ledger) => atomicJson(QUOTA_LEDGER_FILE, ledger);
const updateQuotaAttempt = (quotaDay, attemptId, values) => {
  const ledger = loadQuotaLedger();
  const attempt = (ledger.days[quotaDay]?.attempts ?? []).find((entry) => entry.attemptId === attemptId);
  if (attempt) Object.assign(attempt, values);
  saveQuotaLedger(ledger);
};
const reserveQuotaAttempt = async ({ manifest, estimatedTokens }) => {
  for (;;) {
    const now = Date.now(); const quotaDay = pacificQuotaDay(new Date(now)); const ledger = loadQuotaLedger();
    const day = ledger.days[quotaDay] ?? { attempts: [] };
    if (day.attempts.length >= PACIFIC_DAILY_CALL_LIMIT) throw new QuotaPauseError(`Pacific daily safety limit ${PACIFIC_DAILY_CALL_LIMIT} reached`, quotaDay);
    if (manifest.calls >= manifest.maxCalls) throw new Error(`campaign provider-call limit ${manifest.maxCalls} reached`);
    const recent = day.attempts.filter((entry) => now - Date.parse(entry.startedAt) < 60_000);
    const recentTokens = recent.reduce((sum, entry) => sum + (entry.totalTokens ?? entry.estimatedTokens ?? 0), 0);
    const lastStarted = day.attempts.at(-1)?.startedAt;
    const waitForRpm = lastStarted ? Math.max(0, Math.ceil(60_000 / PACING_RPM) - (now - Date.parse(lastStarted))) : 0;
    const waitForTpm = recentTokens + estimatedTokens > PACING_TPM && recent.length
      ? Math.max(0, 60_001 - (now - Date.parse(recent[0].startedAt))) : 0;
    const waitMs = Math.max(waitForRpm, waitForTpm);
    if (waitMs > 0) { await sleep(Math.min(waitMs, 60_000)); continue; }
    const attemptId = crypto.randomUUID();
    day.attempts.push({ attemptId, runId: manifest.runId, startedAt: new Date(now).toISOString(), estimatedTokens, status: "reserved" });
    ledger.days[quotaDay] = day; saveQuotaLedger(ledger);
    return { attemptId, quotaDay };
  }
};
const loadPackage = () => {
  const bundle = { manifest: readJson(path.join(PACKAGE_DIR, "manifest.json")), scenario: readJson(path.join(PACKAGE_DIR, "scenario.json")), sources: readJson(path.join(PACKAGE_DIR, "sources.json")) };
  const authoring = readJson(path.join(PACKAGE_DIR, "authoring.json"));
  const engineScenario = readJson(path.join(PACKAGE_DIR, "engine/scenario.json"));
  const mapLink = readJson(path.join(PACKAGE_DIR, "engine/map-link.json"));
  return { bundle, authoring, engineScenario, mapLink, projection: compileHistoricalProjection({ bundle, authoring, engineScenario, mapLink }) };
};
const loadRun = (id) => ({ manifest: readJson(fileOf(id, "manifest.json")), state: parseWorldState(readJson(fileOf(id, "state.json"))) });
const writeManifest = (id, manifest) => atomicJson(fileOf(id, "manifest.json"), manifest);
const holdDecision = (polityId, rationale = "No supported material action is justified at this checkpoint.") => ({
  polityId, objective: { domain: "campaign", summary: "Preserve strategic flexibility.", horizon: "short" },
  actions: [{ tool: "conserve" }], futurePlan: [], contingency: "Reassess when canonical conditions change.", rationale,
  hold: { reason: "plan-sequencing", detail: "Wait for a material trigger or scheduled review.",
    revisit: { afterMonths: 1, triggers: ["resource-deficit", "diplomatic-response", "war", "crisis"] } },
});

const PLAYER_DOCTRINES = Object.freeze({
  historical: "Pursue revisionism and militarization; pressure Austria and Czechoslovakia; later aggression and the regime's coercive policies, only through supported generic mechanics and without fabricating demographic consequences.",
  alternative: "Seek alliance, trade and military coordination with the Soviet Union, then pursue coordinated expansion through supported generic mechanics.",
  free: "Build a peaceful trading Germany: de-escalation, non-aggression and integration; do not begin an offensive war unless Germany is attacked.",
});

const writePlayerBrief = (id, manifest, state, reasons) => atomicJson(fileOf(id, "player-brief.json"), {
  schemaVersion: "open-historia-player-brief/2", private: true, doctrine: PLAYER_DOCTRINES[manifest.strategy],
  checkpoint: { month: state.month, revision: state.revision, reasons }, strategicBrief: buildStrategicBriefV2(state, manifest.playerPolityId),
  responseContract: "StrategicDecisionV2; submit with campaign-lab decide --decision <json>. Technical ids and numeric amounts are materialized by the engine adapter.",
});

const verifyPreflight = (file, model) => {
  if (!file) throw new Error("live Campaign Lab start requires --preflight <passing primary-suite JSON>");
  const resolved = path.resolve(file); const bytes = fs.readFileSync(resolved); const result = JSON.parse(bytes);
  if (result.status !== "pass" || result.suite !== "primary" || result.model !== model) throw new Error("preflight evidence must be a passing primary suite for the frozen model");
  if (result.codeRevision !== gitRevision()) throw new Error("preflight evidence code revision does not match HEAD");
  if (result.metadata?.inputTokenLimit !== 1_048_576 || result.metadata?.outputTokenLimit !== 65_536) throw new Error("preflight model metadata does not match the required 1,048,576/65,536 limits");
  if (result.inventory?.registry?.length !== 25 || result.inventory?.engineAgentSchemas?.length !== 4
    || result.inventory?.gameplayToolCount !== Object.keys(GAMEPLAY_TOOLS).length) throw new Error("preflight contract inventory is incomplete");
  return { file: resolved, checksum: sha256(bytes), completedAt: result.completedAt, probeCount: result.probes?.length ?? 0 };
};

const createOne = ({ id, playerPolityId, strategy, mode, model, preflight = null }) => {
  safeRunId(id);
  if (!SUPPORTED_PLAYERS.includes(playerPolityId)) throw new Error(`unsupported player ${playerPolityId}`);
  if (!STRATEGIES.includes(strategy)) throw new Error(`unknown strategy ${strategy}`);
  if (!new Set(["mock", "live"]).has(mode)) throw new Error("mode must be mock or live");
  if (fs.existsSync(runDir(id))) throw new Error(`run ${id} already exists`);
  const loaded = loadPackage();
  fs.mkdirSync(path.join(runDir(id), "raw"), { recursive: true });
  const state = initState(loaded.projection.scenario);
  const manifest = {
    schemaVersion: "open-historia-campaign-lab-run/2", runId: id,
    scenarioId: loaded.projection.scenario.scenarioId, scenarioChecksum: loaded.projection.checksum,
    codeRevision: gitRevision(), playerPolityId, strategy, mode,
    model: mode === "live" ? model : "deterministic-mock", reasoningMode: mode === "live" ? "minimal" : "off",
    maxOutputTokens: MAX_OUTPUT_TOKENS, maxCalls: CAMPAIGN_MAX_CALLS, transportRetries: 2, schemaCorrections: 1,
    pacing: { rpm: PACING_RPM, tpm: PACING_TPM, dailyCalls: PACIFIC_DAILY_CALL_LIMIT, timezone: "America/Los_Angeles" },
    preflight, promptVersions: { campaignLabDecision: "campaign-lab-strategy/4", strategicContract: "StrategicDecisionV2", geminiWire: "gemini-wire/2" },
    startMonth: state.month, horizonMonth: loaded.authoring.horizonDate,
    status: mode === "live" ? "awaiting-player-decision" : "ready", calls: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkpoint: { month: state.month, reasons: ["campaign-start"] },
    alertState: {}, triggerReasons: [],
    plannerDueByPolity: {}, playerDueMonth: state.month,
  };
  atomicJson(fileOf(id, "state.json"), state); writeManifest(id, manifest);
  fs.writeFileSync(fileOf(id, "chronicle.jsonl"), "", "utf8");
  fs.writeFileSync(fileOf(id, "chronicle.md"), `# ${id}\n\nPlayer: ${playerPolityId}; strategy: ${strategy}; mode: ${mode}.\n\n`, "utf8");
  fs.writeFileSync(fileOf(id, "telemetry.jsonl"), "", "utf8");
  fs.writeFileSync(fileOf(id, "decisions.jsonl"), "", "utf8");
  writePlayerBrief(id, manifest, state, ["campaign-start"]);
  return manifest;
};

const chronicleEvent = (event) => new Set([
  "proposal-created", "proposal-countered", "proposal-rejected", "agreement-created", "agreement-terminated",
  "territorial-settlement-accepted", "region-transferred", "war-declared", "war-ended", "call-to-arms-created",
  "call-to-arms-resolved", "region-occupied", "peace-offered", "peace-resolved", "government-transferred",
  "faction-escalated", "default", "crisis-opened", "crisis-escalated", "crisis-resolved", "goal-achieved",
]).has(event.type) || /war|peace|occupation|default|government|crisis|goal/.test(event.type);

const strategicContexts = (authoring, memory) => Object.fromEntries(authoring.nationalControls.map((control) => {
  const anchors = authoring.causalAnchors.filter((entry) => entry.polityId === control.polityId);
  return [control.polityId, {
    interests: anchors.map((entry) => entry.interest).slice(0, 4),
    threats: [...new Set(anchors.flatMap((entry) => entry.threats))].slice(0, 6),
    obligations: [...new Set(anchors.flatMap((entry) => entry.obligations))].slice(0, 6),
    redLines: [...new Set(anchors.flatMap((entry) => entry.redLines))].slice(0, 6),
    causalAnchors: anchors.map((entry) => ({ anchorId: entry.anchorId, interest: entry.interest, applicability: entry.applicability, invalidators: entry.invalidators })).slice(0, 4),
    memory: memory.filter((entry) => entry.participants.includes(control.polityId)).slice(-MAX_MEMORY_FACTS).map((entry) => `${entry.month} ${entry.eventType}`).filter((_, index, rows) => JSON.stringify(rows).length <= MAX_MEMORY_CHARS),
  }];
}));

const geminiDecision = async ({ id, manifest, batch, correction = null }) => {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for live mode and is never stored");
  const system = `Play each requested polity independently. Return the exact flat strategic wire JSON required by the schema. objectiveDomain/objectiveSummary/horizon encode the objective. Select zero to three compatible material tools from: ${CAMPAIGN_DECISION_TOOLS.join(", ")}. Each action uses tool plus target (region/proposal/faction/template/formation/war), counterpart (polity), subject (resource/budget/commander/target region), choice (priority/runway/agreement/demand/response/stance/reason/posture/approach), and intensity (scale or budget attitude); use empty strings for unused fields. For negotiate-trade and external-import specifically, put desiredRunway short|medium|long in choice and budgetAttitude cautious|balanced|urgent in intensity. Choose qualitative goals, partners, risk, sequence and contingency; never emit engine commands, technical ids, numeric effects, values outside the brief, or geometry. For material actions use holdReason none, empty holdDetail, revisitAfterMonths 1 and a resource-deficit sentinel trigger. For conserve use a typed holdReason, detail and real revisit values. Unsupported consequences belong only in intendedOutcome and must not be narrated as completed.`;
  const payload = { month: batch.month, revision: batch.baseRevision, briefs: batch.briefs, ...(correction ? { correction } : {}) };
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_CONTEXT_CHARS || /coordinates|geometry|FeatureCollection/.test(serialized)) throw new Error("AI context gate failed");
  const request = {
    system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: serialized }] }],
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: getGeminiThinkingConfig(manifest.model, { reasoningMode: "minimal" }) },
    tools: [{ functionDeclarations: [{ name: "submit_strategic_decisions", description: "Submit the complete bounded strategic decision batch.", parameters: CAMPAIGN_DECISION_RESPONSE_SCHEMA }] }],
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["submit_strategic_decisions"] } },
  };
  let lastError;
  const generation = correction ? 2 : 1;
  for (let transportAttempt = 1; transportAttempt <= manifest.transportRetries + 1; transportAttempt += 1) {
    const estimatedTokens = Math.ceil((system.length + serialized.length) / 4) + MAX_OUTPUT_TOKENS;
    const reservation = await reserveQuotaAttempt({ manifest, estimatedTokens });
    const started = Date.now(); manifest.calls += 1; manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest);
    const rawIndex = String(manifest.calls).padStart(3, "0");
    atomicJson(fileOf(id, `raw/request-${rawIndex}.json`), request);
    try {
      const response = await fetch(getGeminiUrl(manifest.model), {
        method: "POST", headers: getGeminiHeaders(process.env.GEMINI_API_KEY), body: JSON.stringify(request),
      });
      const responseText = await response.text();
      let data;
      try { data = responseText ? JSON.parse(responseText) : {}; } catch { data = { rawText: responseText }; }
      const status = response.ok ? "success" : "provider-error";
      appendJsonl(fileOf(id, "telemetry.jsonl"), { month: batch.month, batchId: batch.batchId, generation, transportAttempt,
        latencyMs: Date.now() - started, status: response.ok ? "success" : "provider-error", httpStatus: response.status,
        usage: data.usageMetadata ?? null, parseResult: null, schemaResult: null, acceptedCommands: null, rejectedCommands: null });
      atomicJson(fileOf(id, `raw/response-${rawIndex}-${transportAttempt}.json`), data);
      updateQuotaAttempt(reservation.quotaDay, reservation.attemptId, { status, httpStatus: response.status,
        totalTokens: data.usageMetadata?.totalTokenCount ?? null, finishedAt: new Date().toISOString() });
      if (!response.ok) {
        const error = new Error(data?.error?.message ?? `Gemini HTTP ${response.status}`);
        error.httpStatus = response.status; throw error;
      }
      if (!data.usageMetadata || !Number.isFinite(data.usageMetadata.totalTokenCount)) throw new Error("Gemini success response omitted usageMetadata.totalTokenCount");
      const args = data?.candidates?.[0]?.content?.parts?.find((part) => part.functionCall?.name === "submit_strategic_decisions")?.functionCall?.args;
      if (!args) throw new Error("Gemini omitted the required submit_strategic_decisions tool call");
      return JSON.stringify(args);
    } catch (error) {
      lastError = error;
      const networkError = error instanceof TypeError;
      updateQuotaAttempt(reservation.quotaDay, reservation.attemptId, { status: networkError ? "network-error" : "provider-error",
        httpStatus: error?.httpStatus ?? null, finishedAt: new Date().toISOString() });
      if (transportAttempt > manifest.transportRetries || !isRetryableGeminiFailure({ networkError, status: error?.httpStatus })) throw error;
    }
  }
  throw lastError;
};

const opponentCommands = async ({ id, manifest, state, authoring, memory }) => {
  const triggered = (manifest.triggerReasons?.length ?? 0) > 0;
  const quarterly = (state.turn % 3) === 0;
  const due = state.polities.filter((entry) => entry.id !== manifest.playerPolityId && (manifest.plannerDueByPolity?.[entry.id] ?? "9999-12-01") <= state.month).map((entry) => entry.id);
  if (!quarterly && !triggered && due.length === 0) return [];
  const requestedPolityIds = quarterly || triggered ? undefined : due;
  const batches = buildStrategicBatchesV2(state, manifest.playerPolityId, { strategicContextByPolity: strategicContexts(authoring, memory), requestedPolityIds });
  const commands = [];
  for (const batch of batches) {
    let parsed;
    if (manifest.mode === "mock") {
      parsed = { decisions: batch.polityIds.map((polityId) => holdDecision(polityId, "Deterministic mocked typed hold.")) };
    } else {
      let correction = null;
      for (let generation = 1; generation <= 2; generation += 1) {
        let text;
        try {
          text = await geminiDecision({ id, manifest, batch, correction });
        } catch (error) {
          throw error;
        }
        try {
          parsed = normalizeCampaignDecisionWire(JSON.parse(text));
          const materialized = materializeStrategicBatchV2(state, parsed, batch);
          if (materialized.rejected.length) throw new Error(materialized.rejected.map((entry) => entry.reason).join("; "));
          appendJsonl(fileOf(id, "telemetry.jsonl"), { month: batch.month, batchId: batch.batchId, generation,
            latencyMs: 0, status: "generation-accepted", usage: null, parseResult: "accepted", schemaResult: "accepted",
            acceptedCommands: materialized.commands.length, rejectedCommands: 0 });
          break;
        } catch (error) {
          appendJsonl(fileOf(id, "telemetry.jsonl"), { month: batch.month, batchId: batch.batchId, generation,
            latencyMs: 0, status: "schema-error", usage: null, parseResult: text ? "failed" : "empty", schemaResult: "failed",
            acceptedCommands: 0, rejectedCommands: 0, detail: String(error).slice(0, 500) });
          if (generation === 2) throw error;
          correction = `Previous response failed validation: ${String(error).slice(0, 500)}. Return corrected strict JSON only.`;
        }
      }
    }
    const validated = strategicDecisionBatchV2Schema.parse(parsed);
    const materialized = materializeStrategicBatchV2(state, validated, batch);
    if (materialized.rejected.length) throw new Error(`strategic materialization rejected: ${materialized.rejected.map((entry) => entry.reason).join(", ")}`);
    appendJsonl(fileOf(id, "decisions.jsonl"), { month: state.month, actor: "opponents", batchId: batch.batchId,
      decisions: validated.decisions, commands: materialized.commands, unsupportedResidual: materialized.unsupportedResidual });
    for (const decision of validated.decisions) manifest.plannerDueByPolity[decision.polityId] = addMonths(state.month, decision.hold?.revisit.afterMonths ?? 3);
    commands.push(...materialized.commands);
  }
  return commands;
};

const pendingPlayerCommands = (id, state, manifest) => {
  const file = fileOf(id, "pending-player-decision.json");
  if (!fs.existsSync(file)) {
    if (manifest.mode === "mock") return [];
    return null;
  }
  const decision = readJson(file);
  if (decision.month !== state.month || decision.revision !== state.revision) throw new Error("pending player decision is stale");
  fs.rmSync(file);
  appendJsonl(fileOf(id, "decisions.jsonl"), decision);
  return parseTurnCommands({ commands: decision.commands }).commands;
};

const chronicleTurn = (id, completed, commands, previousAlertState) => {
  const alerts = reduceChronicleAlerts(completed.result.events, previousAlertState);
  const chronicleEvents = [...completed.result.events.filter(chronicleEvent), ...alerts.records];
  for (const event of chronicleEvents) {
    const participants = [...new Set(Object.entries(event).filter(([key]) => /polityId$/i.test(key)).map(([, value]) => value).filter((value) => typeof value === "string"))].sort();
    const record = { month: completed.result.ledger.month, openingRevision: completed.baseRevision, closingRevision: completed.result.state.revision,
      participants, affectedPolities: participants, eventType: event.type,
      precedingDecisions: commands.map((command) => ({ commandId: command.commandId, actorPolityId: command.actorPolityId, kind: command.kind })),
      evidenceIds: [completed.baseRevision, completed.result.state.revision],
      mechanicalConsequences: event, territoryDelta: completed.result.ledger.transfers.filter((entry) => participants.includes(entry.fromPolityId) || participants.includes(entry.toPolityId)),
      governmentDelta: /government|faction|coup|revolution/.test(event.type) ? event : null,
      economicDelta: completed.result.ledger.polities.filter((entry) => participants.length === 0 || participants.includes(entry.polityId)).map((entry) => ({
        polityId: entry.polityId, populationOpening: entry.populationOpening, populationClosing: entry.populationClosing,
        treasuryOpening: entry.treasuryOpening, treasuryClosing: entry.treasuryClosing, foodShortfall: entry.food.shortfall,
      })),
      armyDelta: completed.result.ledger.military ?? null,
      causalExplanation: `Observed engine event ${event.type} in the atomic monthly revision.`, epistemicStatus: "observed" };
    appendJsonl(fileOf(id, "chronicle.jsonl"), record);
    fs.appendFileSync(fileOf(id, "chronicle.md"), `## ${record.month} — ${record.eventType}\n\n${record.causalExplanation}\n\nRevision: ${record.closingRevision}.\n\n`, "utf8");
  }
  return { chronicleEvents, alertState: alerts.alertState,
    triggerReasons: [...new Set([...decisionTriggerReasons(completed.result.events), ...alerts.triggerReasons])].sort() };
};

const finalCard = (manifest, state, chronicle, authoring, lastLedger) => {
  const controller = (region) => state.military?.occupations.filter((entry) => entry.regionId === region.regionId)
    .sort((a, b) => b.occupiedMonth.localeCompare(a.occupiedMonth))[0]?.actualControllerId ?? region.controllerId;
  const polities = state.polities.map((polity) => ({
    polityId: polity.id, controlledRegions: state.regions.filter((region) => controller(region) === polity.id).map((region) => region.regionId),
    legalRegions: state.regions.filter((region) => region.controllerId === polity.id).map((region) => region.regionId), treasury: polity.treasury,
    stockpile: Object.fromEntries(polity.stockpile.map((entry) => [entry.resource, entry.amount])),
    government: state.politics?.polities.find((entry) => entry.polityId === polity.id) ?? null,
    debt: state.finance?.polities.find((entry) => entry.polityId === polity.id)?.debt ?? null,
    deficits: (() => { const ledger = lastLedger?.polities?.find((entry) => entry.polityId === polity.id); return ledger ? {
      foodShortfall: ledger.food.shortfall, limitingInputs: ledger.goods?.limitingInputs ?? [],
    } : null; })(),
    military: state.military?.polities.find((entry) => entry.polityId === polity.id) ?? null,
    formations: state.military?.formations.filter((entry) => entry.polityId === polity.id) ?? [],
    relations: state.diplomacy?.relations.filter((entry) => entry.polities.includes(polity.id)) ?? [],
    goals: state.campaign?.goals.filter((entry) => entry.polityId === polity.id) ?? [],
  }));
  const observedKinds = new Set(chronicle.map((entry) => entry.eventType));
  const historicalMilestones = authoring.milestones.map((milestone) => {
    const observed = milestone.evidenceKinds.some((kind) => [...observedKinds].some((eventKind) => eventKind.includes(kind)));
    return { milestoneId: milestone.milestoneId, points: milestone.points, status: observed ? "observed-candidate" : "not-observed",
      note: observed ? "Candidate evidence exists; historical equivalence requires review." : "No matching canonical event evidence." };
  });
  return { runId: manifest.runId, playerPolityId: manifest.playerPolityId, strategy: manifest.strategy, finalMonth: state.month,
    finalRevision: state.revision, polities, agreements: state.diplomacy?.agreements ?? [], wars: state.military?.wars ?? [],
    occupations: state.military?.occupations ?? [], calls: manifest.calls,
    telemetry: summarizeTelemetry(manifest.runId), materialEvents: chronicle.length, historicalMilestones,
    historicalScore: historicalMilestones.filter((entry) => entry.status === "observed-candidate").reduce((sum, entry) => sum + entry.points, 0),
    logicalOrTechnicalProblems: [] };
};
const renderFinalCard = (card) => {
  const player = card.polities.find((entry) => entry.polityId === card.playerPolityId);
  const achieved = player?.goals.filter((entry) => entry.status === "achieved").map((entry) => entry.goalId) ?? [];
  const military = player?.military;
  return [
    `# ${card.runId} final card`, "", `Final month: ${card.finalMonth}`, "", `Final revision: ${card.finalRevision}`, "",
    `Player: ${card.playerPolityId}; strategy: ${card.strategy}.`, "",
    "## State", "",
    `- Controlled/legal regions: ${player?.controlledRegions.length ?? 0}/${player?.legalRegions.length ?? 0}.`,
    `- Government: ${player?.government ? `stability ${player.government.stabilityBp} bp, legitimacy ${player.government.legitimacyBp} bp` : "not modelled in this projection"}.`,
    `- Treasury/debt: ${player?.treasury ?? "n/a"}/${player?.debt ?? "not modelled"}.`,
    `- Food shortfall: ${player?.deficits?.foodShortfall ?? "n/a"}; limiting inputs: ${player?.deficits?.limitingInputs?.join(", ") || "none"}.`,
    `- Mobilized/casualties: ${military?.mobilized ?? "n/a"}/${military?.casualties ?? "n/a"}; active formations: ${player?.formations.filter((entry) => !["destroyed", "demobilized"].includes(entry.status)).length ?? 0}.`,
    `- Agreements/wars/occupations: ${card.agreements.length}/${card.wars.length}/${card.occupations.length}.`,
    `- Achieved goals: ${achieved.join(", ") || "none"}. Historical evidence score: ${card.historicalScore}/100.`, "",
    "## Lab telemetry", "",
    `- Model calls: ${card.calls}; input/output tokens: ${card.telemetry.inputTokens}/${card.telemetry.outputTokens}; latency: ${card.telemetry.latencyMs} ms.`,
    `- Schema/transport errors: ${card.telemetry.schemaErrors}/${card.telemetry.transportErrors}; material events: ${card.materialEvents}.`,
    `- Problems: ${card.logicalOrTechnicalProblems.join("; ") || "none recorded"}.`, "",
  ].join("\n");
};
const writeCheckpointReport = (id) => {
  const file = fileOf(id, "decisions.jsonl");
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const lines = [`# ${id} checkpoint report`, ""];
  for (const row of rows) {
    const decisions = row.decision ? [row.decision] : row.decisions ?? [];
    lines.push(`## ${row.month} — ${row.actor}`, "");
    for (const decision of decisions) lines.push(`- ${decision.polityId}: ${decision.objective?.summary ?? "No objective recorded"}; tools ${(decision.actions ?? []).map((entry) => entry.tool).join(", ") || "none"}; rationale ${decision.rationale ?? "none"}.`);
    lines.push(`- Materialized commands: ${(row.commands ?? []).map((entry) => entry.kind).join(", ") || "none"}.`,
      `- Unsupported residual: ${(row.unsupportedResidual ?? []).join("; ") || "none"}.`, "");
  }
  fs.writeFileSync(fileOf(id, "checkpoint-report.md"), `${lines.join("\n")}\n`, "utf8");
};
const summarizeTelemetry = (id) => {
  const file = fileOf(id, "telemetry.jsonl");
  const rows = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const providerAttempts = rows.filter((row) => row.batchId && Number.isInteger(row.transportAttempt));
  return { attempts: providerAttempts.length, engineResolutions: rows.filter((row) => row.status === "engine-resolution").length,
    latencyMs: providerAttempts.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0),
    inputTokens: providerAttempts.reduce((sum, row) => sum + (row.usage?.promptTokenCount ?? 0), 0), outputTokens: providerAttempts.reduce((sum, row) => sum + (row.usage?.candidatesTokenCount ?? 0), 0),
    schemaErrors: rows.filter((row) => row.status === "schema-error").length,
    transportErrors: providerAttempts.filter((row) => row.status !== "success").length };
};

const resume = async (id) => {
  const loaded = loadPackage(); const current = loadRun(id); const { manifest } = current; let { state } = current;
  if (manifest.schemaVersion !== "open-historia-campaign-lab-run/2") throw new Error("diagnostic-hold-v1 run cannot continue after the StrategicDecisionV2 revision; start an autonomy-v2 run");
  if (loaded.projection.checksum !== manifest.scenarioChecksum) throw new Error("frozen scenario checksum changed; start a new matrix after fixing it");
  if (gitRevision() !== manifest.codeRevision) throw new Error("frozen code revision changed; finish this matrix with its original revision");
  if (manifest.status === "completed") return manifest;
  const chronicle = fs.readFileSync(fileOf(id, "chronicle.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  let lastLedger = fs.existsSync(fileOf(id, "last-turn.json")) ? readJson(fileOf(id, "last-turn.json")).ledger : null;
  if (manifest.status === "quota-paused" && manifest.quotaDay === pacificQuotaDay()) return manifest;
  if (manifest.status === "quota-paused") { manifest.status = "ready"; manifest.quotaDay = null; manifest.lastError = null; }
  while (state.month < manifest.horizonMonth) {
    const scheduledPlayer = state.turn % 6 === 0 || (manifest.triggerReasons?.length ?? 0) > 0 || (manifest.playerDueMonth ?? "9999-12-01") <= state.month;
    let player = [];
    if (scheduledPlayer) {
      const decision = pendingPlayerCommands(id, state, manifest);
      if (decision === null) {
        manifest.status = "awaiting-player-decision"; manifest.checkpoint = { month: state.month,
          reasons: manifest.triggerReasons?.length ? manifest.triggerReasons : [state.turn === 0 ? "campaign-start" : "six-month-review"] };
        writePlayerBrief(id, manifest, state, manifest.checkpoint.reasons);
        manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest); atomicJson(fileOf(id, "state.json"), state); return manifest;
      }
      player = decision;
    }
    let opponents;
    try { opponents = await opponentCommands({ id, manifest, state, authoring: loaded.authoring, memory: chronicle }); }
    catch (error) {
      if (error instanceof QuotaPauseError) {
        manifest.status = "quota-paused"; manifest.quotaDay = error.quotaDay; manifest.lastError = String(error).slice(0, 500);
        manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest); atomicJson(fileOf(id, "state.json"), state); return manifest;
      }
      manifest.status = "provider-error"; manifest.lastError = String(error).slice(0, 500); manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest); throw error;
    }
    const completed = runTurn(state, { commands: [...player, ...opponents] });
    appendJsonl(fileOf(id, "telemetry.jsonl"), { month: state.month, status: "engine-resolution",
      acceptedCommands: player.length + opponents.length - completed.result.rejections.length, rejectedCommands: completed.result.rejections.length,
      latencyMs: 0, usage: null });
    if (completed.result.rejections.length) throw new Error(`validated campaign commands rejected: ${completed.result.rejections.map((entry) => entry.reason).join(", ")}`);
    const allCommands = [...player, ...opponents];
    const chronicled = chronicleTurn(id, completed, allCommands, manifest.alertState ?? {});
    chronicle.push(...chronicled.chronicleEvents.map((event) => ({ month: completed.result.ledger.month, eventType: event.type,
      participants: Object.entries(event).filter(([key]) => /polityId$/i.test(key)).map(([, value]) => value).filter((value) => typeof value === "string") })));
    lastLedger = completed.result.ledger;
    atomicJson(fileOf(id, "last-turn.json"), { baseRevision: completed.baseRevision, revision: completed.result.state.revision,
      events: completed.result.events, ledger: completed.result.ledger, commands: allCommands });
    state = completed.result.state; manifest.alertState = chronicled.alertState; manifest.triggerReasons = chronicled.triggerReasons;
    manifest.status = "running"; manifest.checkpoint = null;
    manifest.updatedAt = new Date().toISOString(); atomicJson(fileOf(id, "state.json"), state); writeManifest(id, manifest);
  }
  manifest.status = "completed"; manifest.completedAt = new Date().toISOString(); manifest.triggerReasons = [];
  const card = finalCard(manifest, state, chronicle, loaded.authoring, lastLedger); atomicJson(fileOf(id, "final-card.json"), card);
  fs.writeFileSync(fileOf(id, "final-card.md"), renderFinalCard(card), "utf8");
  writeCheckpointReport(id);
  writeManifest(id, manifest); return manifest;
};

const decide = (id, args) => {
  const { manifest, state } = loadRun(id);
  if (manifest.status !== "awaiting-player-decision") throw new Error("run is not awaiting a player decision");
  if (!args.decision) throw new Error("decide requires --decision <StrategicDecisionV2 json>");
  const decision = strategicDecisionV2Schema.parse(readJson(path.resolve(args.decision)));
  if (decision.polityId !== manifest.playerPolityId) throw new Error("player strategic actor mismatch");
  const materialized = materializeStrategicDecisionV2(state, decision, { expectedRevision: state.revision, effectiveMonth: state.month });
  if (materialized.rejected.length) throw new Error(`player strategic materialization rejected: ${materialized.rejected.map((entry) => entry.reason).join(", ")}`);
  const commands = materialized.commands;
  atomicJson(fileOf(id, "pending-player-decision.json"), { month: state.month, revision: state.revision, actor: manifest.playerPolityId,
    strategy: manifest.strategy, decision, commands, unsupportedResidual: materialized.unsupportedResidual });
  manifest.playerDueMonth = addMonths(state.month, decision.hold?.revisit.afterMonths ?? 6);
  manifest.status = "ready"; manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest); return manifest;
};

const aggregateReport = (allowPartial, matrixName = "legacy21") => {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const free10 = matrixName === "free10";
  const autonomyV2 = matrixName === "free10-autonomy-v2";
  const expectedRuns = autonomyV2 ? AUTONOMY_V2_CELLS.length : free10 ? FREE10_CELLS.length : 21;
  const expectedId = (manifest) => `${autonomyV2 ? "free10-autonomy-v2-" : free10 ? "free10-" : ""}${manifest.playerPolityId.slice(7)}-${manifest.strategy}`;
  const runs = fs.readdirSync(RUNS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(RUNS_DIR, entry.name, "final-card.json")))
    .map((entry) => ({ manifest: readJson(path.join(RUNS_DIR, entry.name, "manifest.json")), card: readJson(path.join(RUNS_DIR, entry.name, "final-card.json")) }))
    .filter((entry) => entry.manifest.scenarioId === "scenario:europe-1935-benchmark"
      && entry.manifest.runId === expectedId(entry.manifest));
  const unique = new Set(runs.map((entry) => `${entry.manifest.playerPolityId}|${entry.manifest.strategy}`));
  if (!allowPartial && unique.size !== expectedRuns) throw new Error(`aggregate report requires ${expectedRuns} unique completed matrix runs; found ${unique.size}`);
  const eventFrequency = {};
  for (const run of runs) {
    const file = fileOf(run.manifest.runId, "chronicle.jsonl");
    for (const row of fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)) eventFrequency[row.eventType] = (eventFrequency[row.eventType] ?? 0) + 1;
  }
  const probeDir = path.join(RUNS_DIR, "gemini-preflight");
  const auxiliaryModelProbes = fs.existsSync(probeDir) ? fs.readdirSync(probeDir).filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(probeDir, name))).map((result) => ({ model: result.model, suite: result.suite, status: result.status,
      inputTokenLimit: result.metadata?.inputTokenLimit ?? null, outputTokenLimit: result.metadata?.outputTokenLimit ?? null,
      checkpoints: result.probes?.length ?? 0, failedCheckpoints: (result.probes ?? []).filter((probe) => probe.httpStatus !== 200).map((probe) => probe.name),
      inventory: { gameplayTools: result.inventory?.gameplayToolCount ?? null, engineAgentSchemas: result.inventory?.engineAgentSchemas?.length ?? null,
        registryTasks: result.inventory?.registry?.length ?? null },
    })).sort((a, b) => `${a.model}|${a.suite}`.localeCompare(`${b.model}|${b.suite}`)) : [];
  const quotaLedger = fs.existsSync(QUOTA_LEDGER_FILE) ? loadQuotaLedger() : null;
  const quotaDays = Object.fromEntries(Object.entries(quotaLedger?.days ?? {}).map(([day, value]) => [day, {
    attempts: value.attempts.length, totalTokens: value.attempts.reduce((sum, attempt) => sum + (attempt.totalTokens ?? 0), 0),
  }]));
  const dataset = { schemaVersion: "open-historia-campaign-lab-dataset/1", scenarioId: "scenario:europe-1935-benchmark", matrix: matrixName,
    generatedAt: new Date().toISOString(), completeMatrix: unique.size === expectedRuns,
    runs: runs.map(({ manifest, card }) => ({ runId: manifest.runId, playerPolityId: manifest.playerPolityId, strategy: manifest.strategy, mode: manifest.mode, finalMonth: card.finalMonth,
      finalRevision: card.finalRevision, calls: card.calls, telemetry: card.telemetry, agreements: card.agreements, wars: card.wars, occupations: card.occupations,
      materialEvents: card.materialEvents, historicalScore: card.historicalScore, historicalMilestones: card.historicalMilestones,
      logicalOrTechnicalProblems: card.logicalOrTechnicalProblems, polities: card.polities })), eventFrequency, auxiliaryModelProbes, quotaDays };
  const reportsDir = path.join(ROOT, "docs/reports"); fs.mkdirSync(reportsDir, { recursive: true });
  const reportStem = autonomyV2 ? "europe-1935-campaign-lab-free10-autonomy-v2" : free10 ? "europe-1935-campaign-lab-free10" : "europe-1935-campaign-lab";
  atomicJson(path.join(reportsDir, `${reportStem}.dataset.json`), dataset);
  const sortedRuns = dataset.runs.sort((a, b) => `${a.playerPolityId}|${a.strategy}`.localeCompare(`${b.playerPolityId}|${b.strategy}`));
  const playerRows = sortedRuns.map((run) => ({ run, polity: run.polities.find((entry) => entry.polityId === run.playerPolityId) }));
  const total = (selector) => sortedRuns.reduce((sum, run) => sum + selector(run), 0);
  const runDetails = playerRows.flatMap(({ run, polity }) => [
    `### ${run.runId}`, "",
    `- Wars/occupations/agreements: ${run.wars.length}/${run.occupations.length}/${run.agreements.length}.`,
    `- War records: ${run.wars.map((war) => `${war.warId ?? "war"} (${war.status ?? "unknown"}; ${(war.attackers ?? []).join("+")} vs ${(war.defenders ?? []).join("+")})`).join("; ") || "none"}.`,
    `- Occupation records: ${run.occupations.map((occupation) => `${occupation.regionId}:${occupation.actualControllerId ?? occupation.occupierPolityId ?? "unknown"}`).join(", ") || "none"}.`,
    `- Territory controlled/legal: ${polity?.controlledRegions.length ?? 0}/${polity?.legalRegions.length ?? 0}.`,
    `- Government: ${polity?.government ? `stability ${polity.government.stabilityBp}, legitimacy ${polity.government.legitimacyBp}` : "not enabled"}.`,
    `- Economy: treasury ${polity?.treasury ?? "n/a"}, debt ${polity?.debt ?? "n/a"}, food shortfall ${polity?.deficits?.foodShortfall ?? "n/a"}.`,
    `- Goals: ${polity?.goals.map((goal) => `${goal.goalId}=${goal.status}`).join(", ") || "none"}.`,
    `- Historical milestones: ${run.historicalMilestones.map((milestone) => `${milestone.milestoneId}=${milestone.status}`).join(", ") || "none"}.`,
    `- AI errors: schema ${run.telemetry.schemaErrors}, transport ${run.telemetry.transportErrors}; ${run.logicalOrTechnicalProblems.join("; ") || "none recorded"}.`, "",
  ]);
  const lines = ["# Europe 1935 Campaign Lab", "", `Matrix: ${matrixName}. Completed cells: ${unique.size}/${expectedRuns}.`, "",
    `Execution mode: ${[...new Set(dataset.runs.map((run) => run.mode))].join(", ")}. The committed matrix is a deterministic infrastructure baseline; it does not stand in for the pending live Gemini experiment.`, "",
    "| Player | Strategy | Mode | Final month | Calls |", "|---|---|---:|---:|---:|",
    ...sortedRuns.map((run) => `| ${run.playerPolityId} | ${run.strategy} | ${run.mode} | ${run.finalMonth} | ${run.calls} |`),
    "", "## Final player-country cards", "", "| Player | Strategy | Territory controlled/legal | Treasury | Mobilized | Casualties | Goals | Historical score |", "|---|---|---:|---:|---:|---:|---:|---:|",
    ...playerRows.map(({ run, polity }) => `| ${run.playerPolityId} | ${run.strategy} | ${polity?.controlledRegions.length ?? 0}/${polity?.legalRegions.length ?? 0} | ${polity?.treasury ?? "n/a"} | ${polity?.military?.mobilized ?? "n/a"} | ${polity?.military?.casualties ?? "n/a"} | ${polity?.goals.filter((entry) => entry.status === "achieved").length ?? 0} | ${run.historicalScore}/100 |`),
    "", ...(dataset.runs.every((run) => run.mode === "mock")
      ? [`All ${expectedRuns} mock lines retained their initial legal and actual territory; this is an infrastructure baseline, not a live result.`]
      : ["Live outcomes are listed per run below; no mock line is included in the free10 comparison."]),
    "", "## Per-run outcomes", "", ...runDetails,
    "", "## Event frequency", "", ...Object.entries(eventFrequency).sort().map(([kind, count]) => `- ${kind}: ${count}`), "",
    "## Major chronology", "", ...(total((run) => run.wars.length + run.occupations.length) ? ["War and occupation records are retained in the aggregate dataset and revision-linked run chronicles."] : ["No wars, revolutions, coups, territorial changes or occupations occurred under the deterministic hold controller. Monthly resource alerts account for all material records."]), "",
    "## Repeated causal chains", "", "The only repeated chain in mocked mode was monthly economy resolution → resource alert → unchanged strategic hold. It is an engine/telemetry observation, not a historical or AI-behaviour conclusion.", "",
    "## AI response quality", "", dataset.runs.every((run) => run.mode === "mock") ? "Mock controllers only: no claim about Gemini quality is made." : "Provider telemetry and rejected commands are retained per run for review.", "",
    "## Auxiliary model probes", "", ...(auxiliaryModelProbes.length ? auxiliaryModelProbes.map((probe) =>
      `- ${probe.model} (${probe.suite}): ${probe.status}; ${probe.checkpoints} checkpoints; failed ${probe.failedCheckpoints.join(", ") || "none"}.`) : ["No auxiliary probe evidence found."]), "",
    "## Pacific quota ledger", "", ...Object.entries(quotaDays).map(([day, quota]) => `- ${day}: ${quota.attempts}/${PACIFIC_DAILY_CALL_LIMIT} attempts; ${quota.totalTokens} reported tokens.`), "",
    "## Historical, alternative and free comparison", "", dataset.runs.every((run) => run.mode === "mock")
      ? "All three labels intentionally converge in the mock baseline because both player and opponents hold."
      : "Historical, alternative and free outcomes are compared in the player-country table and per-run cards; the United Kingdom contributes only its historical line in free10.", "",
    "## Balance and initial-data influence", "", `Across the matrix: ${total((run) => run.calls)} model calls, ${total((run) => run.telemetry.engineResolutions)} monthly engine resolutions, ${total((run) => run.wars.length)} final war records and ${total((run) => run.occupations.length)} final occupations. Per-polity population, treasury, resources, deficits, military strength and relations are retained in the aggregate dataset for later live comparison.`, "",
    "## Missing mechanics and data", "", "- Regional 1935 allocations remain low-confidence macro estimates.", "- Colonies, fleets and distant theatres remain abstract capabilities.", "- Government/debt fields are null when their optional scenario modules are disabled.", "",
    "## Recommendations for the next scenario", "", "- Keep ScenarioV2, authoring controls and engine projection separate and checksum-bound.", "- Complete a dedicated regional population/industry/resource research pass before Curated fidelity.", "- Preserve conditional anchors with explicit invalidators; never script milestones as events.", "",
    "## Interpretation", "", unique.size === expectedRuns
      ? dataset.runs.every((run) => run.mode === "mock") ? "Complete deterministic mock matrix; historical score targets and strategic conclusions are not evaluated." : "This report covers the frozen 21-run matrix."
      : "Partial diagnostic report; cross-strategy conclusions and target scores are intentionally withheld.", ""];
  fs.writeFileSync(path.join(reportsDir, `${reportStem}.md`), `${lines.join("\n")}\n`, "utf8"); return dataset;
};

const startMatrix = ({ matrixName, mode, model, preflight }) => {
  const cells = matrixName === "free10-autonomy-v2" ? AUTONOMY_V2_CELLS : matrixName === "free10" ? FREE10_CELLS : SUPPORTED_PLAYERS.flatMap((playerPolityId) =>
    STRATEGIES.map((strategy) => ({ player: playerPolityId.slice(7), strategy })));
  const prefix = matrixName === "free10-autonomy-v2" ? "free10-autonomy-v2-" : matrixName === "free10" ? "free10-" : "";
  const ids = cells.map((cell) => `${prefix}${cell.player}-${cell.strategy}`);
  for (const id of ids) if (fs.existsSync(runDir(id))) throw new Error(`run ${id} already exists; matrix start is atomic at the run-set boundary`);
  const loaded = loadPackage(); const freeze = {
    schemaVersion: "open-historia-campaign-lab-matrix/1", matrix: matrixName, scenarioId: loaded.projection.scenario.scenarioId,
    scenarioChecksum: loaded.projection.checksum, codeRevision: gitRevision(), model: mode === "live" ? model : "deterministic-mock",
    thinkingLevel: mode === "live" ? "minimal" : "off", maxOutputTokens: MAX_OUTPUT_TOKENS,
    preflight, promptVersions: { campaignLabDecision: "campaign-lab-strategy/4", strategicContract: "StrategicDecisionV2", geminiWire: "gemini-wire/2" },
    pacing: { rpm: PACING_RPM, tpm: PACING_TPM, dailyCalls: PACIFIC_DAILY_CALL_LIMIT, timezone: "America/Los_Angeles" },
    cells: ids, createdAt: new Date().toISOString(),
  };
  atomicJson(path.join(RUNS_DIR, `matrix-${matrixName}.json`), freeze);
  return cells.map((cell, index) => createOne({ id: ids[index], playerPolityId: `polity:${cell.player}`, strategy: cell.strategy, mode, model, preflight }));
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2); const args = parseArgs(rest);
  if (command === "preflight") {
    const childArgs = [path.join(ROOT, "scripts/gemini-preflight.mjs"), ...rest];
    const output = execFileSync(process.execPath, childArgs, { cwd: ROOT, env: process.env, encoding: "utf8" });
    process.stdout.write(output); return;
  }
  if (command === "start") {
    const mode = args.mode ?? "live"; const model = args.model ?? DEFAULT_MODEL;
    if (mode === "live") assertCleanWorktree();
    const preflight = mode === "live" ? verifyPreflight(args.preflight, model) : null;
    if (args.matrix === "true" || args.matrix === "free10" || args.matrix === "free10-autonomy-v2") {
      const created = startMatrix({ matrixName: args.matrix === "free10-autonomy-v2" ? "free10-autonomy-v2" : args.matrix === "free10" ? "free10" : "legacy21", mode, model, preflight });
      process.stdout.write(`${JSON.stringify(created.map((entry) => entry.runId), null, 2)}\n`); return;
    }
    const playerPolityId = args.player?.startsWith("polity:") ? args.player : `polity:${args.player ?? "germany"}`;
    const id = args.run ?? `${playerPolityId.slice(7)}-${args.strategy ?? "historical"}`;
    process.stdout.write(`${JSON.stringify(createOne({ id, playerPolityId, strategy: args.strategy ?? "historical", mode, model, preflight }), null, 2)}\n`); return;
  }
  if (command === "status") { process.stdout.write(`${JSON.stringify(loadRun(safeRunId(args.run)).manifest, null, 2)}\n`); return; }
  if (command === "decide") { process.stdout.write(`${JSON.stringify(decide(safeRunId(args.run), args), null, 2)}\n`); return; }
  if (command === "resume") { process.stdout.write(`${JSON.stringify(await resume(safeRunId(args.run)), null, 2)}\n`); return; }
  if (command === "report") { process.stdout.write(`${JSON.stringify(aggregateReport(args["allow-partial"] === "true", args.matrix ?? "legacy21"), null, 2)}\n`); return; }
  throw new Error("usage: campaign-lab preflight|start|status|decide|resume|report --key value ...");
};

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
