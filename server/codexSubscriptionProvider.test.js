import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { z } from "zod";
import { strategicDecisionV3Schema } from "@open-historia/agent-runtime";
import {
  codexAppServerArgs,
  codexStructuredExecArgs,
  hasChatGptLogin,
  inspectCodexSubscription,
  normalizeCodexModelCatalog,
  queryCodexModels,
  readCodexPreflights,
  runCodexSchemaPreflight,
  sanitizeCodexProviderEnvironment,
  strategicDecisionV3JsonSchema,
} from "./codexSubscriptionProvider.js";

const rawModels = [{
  id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "Luna", description: "Fast", hidden: false,
  isDefault: false, defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }],
}, {
  id: "future-model", model: "future-model", displayName: "Future", description: "New", hidden: true,
  isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high" }],
}];

test("Codex subscription inspection is desktop-only and never reads provider credentials", async () => {
  let executions = 0;
  const unavailable = await inspectCodexSubscription({ desktopRuntime: false, exec: () => { executions += 1; } });
  assert.equal(unavailable.reason, "desktop-only");
  assert.equal(executions, 0);
  assert.deepEqual(sanitizeCodexProviderEnvironment({ PATH: "/bin", CODEX_HOME: "/auth", OPENAI_API_KEY: "secret", CUSTOM_AUTH_TOKEN: "secret" }), {
    PATH: "/bin", CODEX_HOME: "/auth",
  });
});

test("ChatGPT login detection accepts Codex stderr and rejects API-key auth", () => {
  assert.equal(hasChatGptLogin({ spawnSyncImpl: () => ({ status: 0, stdout: "", stderr: "Logged in using ChatGPT\n" }) }), true);
  assert.equal(hasChatGptLogin({ spawnSyncImpl: () => ({ status: 0, stdout: "Logged in using an API key", stderr: "" }) }), false);
  assert.equal(hasChatGptLogin({ spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "Not logged in" }) }), false);
});

test("Codex model catalog marks only Luna, Terra and Sol as globally tested", () => {
  const models = normalizeCodexModelCatalog({ data: rawModels });
  assert.equal(models[0].id, "future-model", "CLI default sorts first");
  assert.equal(models.find((entry) => entry.id === "gpt-5.6-luna").badge, "tested");
  assert.equal(models.find((entry) => entry.id === "future-model").badge, "unverified");
  assert.equal(models.find((entry) => entry.id === "future-model").hidden, true);
});

test("Codex app-server discovery initializes, paginates and disables plugins, apps and MCP", async () => {
  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        const request = JSON.parse(line);
        if (request.id === 1) child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
        if (request.id === 2) child.stdout.write(`${JSON.stringify({ id: 2, result: { data: [rawModels[0]], nextCursor: "page-2" } })}\n`);
        if (request.id === 3) child.stdout.write(`${JSON.stringify({ id: 3, result: { data: [rawModels[1]], nextCursor: null } })}\n`);
      }
    });
    return child;
  };
  const models = await queryCodexModels({ spawnImpl, environment: { PATH: "/bin", OPENAI_API_KEY: "secret" } });
  assert.deepEqual(models.map((entry) => entry.id), ["future-model", "gpt-5.6-luna"]);
  assert.equal(invocation.command, "codex");
  assert.equal(invocation.options.env.OPENAI_API_KEY, undefined);
  for (const required of ['forced_login_method="chatgpt"', "features.plugins=false", "features.apps=false", "mcp_servers={}"]) {
    assert.ok(codexAppServerArgs().includes(required), required);
  }
});

test("desktop inspection exposes CLI models but keeps schema transport pending", async () => {
  const status = await inspectCodexSubscription({
    desktopRuntime: true,
    exec: () => "codex-cli 1.2.3\n",
    login: () => true,
    listModels: async () => normalizeCodexModelCatalog({ data: rawModels }),
  });
  assert.equal(status.available, true);
  assert.equal(status.auth, "chatgpt");
  assert.equal(status.preflightRequired, true);
  assert.equal(status.models.length, 2);
  assert.equal(JSON.stringify(status).includes("token"), false);
});

test("schema preflight is isolated, validates the exact V3 payload and stores only checksums", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-codex-preflight-test-"));
  try {
    let invocation;
    const record = await runCodexSchemaPreflight({
      model: "gpt-5.6-luna", effort: "medium", cliVersion: "codex-cli test", directory,
      invoke: async (options) => {
        invocation = options;
        const sentinel = JSON.parse(options.prompt.split("\n").at(-1));
        return { response: sentinel, stdout: '{"type":"turn.completed"}\n' };
      },
    });
    assert.equal(record.contract, "StrategicBriefV4+StrategicDecisionV3");
    assert.equal(record.model, "gpt-5.6-luna");
    assert.equal(record.preflightChecksum.startsWith("sha256:"), true);
    assert.equal(invocation.schema.type, "object");
    assert.equal(invocation.schema.properties.hold.anyOf.length, 2);
    assert.deepEqual(readCodexPreflights(directory), [record]);
    const bytes = fs.readFileSync(path.join(directory, `${record.preflightChecksum.slice(7)}.json`), "utf8");
    assert.equal(bytes.includes("Transport preflight only"), false, "raw model response is not persisted");
    assert.equal(bytes.includes("token"), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("server preflight schema stays structurally identical to canonical StrategicDecisionV3", () => {
  const canonical = z.toJSONSchema(strategicDecisionV3Schema);
  delete canonical.$schema;
  assert.deepEqual(strategicDecisionV3JsonSchema(), canonical);
});

test("structured Codex turns disable ambient config, plugins, apps and writable sandboxes", () => {
  const args = codexStructuredExecArgs({
    cwd: "/tmp/preflight", schemaPath: "/tmp/preflight/schema.json", outputPath: "/tmp/preflight/out.json",
    model: "gpt-5.6-terra", effort: "high",
  });
  for (const required of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "read-only", "gpt-5.6-terra",
    'model_reasoning_effort="high"', "features.plugins=false", "features.apps=false", "mcp_servers={}"]) {
    assert.ok(args.includes(required), required);
  }
  assert.throws(() => codexStructuredExecArgs({ cwd: "/tmp/x", schemaPath: "/tmp/s", outputPath: "/tmp/o", model: "../bad", effort: "medium" }), /model id/);
});
