import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CODEX_SUBSCRIPTION_PROVIDER = "codex-subscription";
export const CODEX_TESTED_MODELS = Object.freeze([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]);

const APP_SERVER_TIMEOUT_MS = 15_000;
const STRUCTURED_TURN_TIMEOUT_MS = 10 * 60_000;
export const CODEX_STRATEGIC_CONTRACT = "StrategicBriefV4+StrategicDecisionV3";

export function sanitizeCodexProviderEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) => {
    if (value === undefined) return false;
    return !/^(OPENAI|GEMINI|GOOGLE_API|ANTHROPIC|AZURE_OPENAI|AWS_|MISTRAL|COHERE|DEEPSEEK|XAI|GROQ|TOGETHER|HF_)/i.test(name)
      && !/(API_KEY|ACCESS_KEY|SECRET_KEY|AUTH_TOKEN)$/i.test(name);
  }));
}

export function codexAppServerArgs() {
  return [
    "app-server", "--stdio",
    "--config", 'forced_login_method="chatgpt"',
    "--config", "features.plugins=false",
    "--config", "features.apps=false",
    "--config", "features.multi_agent=false",
    "--config", "mcp_servers={}",
  ];
}

export function hasChatGptLogin({ spawnSyncImpl = spawnSync, environment = process.env } = {}) {
  const result = spawnSyncImpl("codex", ["login", "status", "--config", 'forced_login_method="chatgpt"'], {
    encoding: "utf8",
    env: sanitizeCodexProviderEnvironment(environment),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return false;
  return /logged in using chatgpt/i.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

export function normalizeCodexModelCatalog(raw) {
  if (!raw || !Array.isArray(raw.data)) throw new Error("Codex model/list returned no model catalog");
  const tested = new Set(CODEX_TESTED_MODELS);
  return raw.data.map((entry) => {
    const id = String(entry?.model ?? entry?.id ?? "").trim();
    if (!id) throw new Error("Codex model/list returned a model without an id");
    const efforts = Array.isArray(entry.supportedReasoningEfforts)
      ? entry.supportedReasoningEfforts.map((option) => String(option?.reasoningEffort ?? "").trim()).filter(Boolean)
      : [];
    return {
      id,
      displayName: String(entry.displayName ?? id),
      description: String(entry.description ?? ""),
      hidden: entry.hidden === true,
      isDefault: entry.isDefault === true,
      defaultEffort: efforts.includes(entry.defaultReasoningEffort) ? entry.defaultReasoningEffort : "medium",
      supportedEfforts: efforts,
      badge: tested.has(id) ? "tested" : "unverified",
    };
  }).sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.id.localeCompare(right.id));
}

export function strategicDecisionV3JsonSchema() {
  const string = (maxLength) => ({ type: "string", minLength: 1, ...(maxLength ? { maxLength } : {}) });
  const array = (items, maxItems, minItems) => ({
    ...(minItems ? { minItems } : {}), ...(maxItems ? { maxItems } : {}), type: "array", items,
  });
  const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const hold = object({
    reason: { type: "string", enum: ["no-legal-action", "waiting-response", "insufficient-resources", "plan-sequencing", "risk-too-high", "mandatory-overflow", "stale"] },
    detail: string(320),
    revisitAfterMonths: { type: "integer", minimum: 1, maximum: 12 },
  });
  return object({
    polityId: string(),
    revision: string(),
    objective: object({
      domain: { type: "string", enum: ["economy", "diplomacy", "politics", "military", "statecraft", "campaign"] },
      summary: string(320),
      horizon: { type: "string", enum: ["short", "medium", "long"] },
    }),
    selectedChoices: array(object({
      choiceId: string(), purpose: string(240), evidenceIds: array(string(), 12, 1), expectedConsequence: string(320),
    }), 10),
    triggerCoverage: array(object({ triggerId: string(), choiceIds: array(string(), 1, 1) }), 32),
    rejectedChoices: array(object({ choiceId: string(), reason: string(240) }), 3),
    durablePlan: object({ objective: string(320), futureSteps: array(string(240), 8), commitments: array(string(240), 8) }),
    contingency: string(500),
    hold: { anyOf: [hold, { type: "null" }] },
  });
}

export function strategicDecisionSchemaForBrief(brief) {
  const schema = strategicDecisionV3JsonSchema();
  const choiceIds = brief.choices.map((entry) => entry.choiceId);
  const evidenceIds = [...new Set([
    ...brief.choices.map((entry) => entry.evidenceId),
    ...brief.triggers.flatMap((entry) => [entry.triggerId, ...entry.evidenceIds]),
    ...brief.ownIntelligence.map((entry) => entry.evidenceId),
  ])];
  schema.properties.polityId = { type: "string", enum: [brief.actor.id] };
  schema.properties.revision = { type: "string", enum: [brief.revision] };
  schema.properties.selectedChoices.items.properties.choiceId = { type: "string", enum: choiceIds };
  schema.properties.selectedChoices.items.properties.evidenceIds.items = { type: "string", enum: evidenceIds };
  schema.properties.rejectedChoices.items.properties.choiceId = { type: "string", enum: choiceIds };
  schema.properties.rejectedChoices.minItems = brief.choices.length > 1 ? 1 : 0;
  if (brief.triggers.length) {
    schema.properties.triggerCoverage.items.properties.triggerId = {
      type: "string", enum: brief.triggers.map((entry) => entry.triggerId),
    };
  }
  schema.properties.triggerCoverage.items.properties.choiceIds.items = { type: "string", enum: choiceIds };
  return schema;
}

const safeModel = (value) => {
  const model = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(model)) throw new Error("Invalid Codex model id");
  return model;
};

const safeEffort = (value) => {
  const effort = String(value ?? "medium").trim();
  if (!new Set(["low", "medium", "high", "xhigh", "max", "ultra"]).has(effort)) throw new Error("Invalid Codex reasoning effort");
  return effort;
};

export function codexStructuredExecArgs({ cwd, schemaPath, outputPath, model, effort }) {
  return [
    "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--json",
    "--output-schema", schemaPath, "--output-last-message", outputPath, "--cd", cwd, "--sandbox", "read-only",
    "--model", safeModel(model),
    "--config", 'forced_login_method="chatgpt"',
    "--config", `model_reasoning_effort="${safeEffort(effort)}"`,
    "--config", 'model_verbosity="low"',
    "--config", "features.fast_mode=false",
    "--config", "features.plugins=false",
    "--config", "features.apps=false",
    "--config", "features.multi_agent=false",
    "--config", "mcp_servers={}",
    "-",
  ];
}

export function invokeCodexStructured({
  prompt,
  schema,
  model,
  effort = "medium",
  spawnImpl = spawn,
  timeoutMs = STRUCTURED_TURN_TIMEOUT_MS,
  environment = process.env,
} = {}) {
  if (!prompt || typeof prompt !== "string") throw new Error("Codex prompt must be a non-empty string");
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-codex-provider-"));
  const schemaPath = path.join(workingDirectory, "output-schema.json");
  const outputPath = path.join(workingDirectory, "last-message.json");
  fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  const args = codexStructuredExecArgs({ cwd: workingDirectory, schemaPath, outputPath, model, effort });
  return new Promise((resolve, reject) => {
    const child = spawnImpl("codex", args, {
      cwd: workingDirectory,
      env: sanitizeCodexProviderEnvironment(environment),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => fs.rmSync(workingDirectory, { recursive: true, force: true });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
      cleanup();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Codex schema transport timed out"));
    }, timeoutMs);
    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(`Codex schema transport failed (code ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const response = JSON.parse(fs.readFileSync(outputPath, "utf8"));
        const completed = stdout.split(/\r?\n/).filter(Boolean).some((line) => {
          try { return JSON.parse(line).type === "turn.completed"; } catch { return false; }
        });
        if (!completed) throw new Error("Codex exited without a completed turn");
        finish(null, { response, stdout });
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.end(prompt);
  });
}

const preflightResponse = Object.freeze({
  polityId: "polity:preflight",
  revision: "revision:preflight",
  objective: { domain: "campaign", summary: "Verify the structured decision transport.", horizon: "short" },
  selectedChoices: [],
  triggerCoverage: [],
  rejectedChoices: [],
  durablePlan: { objective: "Verify transport only.", futureSteps: [], commitments: [] },
  contingency: "Do not materialize this diagnostic response.",
  hold: { reason: "plan-sequencing", detail: "Transport preflight only.", revisitAfterMonths: 1 },
});

const checksum = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

export function readCodexPreflights(directory) {
  try {
    return fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort().flatMap((name) => {
      try { return [JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"))]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

export function matchingCodexPreflight(preflights, { model, effort, contract = CODEX_STRATEGIC_CONTRACT } = {}) {
  return (Array.isArray(preflights) ? preflights : []).find((entry) => entry?.provider === CODEX_SUBSCRIPTION_PROVIDER
    && entry.contract === contract && entry.model === model && entry.effort === effort && entry.preflightChecksum) ?? null;
}

export async function invokePreflightedCodex({
  desktopRuntime = process.env.OH_DESKTOP_RUNTIME === "1",
  preflights,
  prompt,
  schema,
  model,
  effort = "medium",
  contract = CODEX_STRATEGIC_CONTRACT,
  invoke = invokeCodexStructured,
} = {}) {
  if (!desktopRuntime) throw new Error("Codex subscription is available only in the desktop app.");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 120_000) throw new Error("Codex runtime prompt is empty or too large.");
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("Codex runtime requires a JSON output schema.");
  const selectedModel = safeModel(model);
  const selectedEffort = safeEffort(effort);
  const preflight = matchingCodexPreflight(preflights, { model: selectedModel, effort: selectedEffort, contract });
  if (!preflight) throw new Error("Run the local model/contract schema preflight before this turn.");
  const result = await invoke({ prompt, schema, model: selectedModel, effort: selectedEffort });
  const completed = result.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).findLast((entry) => entry.type === "turn.completed");
  return {
    response: result.response,
    provenance: {
      provider: CODEX_SUBSCRIPTION_PROVIDER,
      model: selectedModel,
      effort: selectedEffort,
      contract,
      preflightChecksum: preflight.preflightChecksum,
      usage: completed?.usage ?? null,
      threadId: completed?.thread_id ?? null,
    },
  };
}

export async function runCodexSchemaPreflight({
  model,
  effort = "medium",
  cliVersion,
  directory,
  invoke = invokeCodexStructured,
} = {}) {
  const selectedModel = safeModel(model);
  const selectedEffort = safeEffort(effort);
  if (!directory) throw new Error("Codex preflight directory is required");
  const schema = strategicDecisionV3JsonSchema();
  const prompt = [
    "This is a transport-only structured-output preflight. Return exactly the JSON object below.",
    "Do not add prose, markdown, tools, or numeric effects.",
    JSON.stringify(preflightResponse),
  ].join("\n");
  const result = await invoke({ prompt, schema, model: selectedModel, effort: selectedEffort });
  const parsed = result.response;
  if (JSON.stringify(parsed) !== JSON.stringify(preflightResponse)) throw new Error("Codex preflight response did not preserve the frozen sentinel payload");
  const record = {
    schemaVersion: "open-historia-codex-preflight/1",
    provider: CODEX_SUBSCRIPTION_PROVIDER,
    contract: CODEX_STRATEGIC_CONTRACT,
    model: selectedModel,
    effort: selectedEffort,
    cliVersion: String(cliVersion ?? "unknown"),
    schemaChecksum: `sha256:${checksum(schema)}`,
    responseChecksum: `sha256:${checksum(parsed)}`,
  };
  const preflightChecksum = `sha256:${checksum(record)}`;
  const stored = { ...record, preflightChecksum };
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${preflightChecksum.slice("sha256:".length)}.json`);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
  return stored;
}

export function queryCodexModels({
  spawnImpl = spawn,
  timeoutMs = APP_SERVER_TIMEOUT_MS,
  environment = process.env,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("codex", codexAppServerArgs(), {
      env: sanitizeCodexProviderEnvironment(environment),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let models = [];
    let requestId = 2;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const sendModelPage = (cursor = null) => {
      child.stdin.write(`${JSON.stringify({ id: requestId, method: "model/list", params: {
        includeHidden: true, limit: 100, cursor,
      } })}\n`);
    };
    const handleLine = (line) => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.error) {
        finish(new Error(`Codex app-server ${message.error.message ?? "request failed"}`));
        return;
      }
      if (message.id === 1) {
        child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
        sendModelPage();
        return;
      }
      if (message.id === requestId) {
        if (!Array.isArray(message.result?.data)) {
          finish(new Error("Codex app-server model/list returned an invalid response"));
          return;
        }
        models = models.concat(message.result.data);
        if (message.result.nextCursor) {
          requestId += 1;
          sendModelPage(message.result.nextCursor);
        } else {
          finish(null, normalizeCodexModelCatalog({ data: models }));
        }
      }
    };

    const timeout = setTimeout(() => finish(new Error("Codex app-server model discovery timed out")), timeoutMs);
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled) finish(new Error(`Codex app-server exited before model discovery (code ${code}): ${stderr.trim()}`));
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });
    child.stdin.write(`${JSON.stringify({ id: 1, method: "initialize", params: {
      clientInfo: { name: "open-historia", version: "0.0.0" },
      capabilities: { experimentalApi: true },
    } })}\n`);
  });
}

export async function inspectCodexSubscription({
  desktopRuntime = process.env.OH_DESKTOP_RUNTIME === "1",
  exec = execFileSync,
  login = hasChatGptLogin,
  listModels = queryCodexModels,
} = {}) {
  if (!desktopRuntime) {
    return {
      provider: CODEX_SUBSCRIPTION_PROVIDER,
      available: false,
      reason: "desktop-only",
      message: "Codex subscription is available only in the desktop app; web and Android cannot launch the system Codex CLI.",
      models: [],
    };
  }
  try {
    const cliVersion = String(exec("codex", ["--version"], { encoding: "utf8" })).trim();
    if (!login()) {
      return {
        provider: CODEX_SUBSCRIPTION_PROVIDER, available: false, reason: "chatgpt-login-required",
        message: "Run codex login with ChatGPT, then retry the preflight.", cliVersion, models: [],
      };
    }
    const models = await listModels();
    return {
      provider: CODEX_SUBSCRIPTION_PROVIDER,
      available: true,
      reason: null,
      message: "Codex CLI and ChatGPT login detected. A schema transport preflight is still required before the first game turn.",
      cliVersion,
      auth: "chatgpt",
      preflightRequired: true,
      models,
    };
  } catch (error) {
    const missing = error?.code === "ENOENT";
    return {
      provider: CODEX_SUBSCRIPTION_PROVIDER,
      available: false,
      reason: missing ? "cli-not-found" : "preflight-inspection-failed",
      message: missing ? "Install the Codex CLI and sign in with ChatGPT." : `Codex inspection failed: ${error?.message ?? String(error)}`,
      models: [],
    };
  }
}
