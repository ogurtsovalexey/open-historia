import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { GAMEPLAY_SCHEMAS, GAMEPLAY_TOOLS, validateGameplayPayload } from "../src/Game/AI/gameplaySchemas.js";
import { getAllTaskDefinitions } from "../src/Game/AI/aiCallRegistry.js";
import {
  canonicalizeGeminiContents, fitGeminiFunctionSchema, getGeminiHeaders, getGeminiThinkingConfig, getGeminiUrl,
} from "../src/Game/AI/geminiProtocol.js";
import {
  opponentBatchResultSchema, playerOrderInterpretationSchema, playerReportResultSchema, strategicDecisionBatchV2Schema,
} from "../packages/agent-runtime/dist/index.js";
import { CAMPAIGN_DECISION_RESPONSE_SCHEMA, encodeCampaignDecisionWire, normalizeCampaignDecisionWire } from "./lib/campaign-lab-contract.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const gitRevision = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const parseArgs = (values) => Object.fromEntries(values.reduce((rows, value, index) => {
  if (index % 2 === 0) {
    if (!value.startsWith("--") || values[index + 1] === undefined) throw new Error(`invalid argument ${value}`);
    rows.push([value.slice(2), values[index + 1]]);
  }
  return rows;
}, []));
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exampleFromSchema = (schema, pathParts = []) => {
  if (Array.isArray(schema?.anyOf)) return exampleFromSchema(schema.anyOf.find((entry) => entry.type !== "null") ?? schema.anyOf[0], pathParts);
  if (Array.isArray(schema?.enum)) return schema.enum[0];
  if (schema?.type === "object" || schema?.properties) return Object.fromEntries((schema.required ?? []).map((key) =>
    [key, exampleFromSchema(schema.properties?.[key] ?? {}, [...pathParts, key])]));
  if (schema?.type === "array") return Array.from({ length: schema.minItems ?? 0 }, (_, index) => exampleFromSchema(schema.items ?? {}, [...pathParts, String(index)]));
  if (schema?.type === "boolean") return false;
  if (schema?.type === "integer" || schema?.type === "number") return Number.isFinite(schema.minimum) ? schema.minimum : 1;
  if (schema?.type === "string") return pathParts.at(-1)?.toLowerCase().includes("date") ? "1938-01-01" : "probe";
  if (schema?.type === "null") return null;
  return null;
};
const gameplayExample = (taskKey, schema) => {
  const value = exampleFromSchema(schema);
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) Object.assign(value, { stopDate: "1938-02-01", summary: "Probe summary." });
  if (taskKey === "catalystCreation") value.choices = ["First", "Second"];
  if (taskKey === "catalystExecutor") Object.assign(value, { resolved: true, nextChoices: [] });
  if (taskKey === "countryStatSheet") value.gdpBreakdown = { agriculture: 34, industry: 33, services: 33 };
  return value;
};
const functionDeclaration = (name, description, schema) => ({
  tools: [{ functionDeclarations: [{ name, description, parameters: fitGeminiFunctionSchema(schema) }] }],
  toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [name] } },
});
const responseText = (data) => (data?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
const functionArgs = (data, name) => (data?.candidates?.[0]?.content?.parts ?? []).find((part) => part.functionCall?.name === name)?.functionCall?.args ?? null;

const makeClient = ({ apiKey, model, records, persist, markFailure }) => {
  let lastStartedAt = 0;
  const generate = async ({ name, contents, generationConfig = {}, extra = {}, stream = false }) => {
    const body = { contents: canonicalizeGeminiContents(contents), generationConfig: { maxOutputTokens: 8192, ...generationConfig }, ...extra };
    if (/coordinates|FeatureCollection|"geometry"/.test(JSON.stringify(body))) throw new Error(`${name}: geometry entered the prompt`);
    const waitMs = Math.max(0, 6_000 - (Date.now() - lastStartedAt));
    if (waitMs) await sleep(waitMs);
    const started = Date.now(); lastStartedAt = started;
    const response = await fetch(getGeminiUrl(model, { stream }), { method: "POST", headers: getGeminiHeaders(apiKey), body: JSON.stringify(body) });
    const raw = await response.text();
    if (!response.ok) {
      records.push({ name, httpStatus: response.status, latencyMs: Date.now() - started, usageMetadata: null, status: "provider-error" });
      markFailure(response.status, `${name}: Gemini HTTP ${response.status}`);
      persist();
      throw new Error(`${name}: Gemini HTTP ${response.status}: ${raw.slice(0, 300)}`);
    }
    if (stream) {
      const chunks = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5).trim())).filter(Boolean);
      const usage = chunks.map((entry) => entry.usageMetadata).find(Boolean);
      if (!usage?.totalTokenCount) throw new Error(`${name}: streaming usageMetadata missing`);
      records.push({ name, httpStatus: response.status, latencyMs: Date.now() - started, usageMetadata: usage });
      persist();
      return { data: chunks.at(-1), text: chunks.map(responseText).join(""), usage };
    }
    const data = JSON.parse(raw);
    if (!data.usageMetadata?.totalTokenCount) throw new Error(`${name}: usageMetadata missing`);
    records.push({ name, httpStatus: response.status, latencyMs: Date.now() - started, usageMetadata: data.usageMetadata });
    persist();
    return { data, text: responseText(data), usage: data.usageMetadata };
  };
  return { generate };
};

const registryContracts = () => getAllTaskDefinitions().map((task) => ({
  taskId: task.taskId, kind: task.kind, transport: task.kind === "structured" ? "function-or-json" : "text",
  schemaContract: task.outputContractId ?? "text-only", modelRole: task.modelRole,
}));

const main = async () => {
  const args = parseArgs(process.argv.slice(2)); const model = args.model ?? DEFAULT_MODEL;
  const suite = args.suite ?? "primary"; const live = args.live !== "false";
  const output = path.resolve(args.output ?? path.join(ROOT, "runs/gemini-preflight", `${model}-${suite}.json`));
  const gameplay = Object.entries(GAMEPLAY_TOOLS).map(([taskKey, tool]) => {
    const example = gameplayExample(taskKey, GAMEPLAY_SCHEMAS[taskKey]); const validation = validateGameplayPayload(taskKey, example);
    if (!validation.valid) throw new Error(`${taskKey} generated fixture is invalid: ${validation.error}`);
    return { taskKey, toolName: tool.name, example };
  });
  const engineSchemas = {
    playerInterpreter: playerOrderInterpretationSchema,
    opponentEconomy: opponentBatchResultSchema,
    opponentStrategy: strategicDecisionBatchV2Schema,
    playerReport: playerReportResultSchema,
  };
  const registry = registryContracts();
  if (registry.length !== 25 || registry.some((entry) => !entry.transport || !entry.schemaContract)) throw new Error("AI registry contract inventory is incomplete");
  const result = { schemaVersion: "open-historia-gemini-preflight/1", createdAt: new Date().toISOString(), codeRevision: gitRevision(), model, suite,
    promptVersions: { geminiWire: "gemini-wire/2", gameplayTools: "GAMEPLAY_TOOLS/current", engineAgent: "agent-runtime/current" },
    status: live ? "running" : "offline-pass", geometryIncluded: false,
    inventory: { gameplayTools: gameplay.map(({ taskKey, toolName }) => ({ taskKey, toolName })), gameplayToolCount: gameplay.length,
      planExpectedGameplayToolCount: 14, inventoryNote: gameplay.length === 14 ? null : `GAMEPLAY_TOOLS currently exports ${gameplay.length}, not 14.`,
      engineAgentSchemas: Object.keys(engineSchemas), registry }, probes: [] };
  if (!live) { atomicJson(output, result); process.stdout.write(`${JSON.stringify({ ...result, output }, null, 2)}\n`); return; }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) { result.status = "skipped-no-key"; atomicJson(output, result); process.stdout.write(`${JSON.stringify({ ...result, output }, null, 2)}\n`); return; }
  const metadataResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { headers: getGeminiHeaders(apiKey) });
  const metadata = await metadataResponse.json();
  if (!metadataResponse.ok) throw new Error(`model discovery failed: ${metadata?.error?.message ?? metadataResponse.status}`);
  result.metadata = { name: metadata.name, inputTokenLimit: metadata.inputTokenLimit, outputTokenLimit: metadata.outputTokenLimit,
    supportedGenerationMethods: metadata.supportedGenerationMethods };
  atomicJson(output, result);
  const client = makeClient({ apiKey, model, records: result.probes, persist: () => atomicJson(output, result),
    markFailure: (status, error) => { result.status = status === 429 ? "quota-paused" : "failed"; result.lastError = error; } });
  const user = (text) => [{ role: "user", parts: [{ text }] }];
  const minimal = getGeminiThinkingConfig(model, { reasoningMode: "minimal" });
  const buffered = await client.generate({ name: "buffered-text", contents: user("Reply with exactly PREFLIGHT_OK."), generationConfig: { thinkingConfig: minimal } });
  if (!/PREFLIGHT_OK/.test(buffered.text)) throw new Error("buffered text checkpoint returned unexpected content");
  const streamed = await client.generate({ name: "sse-streaming", contents: user("Reply with exactly STREAM_OK."), generationConfig: { thinkingConfig: minimal }, stream: true });
  if (!/STREAM_OK/.test(streamed.text)) throw new Error("SSE checkpoint returned unexpected content");
  const jsonMime = await client.generate({ name: "json-mime", contents: user('Return exactly the JSON object {"ok":true} and nothing else.'), generationConfig: { responseMimeType: "application/json", thinkingConfig: minimal } });
  if (JSON.parse(jsonMime.text).ok !== true) throw new Error("JSON MIME checkpoint failed semantic validation");
  const genericTool = { name: "submit_probe", description: "Submit the probe result.", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };
  const toolResult = await client.generate({ name: "function-calling", contents: user('Call submit_probe with {"ok":true}.'), generationConfig: { thinkingConfig: minimal }, extra: functionDeclaration(genericTool.name, genericTool.description, genericTool.schema) });
  if (functionArgs(toolResult.data, genericTool.name)?.ok !== true) throw new Error("generic function call payload failed");
  const multiTurn = await client.generate({ name: "multi-turn-history", contents: [
    { role: "user", parts: [{ text: "Remember code ALPHA." }, { text: "" }] }, { role: "model", parts: [{ text: "Remembered." }] },
    { role: "user", parts: [{ text: "What was the code? Reply with the code only." }] },
  ], generationConfig: { thinkingConfig: minimal } });
  if (!/ALPHA/i.test(multiTurn.text)) throw new Error("multi-turn history checkpoint lost the supplied fact");
  if (suite === "primary") {
    const corrected = await client.generate({ name: "correction-turn", contents: [
    { role: "user", parts: [{ text: "Return the invalid token NOT_JSON." }] }, { role: "model", parts: [{ text: "NOT_JSON" }] },
    { role: "user", parts: [{ text: 'Correction: return only {"corrected":true}.' }] },
    ], generationConfig: { responseMimeType: "application/json", thinkingConfig: minimal } });
    if (JSON.parse(corrected.text).corrected !== true) throw new Error("correction checkpoint failed semantic validation");
    const campaignIds = ["polity:austria", "polity:france"];
    const campaignExpected = { decisions: campaignIds.map((polityId) => encodeCampaignDecisionWire({ polityId,
      objective: { domain: "campaign", summary: "Preserve flexibility.", horizon: "short" }, actions: [{ tool: "conserve" }],
      futurePlan: [], contingency: "Reassess after new evidence.", rationale: "Bounded typed hold.",
      hold: { reason: "plan-sequencing", detail: "Wait for a material trigger.", revisit: { afterMonths: 1, triggers: ["resource-deficit"] } },
    })) };
    const campaignJson = await client.generate({ name: "campaign-lab-json-schema",
      contents: user(`Return exactly this decision batch: ${JSON.stringify(campaignExpected)}`),
      generationConfig: { responseMimeType: "application/json", responseSchema: CAMPAIGN_DECISION_RESPONSE_SCHEMA, thinkingConfig: minimal } });
    const campaignParsed = strategicDecisionBatchV2Schema.parse(normalizeCampaignDecisionWire(JSON.parse(campaignJson.text)));
    if (campaignParsed.decisions.map((decision) => decision.polityId).join("|") !== campaignIds.join("|")) throw new Error("Campaign Lab JSON schema checkpoint changed polity IDs");
    const familyActions = [
      ["economy", { tool: "reallocate-production", targetRegionId: "region:probe:DE", priority: "raw-materials", scale: "medium" }],
      ["trade", { tool: "negotiate-trade", partner: "polity:partner", resource: "iron", desiredRunway: "medium", budgetAttitude: "urgent" }],
      ["diplomacy", { tool: "propose-agreement", partner: "polity:partner", agreementType: "non-aggression" }],
      ["statecraft", { tool: "start-project", templateId: "project-template:probe", scale: "medium", targetRegionId: "region:probe:DE" }],
      ["politics", { tool: "respond-faction", factionId: "faction:probe", response: "concede" }],
      ["military", { tool: "mobilize", locationRegionId: "region:probe:DE", scale: "small" }],
    ];
    for (const [family, action] of familyActions) {
      const expected = { decisions: [encodeCampaignDecisionWire({ polityId: "polity:probe", objective: { domain: family === "trade" ? "economy" : family, summary: `Exercise ${family} tools.`, horizon: "short" },
        actions: [action], futurePlan: [], contingency: "Use another supported tool.", rationale: "Non-hold preflight probe.", hold: null })] };
      const probe = await client.generate({ name: `strategic-family:${family}`, contents: user(`Return exactly this non-hold StrategicDecisionV2 batch: ${JSON.stringify(expected)}`),
        generationConfig: { responseMimeType: "application/json", responseSchema: CAMPAIGN_DECISION_RESPONSE_SCHEMA, thinkingConfig: minimal } });
      const parsed = strategicDecisionBatchV2Schema.parse(normalizeCampaignDecisionWire(JSON.parse(probe.text)));
      if (parsed.decisions[0]?.actions[0]?.tool !== action.tool) throw new Error(`${family} strategic family probe returned hold or the wrong tool`);
    }
  }
  for (const level of suite === "primary" ? ["minimal", "low", "medium"] : ["low", "medium"]) {
    const reasoned = await client.generate({ name: `reasoning-${level}`,
      contents: user("Reply with exactly OK."), generationConfig: { thinkingConfig: getGeminiThinkingConfig(model, { reasoningMode: level }) } });
    if (!/\bOK\b/.test(reasoned.text)) throw new Error(`reasoning-${level} checkpoint returned unexpected content`);
  }
  if (suite === "primary") {
    for (const entry of gameplay) {
      const tool = GAMEPLAY_TOOLS[entry.taskKey];
      const response = await client.generate({ name: `gameplay-tool:${entry.taskKey}`,
        contents: user(`Call ${tool.name} with exactly this JSON: ${JSON.stringify(entry.example)}`),
        generationConfig: { thinkingConfig: minimal }, extra: functionDeclaration(tool.name, tool.description, tool.schema) });
      const validation = validateGameplayPayload(entry.taskKey, functionArgs(response.data, tool.name));
      if (!validation.valid) throw new Error(`${entry.taskKey}: ${validation.error}`);
    }
    for (const [name, schema] of Object.entries(engineSchemas)) {
      const jsonSchema = z.toJSONSchema(schema); const example = exampleFromSchema(jsonSchema);
      const toolName = `submit_${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
      const response = await client.generate({ name: `engine-schema:${name}`, contents: user(`Call ${toolName} with exactly ${JSON.stringify(example)}`),
        generationConfig: { thinkingConfig: minimal }, extra: functionDeclaration(toolName, `Submit ${name}.`, jsonSchema) });
      schema.parse(functionArgs(response.data, toolName));
    }
  }
  result.status = "pass"; result.completedAt = new Date().toISOString();
  atomicJson(output, result); process.stdout.write(`${JSON.stringify({ ...result, output }, null, 2)}\n`);
};

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
