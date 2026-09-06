import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { strategicDecisionV4Schema } from "@open-historia/agent-runtime";

export const CODEX_SUBSCRIPTION_PROVIDER = "codex-subscription";
export const CODEX_TESTED_MODELS = Object.freeze([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]);

const APP_SERVER_TIMEOUT_MS = 15_000;
const STRUCTURED_TURN_TIMEOUT_MS = 10 * 60_000;
// This transport is shared by player-intent interpretation and Strategic V5.
// Its preflight proves structured-output transport with the canonical V4
// decision sentinel; each live call still supplies and validates its own
// frozen schema.  A legacy V4/V3 record never certifies this transport.
export const CODEX_STRUCTURED_OUTPUT_CONTRACT = "OpenHistoriaStructuredOutputV1";

const schemaVariant = (schema, value) => {
  const variants = schema?.anyOf ?? schema?.oneOf;
  if (!Array.isArray(variants)) return schema;
  return variants.find((candidate) => schemaAcceptsValue(candidate, value)) ?? variants[0];
};

const schemaAcceptsValue = (schema, value) => {
  if (!schema || typeof schema !== "object") return true;
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants)) return variants.some((candidate) => schemaAcceptsValue(candidate, value));
  if (Object.hasOwn(schema, "const") && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "array") return Array.isArray(value);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.entries(schema.properties ?? {}).every(([key, child]) =>
      !Object.hasOwn(value, key) || schemaAcceptsValue(child, value[key]));
  }
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "integer") return Number.isInteger(value);
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (schema.type === "boolean") return typeof value === "boolean";
  return true;
};

const nullableSchema = (schema) => {
  const variants = schema?.anyOf;
  return Array.isArray(variants) && variants.some((entry) => entry?.type === "null")
    ? schema
    : { anyOf: [schema, { type: "null" }] };
};

/** Convert general Zod JSON Schema into the strict subset accepted by Codex. */
export function codexOutputSchema(schema) {
  if (Array.isArray(schema)) return schema.map(codexOutputSchema);
  if (!schema || typeof schema !== "object") return schema;
  const converted = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema") continue;
    converted[key === "oneOf" ? "anyOf" : key] = codexOutputSchema(value);
  }
  if (converted.type === "object" && converted.properties) {
    const originallyRequired = new Set(converted.required ?? []);
    for (const key of Object.keys(converted.properties)) {
      if (!originallyRequired.has(key)) converted.properties[key] = nullableSchema(converted.properties[key]);
    }
    converted.required = Object.keys(converted.properties);
    converted.additionalProperties = false;
  }
  return converted;
}

/** Remove transport-only nulls from fields which are optional in the source schema. */
export function normalizeCodexOutput(value, schema) {
  if (!schema || typeof schema !== "object") return value;
  const selected = schemaVariant(schema, value);
  if (selected !== schema) return normalizeCodexOutput(value, selected);
  if (Array.isArray(value)) return value.map((entry) => normalizeCodexOutput(entry, schema.items));
  if (!value || typeof value !== "object") return value;
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (entry === null && !required.has(key)) return [];
    return [[key, normalizeCodexOutput(entry, schema.properties?.[key])]];
  }));
}

export function codexFailureMessage(stdout, stderr, code) {
  const events = String(stdout ?? "").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const eventMessage = events.findLast((entry) => entry?.type === "turn.failed")?.error?.message
    ?? events.findLast((entry) => entry?.type === "error")?.message;
  return String(stderr ?? "").trim() || String(eventMessage ?? "").trim()
    || `Codex exited without an error message (code ${code}).`;
}

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

export function strategicDecisionV4JsonSchema() {
  const schema = z.toJSONSchema(strategicDecisionV4Schema);
  delete schema.$schema;
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
  fs.writeFileSync(schemaPath, `${JSON.stringify(codexOutputSchema(schema), null, 2)}\n`, "utf8");
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
        finish(new Error(`Codex schema transport failed (code ${code}): ${codexFailureMessage(stdout, stderr, code)}`));
        return;
      }
      try {
        const response = normalizeCodexOutput(JSON.parse(fs.readFileSync(outputPath, "utf8")), schema);
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
  revision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  selectedChoiceIds: [],
  processDecisions: [],
  initiativeProposals: [],
  durablePlan: { objective: "Verify transport only.", goals: [], commitments: [], revisit: "next-checkpoint" },
  evidenceIds: ["evidence:preflight"],
  hold: { reason: "no-legal-action", detail: "Transport preflight only.", revisit: "next-checkpoint" },
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

export function matchingCodexPreflight(preflights, { model, effort, contract = CODEX_STRUCTURED_OUTPUT_CONTRACT } = {}) {
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
  contract = CODEX_STRUCTURED_OUTPUT_CONTRACT,
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
  const schema = strategicDecisionV4JsonSchema();
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
    contract: CODEX_STRUCTURED_OUTPUT_CONTRACT,
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
