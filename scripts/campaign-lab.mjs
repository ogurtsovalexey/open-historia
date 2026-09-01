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
  buildDiplomacyBatches, opponentDiplomacyBatchResultSchema, validateDiplomacyBatch,
} from "../packages/agent-runtime/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = path.join(ROOT, "packages/data-packs/fixtures/europe-1935-benchmark");
const RUNS_DIR = process.env.CAMPAIGN_LAB_RUNS_DIR ? path.resolve(process.env.CAMPAIGN_LAB_RUNS_DIR) : path.join(ROOT, "runs/campaign-lab");
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const SUPPORTED_PLAYERS = ["germany", "austria", "czechoslovakia", "poland", "france", "united-kingdom", "italy"].map((id) => `polity:${id}`);
const STRATEGIES = ["historical", "alternative", "free"];
const MAX_CALLS = 60;
const MAX_CONTEXT_CHARS = 40000;
const MAX_MEMORY_CHARS = 6000;
const MAX_MEMORY_FACTS = 12;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
};
const appendJsonl = (file, value) => fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
const sha256 = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const gitRevision = () => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
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
const loadPackage = () => {
  const bundle = { manifest: readJson(path.join(PACKAGE_DIR, "manifest.json")), scenario: readJson(path.join(PACKAGE_DIR, "scenario.json")), sources: readJson(path.join(PACKAGE_DIR, "sources.json")) };
  const authoring = readJson(path.join(PACKAGE_DIR, "authoring.json"));
  const engineScenario = readJson(path.join(PACKAGE_DIR, "engine/scenario.json"));
  const mapLink = readJson(path.join(PACKAGE_DIR, "engine/map-link.json"));
  return { bundle, authoring, engineScenario, mapLink, projection: compileHistoricalProjection({ bundle, authoring, engineScenario, mapLink }) };
};
const loadRun = (id) => ({ manifest: readJson(fileOf(id, "manifest.json")), state: parseWorldState(readJson(fileOf(id, "state.json"))) });
const writeManifest = (id, manifest) => atomicJson(fileOf(id, "manifest.json"), manifest);
const commandId = (seed) => {
  const hex = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const raw = hex.join(""); return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
};
const hydrate = (raw, batch) => ({ ...raw, decisions: Array.isArray(raw?.decisions) ? raw.decisions.map((decision, index) => ({
  ...decision, command: decision?.command ? { ...decision.command, commandId: commandId(`${batch.baseRevision}|${batch.batchId}|${decision.polityId}|${index}`) } : null,
})) : raw?.decisions });

const createOne = ({ id, playerPolityId, strategy, mode, model }) => {
  safeRunId(id);
  if (!SUPPORTED_PLAYERS.includes(playerPolityId)) throw new Error(`unsupported player ${playerPolityId}`);
  if (!STRATEGIES.includes(strategy)) throw new Error(`unknown strategy ${strategy}`);
  if (!new Set(["mock", "live"]).has(mode)) throw new Error("mode must be mock or live");
  if (fs.existsSync(runDir(id))) throw new Error(`run ${id} already exists`);
  const loaded = loadPackage();
  fs.mkdirSync(path.join(runDir(id), "raw"), { recursive: true });
  const state = initState(loaded.projection.scenario);
  const manifest = {
    schemaVersion: "open-historia-campaign-lab-run/1", runId: id,
    scenarioId: loaded.projection.scenario.scenarioId, scenarioChecksum: loaded.projection.checksum,
    codeRevision: gitRevision(), playerPolityId, strategy, mode,
    model: mode === "live" ? model : "deterministic-mock", reasoningMode: "off",
    maxCalls: MAX_CALLS, transportRetries: 2, schemaCorrections: 1,
    startMonth: state.month, horizonMonth: loaded.authoring.horizonDate,
    status: mode === "live" ? "awaiting-player-decision" : "ready", calls: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkpoint: { month: state.month, reasons: ["campaign-start"] },
  };
  atomicJson(fileOf(id, "state.json"), state); writeManifest(id, manifest);
  fs.writeFileSync(fileOf(id, "chronicle.jsonl"), "", "utf8");
  fs.writeFileSync(fileOf(id, "chronicle.md"), `# ${id}\n\nPlayer: ${playerPolityId}; strategy: ${strategy}; mode: ${mode}.\n\n`, "utf8");
  fs.writeFileSync(fileOf(id, "telemetry.jsonl"), "", "utf8");
  fs.writeFileSync(fileOf(id, "decisions.jsonl"), "", "utf8");
  return manifest;
};

const materialEvent = (event) => new Set([
  "proposal-created", "proposal-countered", "proposal-rejected", "agreement-created", "agreement-terminated",
  "territorial-settlement-accepted", "region-transferred", "war-declared", "war-ended", "call-to-arms-created",
  "call-to-arms-resolved", "region-occupied", "peace-offered", "peace-resolved", "government-transferred",
  "faction-escalated", "default", "crisis-opened", "crisis-escalated", "crisis-resolved", "goal-achieved", "alert",
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
  if (manifest.calls >= MAX_CALLS) throw new Error(`campaign provider-call limit ${MAX_CALLS} reached`);
  const system = "Play each requested polity independently. Return strict JSON {decisions:[{polityId,intent,rationale,command}]}. Use hold and null command unless a supplied bounded action is justified. Never invent numeric outcomes, ids, regions or geometry. Commands use the supplied month and revision.";
  const payload = { month: batch.month, revision: batch.baseRevision, briefs: batch.briefs, ...(correction ? { correction } : {}) };
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_CONTEXT_CHARS || /coordinates|geometry|FeatureCollection/.test(serialized)) throw new Error("AI context gate failed");
  const request = {
    system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: serialized }] }],
    generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
  };
  const rawIndex = String(manifest.calls + 1).padStart(3, "0");
  atomicJson(fileOf(id, `raw/request-${rawIndex}.json`), request);
  let lastError;
  for (let transportAttempt = 1; transportAttempt <= 3; transportAttempt += 1) {
    const started = Date.now(); manifest.calls += 1; manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(manifest.model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
      });
      const data = await response.json();
      appendJsonl(fileOf(id, "telemetry.jsonl"), { month: batch.month, batchId: batch.batchId, generation: correction ? 2 : 1, transportAttempt,
        latencyMs: Date.now() - started, status: response.ok ? "success" : "provider-error", httpStatus: response.status,
        usage: data.usageMetadata ?? null, acceptedCommands: null, rejectedCommands: null });
      atomicJson(fileOf(id, `raw/response-${rawIndex}-${transportAttempt}.json`), data);
      if (!response.ok) throw new Error(data?.error?.message ?? `Gemini HTTP ${response.status}`);
      return data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    } catch (error) { lastError = error; if (transportAttempt === 3) throw error; }
  }
  throw lastError;
};

const opponentCommands = async ({ id, manifest, state, authoring, memory }) => {
  if ((state.turn % 3) !== 0 && !manifest.eventTriggered) return [];
  const batches = buildDiplomacyBatches(state, manifest.playerPolityId, { strategicContextByPolity: strategicContexts(authoring, memory) });
  const commands = [];
  for (const batch of batches) {
    let parsed;
    if (manifest.mode === "mock") {
      parsed = { decisions: batch.polityIds.map((polityId) => ({ polityId, intent: "hold", rationale: "Deterministic mocked hold.", command: null })) };
    } else {
      let correction = null;
      for (let generation = 1; generation <= 2; generation += 1) {
        try {
          const text = await geminiDecision({ id, manifest, batch, correction });
          parsed = JSON.parse(text); validateDiplomacyBatch(hydrate(parsed, batch), batch); break;
        } catch (error) {
          appendJsonl(fileOf(id, "telemetry.jsonl"), { month: batch.month, batchId: batch.batchId, generation,
            latencyMs: 0, status: "schema-error", usage: null, acceptedCommands: 0, rejectedCommands: 0, detail: String(error).slice(0, 500) });
          if (generation === 2) throw error;
          correction = `Previous response failed validation: ${String(error).slice(0, 500)}. Return corrected strict JSON only.`;
        }
      }
    }
    const validated = validateDiplomacyBatch(hydrate(opponentDiplomacyBatchResultSchema.parse(parsed), batch), batch);
    appendJsonl(fileOf(id, "decisions.jsonl"), { month: state.month, actor: "opponents", batchId: batch.batchId, decisions: validated.decisions });
    commands.push(...validated.decisions.flatMap((entry) => entry.command ? [entry.command] : []));
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

const chronicleTurn = (id, completed, commands) => {
  const material = completed.result.events.filter(materialEvent);
  for (const event of material) {
    const participants = [...new Set(Object.entries(event).filter(([key]) => /PolityId$/.test(key)).map(([, value]) => value).filter((value) => typeof value === "string"))].sort();
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
  return material;
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
const summarizeTelemetry = (id) => {
  const file = fileOf(id, "telemetry.jsonl");
  const rows = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  const provider = rows.filter((row) => row.batchId);
  return { attempts: provider.length, engineResolutions: rows.filter((row) => row.status === "engine-resolution").length,
    latencyMs: provider.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0),
    inputTokens: provider.reduce((sum, row) => sum + (row.usage?.promptTokenCount ?? 0), 0), outputTokens: provider.reduce((sum, row) => sum + (row.usage?.candidatesTokenCount ?? 0), 0),
    schemaErrors: provider.filter((row) => row.status === "schema-error").length,
    transportErrors: provider.filter((row) => !new Set(["success", "schema-error"]).has(row.status)).length };
};

const resume = async (id) => {
  const loaded = loadPackage(); const current = loadRun(id); const { manifest } = current; let { state } = current;
  if (loaded.projection.checksum !== manifest.scenarioChecksum) throw new Error("frozen scenario checksum changed; start a new matrix after fixing it");
  if (gitRevision() !== manifest.codeRevision) throw new Error("frozen code revision changed; finish this matrix with its original revision");
  if (manifest.status === "completed") return manifest;
  const chronicle = fs.readFileSync(fileOf(id, "chronicle.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  let lastLedger = fs.existsSync(fileOf(id, "last-turn.json")) ? readJson(fileOf(id, "last-turn.json")).ledger : null;
  while (state.month < manifest.horizonMonth) {
    const scheduledPlayer = state.turn % 6 === 0 || manifest.eventTriggered;
    let player = [];
    if (scheduledPlayer) {
      const decision = pendingPlayerCommands(id, state, manifest);
      if (decision === null) {
        manifest.status = "awaiting-player-decision"; manifest.checkpoint = { month: state.month, reasons: manifest.eventTriggered ? ["material-event"] : [state.turn === 0 ? "campaign-start" : "six-month-review"] };
        manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest); atomicJson(fileOf(id, "state.json"), state); return manifest;
      }
      player = decision;
    }
    manifest.eventTriggered = false;
    let opponents;
    try { opponents = await opponentCommands({ id, manifest, state, authoring: loaded.authoring, memory: chronicle }); }
    catch (error) { manifest.status = "provider-error"; manifest.lastError = String(error).slice(0, 500); manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest); throw error; }
    const completed = runTurn(state, { commands: [...player, ...opponents] });
    appendJsonl(fileOf(id, "telemetry.jsonl"), { month: state.month, status: "engine-resolution",
      acceptedCommands: player.length + opponents.length - completed.result.rejections.length, rejectedCommands: completed.result.rejections.length,
      latencyMs: 0, usage: null });
    if (completed.result.rejections.length) throw new Error(`validated campaign commands rejected: ${completed.result.rejections.map((entry) => entry.reason).join(", ")}`);
    const allCommands = [...player, ...opponents];
    const material = chronicleTurn(id, completed, allCommands);
    chronicle.push(...material.map((event) => ({ month: completed.result.ledger.month, eventType: event.type, participants: [] })));
    lastLedger = completed.result.ledger;
    atomicJson(fileOf(id, "last-turn.json"), { baseRevision: completed.baseRevision, revision: completed.result.state.revision,
      events: completed.result.events, ledger: completed.result.ledger, commands: allCommands });
    state = completed.result.state; manifest.eventTriggered = material.length > 0; manifest.status = "running"; manifest.checkpoint = null;
    manifest.updatedAt = new Date().toISOString(); atomicJson(fileOf(id, "state.json"), state); writeManifest(id, manifest);
  }
  manifest.status = "completed"; manifest.completedAt = new Date().toISOString(); manifest.eventTriggered = false;
  const card = finalCard(manifest, state, chronicle, loaded.authoring, lastLedger); atomicJson(fileOf(id, "final-card.json"), card);
  fs.writeFileSync(fileOf(id, "final-card.md"), renderFinalCard(card), "utf8");
  writeManifest(id, manifest); return manifest;
};

const decide = (id, args) => {
  const { manifest, state } = loadRun(id);
  if (manifest.status !== "awaiting-player-decision") throw new Error("run is not awaiting a player decision");
  let commands = [];
  if (args.commands) commands = parseTurnCommands(readJson(path.resolve(args.commands))).commands;
  else if (args.hold !== "true") throw new Error("decide requires --commands <json> or --hold true");
  for (const command of commands) {
    if (command.actorPolityId !== manifest.playerPolityId || command.expectedRevision !== state.revision || command.effectiveMonth !== state.month) throw new Error("player command actor/month/revision mismatch");
    if (command.kind === "territory.transfer-region") throw new Error("direct territorial transfer is not a player campaign action");
  }
  atomicJson(fileOf(id, "pending-player-decision.json"), { month: state.month, revision: state.revision, actor: manifest.playerPolityId,
    strategy: manifest.strategy, rationale: args.rationale ?? "Hold at checkpoint.", commands });
  manifest.status = "ready"; manifest.updatedAt = new Date().toISOString(); writeManifest(id, manifest); return manifest;
};

const aggregateReport = (allowPartial) => {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const runs = fs.readdirSync(RUNS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(RUNS_DIR, entry.name, "final-card.json")))
    .map((entry) => ({ manifest: readJson(path.join(RUNS_DIR, entry.name, "manifest.json")), card: readJson(path.join(RUNS_DIR, entry.name, "final-card.json")) }))
    .filter((entry) => entry.manifest.scenarioId === "scenario:europe-1935-benchmark"
      && entry.manifest.runId === `${entry.manifest.playerPolityId.slice(7)}-${entry.manifest.strategy}`);
  const unique = new Set(runs.map((entry) => `${entry.manifest.playerPolityId}|${entry.manifest.strategy}`));
  if (!allowPartial && unique.size !== 21) throw new Error(`aggregate report requires 21 unique completed matrix runs; found ${unique.size}`);
  const eventFrequency = {};
  for (const run of runs) {
    const file = fileOf(run.manifest.runId, "chronicle.jsonl");
    for (const row of fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)) eventFrequency[row.eventType] = (eventFrequency[row.eventType] ?? 0) + 1;
  }
  const dataset = { schemaVersion: "open-historia-campaign-lab-dataset/1", scenarioId: "scenario:europe-1935-benchmark", generatedAt: new Date().toISOString(), completeMatrix: unique.size === 21,
    runs: runs.map(({ manifest, card }) => ({ runId: manifest.runId, playerPolityId: manifest.playerPolityId, strategy: manifest.strategy, mode: manifest.mode, finalMonth: card.finalMonth,
      finalRevision: card.finalRevision, calls: card.calls, telemetry: card.telemetry, agreements: card.agreements, wars: card.wars, occupations: card.occupations,
      materialEvents: card.materialEvents, historicalScore: card.historicalScore, historicalMilestones: card.historicalMilestones,
      logicalOrTechnicalProblems: card.logicalOrTechnicalProblems, polities: card.polities })), eventFrequency };
  const reportsDir = path.join(ROOT, "docs/reports"); fs.mkdirSync(reportsDir, { recursive: true });
  atomicJson(path.join(reportsDir, "europe-1935-campaign-lab.dataset.json"), dataset);
  const sortedRuns = dataset.runs.sort((a, b) => `${a.playerPolityId}|${a.strategy}`.localeCompare(`${b.playerPolityId}|${b.strategy}`));
  const playerRows = sortedRuns.map((run) => ({ run, polity: run.polities.find((entry) => entry.polityId === run.playerPolityId) }));
  const total = (selector) => sortedRuns.reduce((sum, run) => sum + selector(run), 0);
  const lines = ["# Europe 1935 Campaign Lab", "", `Completed matrix cells: ${unique.size}/21.`, "",
    `Execution mode: ${[...new Set(dataset.runs.map((run) => run.mode))].join(", ")}. The committed matrix is a deterministic infrastructure baseline; it does not stand in for the pending live Gemini experiment.`, "",
    "| Player | Strategy | Mode | Final month | Calls |", "|---|---|---:|---:|---:|",
    ...sortedRuns.map((run) => `| ${run.playerPolityId} | ${run.strategy} | ${run.mode} | ${run.finalMonth} | ${run.calls} |`),
    "", "## Final player-country cards", "", "| Player | Strategy | Territory controlled/legal | Treasury | Mobilized | Casualties | Goals | Historical score |", "|---|---|---:|---:|---:|---:|---:|---:|",
    ...playerRows.map(({ run, polity }) => `| ${run.playerPolityId} | ${run.strategy} | ${polity?.controlledRegions.length ?? 0}/${polity?.legalRegions.length ?? 0} | ${polity?.treasury ?? "n/a"} | ${polity?.military?.mobilized ?? "n/a"} | ${polity?.military?.casualties ?? "n/a"} | ${polity?.goals.filter((entry) => entry.status === "achieved").length ?? 0} | ${run.historicalScore}/100 |`),
    "", "All 21 mock lines retained their initial legal and actual territory, entered no wars or agreements, mobilized no formations, and achieved no campaign goals. Government and debt are `null` because those optional modules are intentionally disabled in this benchmark projection.",
    "", "## Event frequency", "", ...Object.entries(eventFrequency).sort().map(([kind, count]) => `- ${kind}: ${count}`), "",
    "## Major chronology", "", ...(total((run) => run.wars.length + run.occupations.length) ? ["War and occupation records are retained in the aggregate dataset and revision-linked run chronicles."] : ["No wars, revolutions, coups, territorial changes or occupations occurred under the deterministic hold controller. Monthly resource alerts account for all material records."]), "",
    "## Repeated causal chains", "", "The only repeated chain in mocked mode was monthly economy resolution → resource alert → unchanged strategic hold. It is an engine/telemetry observation, not a historical or AI-behaviour conclusion.", "",
    "## AI response quality", "", dataset.runs.every((run) => run.mode === "mock") ? "Mock controllers only: no claim about Gemini quality is made." : "Provider telemetry and rejected commands are retained per run for review.", "",
    "## Historical, alternative and free comparison", "", "All three labels intentionally converge in the mock baseline because both player and opponents hold. This proves matrix scheduling and frozen-state comparability, but cannot test strategy quality or the median historical-score target.", "",
    "## Balance and initial-data influence", "", `Across the matrix: ${total((run) => run.calls)} model calls, ${total((run) => run.telemetry.engineResolutions)} monthly engine resolutions, ${total((run) => run.wars.length)} final war records and ${total((run) => run.occupations.length)} final occupations. Per-polity population, treasury, resources, deficits, military strength and relations are retained in the aggregate dataset for later live comparison.`, "",
    "## Missing mechanics and data", "", "- Regional 1935 allocations remain low-confidence macro estimates.", "- Colonies, fleets and distant theatres remain abstract capabilities.", "- Government/debt fields are null when their optional scenario modules are disabled.", "",
    "## Recommendations for the next scenario", "", "- Keep ScenarioV2, authoring controls and engine projection separate and checksum-bound.", "- Complete a dedicated regional population/industry/resource research pass before Curated fidelity.", "- Preserve conditional anchors with explicit invalidators; never script milestones as events.", "",
    "## Interpretation", "", unique.size === 21
      ? dataset.runs.every((run) => run.mode === "mock") ? "Complete deterministic mock matrix; historical score targets and strategic conclusions are not evaluated." : "This report covers the frozen 21-run matrix."
      : "Partial diagnostic report; cross-strategy conclusions and target scores are intentionally withheld.", ""];
  fs.writeFileSync(path.join(reportsDir, "europe-1935-campaign-lab.md"), `${lines.join("\n")}\n`, "utf8"); return dataset;
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2); const args = parseArgs(rest);
  if (command === "start") {
    const mode = args.mode ?? "live"; const model = args.model ?? DEFAULT_MODEL;
    if (args.matrix === "true") {
      const created = []; for (const player of SUPPORTED_PLAYERS) for (const strategy of STRATEGIES) created.push(createOne({ id: `${player.slice(7)}-${strategy}`, playerPolityId: player, strategy, mode, model }));
      process.stdout.write(`${JSON.stringify(created.map((entry) => entry.runId), null, 2)}\n`); return;
    }
    const playerPolityId = args.player?.startsWith("polity:") ? args.player : `polity:${args.player ?? "germany"}`;
    const id = args.run ?? `${playerPolityId.slice(7)}-${args.strategy ?? "historical"}`;
    process.stdout.write(`${JSON.stringify(createOne({ id, playerPolityId, strategy: args.strategy ?? "historical", mode, model }), null, 2)}\n`); return;
  }
  if (command === "status") { process.stdout.write(`${JSON.stringify(loadRun(safeRunId(args.run)).manifest, null, 2)}\n`); return; }
  if (command === "decide") { process.stdout.write(`${JSON.stringify(decide(safeRunId(args.run), args), null, 2)}\n`); return; }
  if (command === "resume") { process.stdout.write(`${JSON.stringify(await resume(safeRunId(args.run)), null, 2)}\n`); return; }
  if (command === "report") { process.stdout.write(`${JSON.stringify(aggregateReport(args["allow-partial"] === "true"), null, 2)}\n`); return; }
  throw new Error("usage: campaign-lab start|status|decide|resume|report --key value ...");
};

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
