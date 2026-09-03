import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { after, before, test } from "node:test";
import {
  assessCodexDecisionReferences, buildCodexDecisionResponseSchema, CODEX_DECISION_RESPONSE_SCHEMA, normalizeCodexDecisionWire,
} from "../scripts/lib/campaign-lab-contract.mjs";
import {
  buildCodexExecArgs, invokeCodexSubscription, parseCodexJsonl, sanitizeCodexEnvironment,
} from "../scripts/lib/codex-subscription.mjs";

let temp;
const script = path.resolve("scripts/campaign-lab.mjs");
const evaluatorScript = path.resolve("scripts/codex-luna-capability.mjs");
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], {
  cwd: path.resolve("."), encoding: "utf8", env: { ...process.env, CAMPAIGN_LAB_RUNS_DIR: temp },
}));

before(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), "open-historia-campaign-lab-")); });
after(() => { fs.rmSync(temp, { recursive: true, force: true }); });

test("mock Campaign Lab start/status/resume produces a deterministic final card and chronicle", () => {
  const started = run("start", "--run", "test-mock", "--player", "germany", "--strategy", "historical", "--mode", "mock");
  assert.equal(started.status, "ready");
  assert.equal(run("status", "--run", "test-mock").scenarioChecksum, started.scenarioChecksum);
  const completed = run("resume", "--run", "test-mock");
  assert.equal(completed.status, "completed");
  const card = JSON.parse(fs.readFileSync(path.join(temp, "test-mock", "final-card.json"), "utf8"));
  assert.equal(card.finalMonth, "1940-07-01");
  assert.equal(card.polities.length, 11);
  assert.deepEqual(card.polities.filter((entry) => ["polity:free-city-of-danzig", "polity:saargebiet"].includes(entry.polityId))
    .map((entry) => entry.polityId), ["polity:free-city-of-danzig", "polity:saargebiet"]);
  assert.equal(card.telemetry.engineResolutions, 66);
  assert.ok(fs.statSync(path.join(temp, "test-mock", "chronicle.jsonl")).size > 0);
  assert.ok(fs.statSync(path.join(temp, "test-mock", "checkpoint-report.md")).size > 0);
  const playerBrief = JSON.parse(fs.readFileSync(path.join(temp, "test-mock", "player-brief.json"), "utf8"));
  assert.equal(playerBrief.private, true);
  assert.equal(playerBrief.strategicBrief.schemaVersion, "open-historia-strategic-brief/2");
});

test("free10-autonomy-v2 creates only three German pilot cells", () => {
  const ids = run("start", "--matrix", "free10-autonomy-v2", "--mode", "mock");
  assert.deepEqual(ids, ["free10-autonomy-v2-germany-historical", "free10-autonomy-v2-germany-alternative", "free10-autonomy-v2-germany-free"]);
  const freeze = JSON.parse(fs.readFileSync(path.join(temp, "matrix-free10-autonomy-v2.json"), "utf8"));
  assert.equal(freeze.cells.length, 3);
});

test("free10 creates only the requested ten player cells and freezes one matrix manifest", () => {
  const ids = run("start", "--matrix", "free10", "--mode", "mock");
  assert.deepEqual(ids, [
    "free10-germany-historical", "free10-germany-alternative", "free10-germany-free",
    "free10-poland-historical", "free10-poland-alternative", "free10-poland-free",
    "free10-france-historical", "free10-france-alternative", "free10-france-free",
    "free10-united-kingdom-historical",
  ]);
  const freeze = JSON.parse(fs.readFileSync(path.join(temp, "matrix-free10.json"), "utf8"));
  assert.equal(freeze.cells.length, 10);
  assert.equal(freeze.thinkingLevel, "off");
  assert.equal(ids.some((id) => /austria|czechoslovakia|italy/.test(id)), false);
});

const emptyCodexAction = (tool) => ({ tool, targetRegionId: "", partner: "", resource: "", desiredRunway: "", budgetAttitude: "",
  agreementType: "", demand: "", pressure: "", proposalId: "", response: "", taxStance: "", budgetPriority: "", priority: "",
  factionId: "", templateId: "", scale: "", targetPolityId: "", commanderId: "", defender: "", reason: "", formationId: "",
  posture: "", warId: "", approach: "" });

test("Codex wire is a flat named-field schema and normalizes once to StrategicDecisionV2", () => {
  assert.equal(JSON.stringify(CODEX_DECISION_RESPONSE_SCHEMA).includes("oneOf"), false);
  assert.ok(CODEX_DECISION_RESPONSE_SCHEMA.properties.decisions.items.properties.actions.items.properties.targetRegionId);
  const raw = { decisions: [{ polityId: "polity:austria", objectiveDomain: "economy", objectiveSummary: "Preserve reserves.", horizon: "short",
    actions: [{ ...emptyCodexAction("invest"), targetRegionId: "region:test:AT", scale: "small" }], futurePlan: [],
    contingency: "Conserve.", rationale: "The listed investment is executable.", intendedOutcome: "", holdReason: "none", holdDetail: "",
    revisitAfterMonths: 1, revisitTriggers: ["resource-deficit"] }] };
  assert.deepEqual(normalizeCodexDecisionWire(raw).decisions[0].actions[0], { tool: "invest", targetRegionId: "region:test:AT", scale: "small" });
  const polluted = structuredClone(raw); polluted.decisions[0].actions[0].partner = "polity:invented";
  assert.throws(() => normalizeCodexDecisionWire(polluted), /empty sentinel/);
});

test("Codex batch schema requires exact requested coverage and constrains actor ids", () => {
  const ids = ["polity:austria", "polity:united-kingdom"];
  const schema = buildCodexDecisionResponseSchema(ids);
  assert.equal(schema.properties.decisions.minItems, 2);
  assert.equal(schema.properties.decisions.maxItems, 2);
  assert.deepEqual(schema.properties.decisions.items.properties.polityId.enum, ids);
  assert.throws(() => buildCodexDecisionResponseSchema([ids[0], ids[0]]), /unique polity ids/);
});

test("Codex evaluator separates citations of published indicators from invented numeric effects", () => {
  const prompt = 'APPLICATION PAYLOAD:{"actorRunwayMonths":40,"availableManpower":12000}';
  const assessed = assessCodexDecisionReferences({ decisions: [{
    objectiveSummary: "Preserve reserves.", rationale: "The published runway is 40 months; output will rise by 12%.",
    intendedOutcome: "", contingency: "Reassess.", futurePlan: [],
  }] }, prompt);
  assert.deepEqual(assessed.publishedNumericCitations, ["40 months"]);
  assert.deepEqual(assessed.authoritativeNumericClaims, ["12%"]);
});

test("Codex subprocess contract forces ephemeral ChatGPT Luna and sanitizes provider credentials", () => {
  const args = buildCodexExecArgs({ cwd: "/tmp/lab", schemaPath: "/tmp/lab/schema.json", outputPath: "/tmp/lab/out.json" });
  for (const required of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--json", "read-only", "gpt-5.6-luna",
    'forced_login_method="chatgpt"', 'model_reasoning_effort="low"', 'model_verbosity="low"', "features.fast_mode=false", "features.plugins=false", "mcp_servers={}"]) {
    assert.ok(args.includes(required), required);
  }
  const env = sanitizeCodexEnvironment({ PATH: "/bin", HOME: "/home/test", CODEX_HOME: "/auth", OPENAI_API_KEY: "secret", GEMINI_API_KEY: "secret", ANTHROPIC_AUTH_TOKEN: "secret" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/home/test", CODEX_HOME: "/auth" });
});

test("Codex JSONL parsing and retry stop after a completed turn", () => {
  const parsed = parseCodexJsonl('{"type":"thread.started","thread_id":"thread-1"}\n{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14}}\n');
  assert.deepEqual(parsed.threadIds, ["thread-1"]); assert.equal(parsed.completed, true); assert.equal(parsed.usage.totalTokens, 14);
  let calls = 0;
  const result = invokeCodexSubscription({ prompt: "probe", schema: CODEX_DECISION_RESPONSE_SCHEMA, exec: (_command, args) => {
    calls += 1;
    const error = new Error("schema failure"); error.stdout = '{"type":"turn.completed","thread_id":"thread-done"}\n'; error.stderr = "invalid output";
    throw error;
  } });
  assert.equal(calls, 1); assert.equal(result.completed, true);
});

test("Luna capability mock mode performs zero Codex turns and is byte-identical", () => {
  const runEvaluator = (id) => JSON.parse(execFileSync(process.execPath, [evaluatorScript, "--mode", "mock", "--run", id], {
    cwd: path.resolve("."), encoding: "utf8", env: { ...process.env, CAMPAIGN_LAB_RUNS_DIR: temp },
  }));
  const first = runEvaluator("luna-mock-a"); const second = runEvaluator("luna-mock-b");
  assert.equal(first.completedCodexTurns, 0); assert.equal(second.completedCodexTurns, 0);
  for (const probe of ["1-initial-six-opponents", "2-uk-iron-exhaustion", "3-czechoslovakia-territorial-proposal", "4-poland-active-german-war"]) {
    assert.equal(fs.readFileSync(path.join(temp, "luna-mock-a", probe, "validation.json"), "utf8"),
      fs.readFileSync(path.join(temp, "luna-mock-b", probe, "validation.json"), "utf8"));
    assert.equal(fs.existsSync(path.join(temp, "luna-mock-a", probe, "events.jsonl")), false);
    const brief = JSON.parse(fs.readFileSync(path.join(temp, "luna-mock-a", probe, "brief-batch.json"), "utf8"));
    const schema = JSON.parse(fs.readFileSync(path.join(temp, "luna-mock-a", probe, "output-schema.json"), "utf8"));
    const prompt = fs.readFileSync(path.join(temp, "luna-mock-a", probe, "prompt.txt"), "utf8");
    assert.equal(schema.properties.decisions.minItems, brief.polityIds.length);
    assert.equal(schema.properties.decisions.maxItems, brief.polityIds.length);
    assert.deepEqual(schema.properties.decisions.items.properties.polityId.enum, brief.polityIds);
    assert.ok(prompt.includes(`"requiredPolityIds":${JSON.stringify(brief.polityIds)}`));
  }
});
