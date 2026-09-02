import { execFileSync, spawn, spawnSync } from "node:child_process";

export const CODEX_SUBSCRIPTION_PROVIDER = "codex-subscription";
export const CODEX_TESTED_MODELS = Object.freeze([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]);

const APP_SERVER_TIMEOUT_MS = 15_000;

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
