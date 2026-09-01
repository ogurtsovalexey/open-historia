import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTONOMY_V2_CELLS,
  FREE10_CELLS,
  decisionTriggerReasons,
  isRetryableGeminiFailure,
  pacificQuotaDay,
  reduceChronicleAlerts,
} from "../scripts/lib/campaign-lab-policy.mjs";
import { CAMPAIGN_DECISION_RESPONSE_SCHEMA, CAMPAIGN_DECISION_TOOLS, encodeCampaignDecisionWire, normalizeCampaignDecisionWire } from "../scripts/lib/campaign-lab-contract.mjs";

test("Campaign Lab sends the bounded StrategicDecisionV2 schema without raw commands", () => {
  assert.ok(CAMPAIGN_DECISION_TOOLS.includes("conserve"));
  assert.ok(CAMPAIGN_DECISION_TOOLS.includes("declare-war"));
  const serialized = JSON.stringify(CAMPAIGN_DECISION_RESPONSE_SCHEMA);
  assert.equal(CAMPAIGN_DECISION_TOOLS.length, 15);
  assert.deepEqual(CAMPAIGN_DECISION_RESPONSE_SCHEMA.properties.decisions.items.properties.actions.items.properties.tool.enum, CAMPAIGN_DECISION_TOOLS);
  assert.equal(serialized.includes('"command"'), false);
  assert.ok(serialized.length < 30_000);
});

test("compact Gemini actions round-trip to named StrategicDecisionV2 arguments", () => {
  const action = { tool: "negotiate-trade", partner: "polity:soviet-union", resource: "iron", desiredRunway: "medium", budgetAttitude: "urgent" };
  const normalized = normalizeCampaignDecisionWire({ decisions: [encodeCampaignDecisionWire({ polityId: "polity:test", objective: { domain: "economy", summary: "Trade.", horizon: "short" },
    actions: [action], futurePlan: [], contingency: "Wait.", rationale: "Need iron.", hold: null })] });
  assert.deepEqual(normalized.decisions[0].actions[0], action);
  assert.equal(normalized.decisions[0].hold, null);
});

test("compact Gemini trade actions normalize an unambiguous qualifier swap", () => {
  const normalized = normalizeCampaignDecisionWire({ decisions: [{
    polityId: "polity:test", objectiveDomain: "economy", objectiveSummary: "Trade.", horizon: "short",
    actions: [{ tool: "negotiate-trade", target: "", counterpart: "polity:partner", subject: "iron", choice: "balanced", intensity: "medium" }],
    futurePlan: [], contingency: "Wait.", rationale: "Need iron.", intendedOutcome: "", holdReason: "none",
    holdDetail: "", revisitAfterMonths: 1, revisitTriggers: ["resource-deficit"],
  }] });
  assert.deepEqual(normalized.decisions[0].actions[0], {
    tool: "negotiate-trade", partner: "polity:partner", resource: "iron", desiredRunway: "medium", budgetAttitude: "balanced",
  });
});

test("autonomy-v2 pilot is deliberately limited to the three German doctrines", () => {
  assert.deepEqual(AUTONOMY_V2_CELLS, [
    { player: "germany", strategy: "historical" }, { player: "germany", strategy: "alternative" }, { player: "germany", strategy: "free" },
  ]);
});

test("free10 matrix contains the requested ten campaign cells", () => {
  assert.equal(FREE10_CELLS.length, 10);
  assert.deepEqual(FREE10_CELLS.at(-1), { player: "united-kingdom", strategy: "historical" });
  assert.equal(FREE10_CELLS.some((cell) => ["austria", "czechoslovakia", "italy"].includes(cell.player)), false);
});

test("quota day is evaluated in America/Los_Angeles", () => {
  assert.equal(pacificQuotaDay(new Date("2026-09-01T06:59:59Z")), "2026-08-31");
  assert.equal(pacificQuotaDay(new Date("2026-09-01T07:00:00Z")), "2026-09-01");
});

test("transport retry policy excludes client and schema failures", () => {
  assert.equal(isRetryableGeminiFailure({ networkError: true }), true);
  for (const status of [429, 500, 503, 599]) assert.equal(isRetryableGeminiFailure({ status }), true);
  for (const status of [400, 401, 403, 404, 422]) assert.equal(isRetryableGeminiFailure({ status }), false);
});

test("monthly alerts are deduplicated and do not become recurring decision triggers", () => {
  const first = reduceChronicleAlerts([
    { type: "alert", polityId: "polity:a", alert: "inputs-limited", detail: "iron" },
    { type: "alert", polityId: "polity:a", alert: "food-shortfall", detail: "need 100, available 80, shortfall 20" },
  ]);
  assert.deepEqual(first.records.map((event) => event.lifecycle), ["started", "started"]);
  assert.deepEqual(first.triggerReasons, ["new-resource-deficit:polity:a", "critical-food-shortfall:polity:a"]);
  const repeated = reduceChronicleAlerts([
    { type: "alert", polityId: "polity:a", alert: "inputs-limited", detail: "iron" },
    { type: "alert", polityId: "polity:a", alert: "food-shortfall", detail: "need 100, available 80, shortfall 20" },
  ], first.alertState);
  assert.deepEqual(repeated.records, []);
  assert.deepEqual(repeated.triggerReasons, []);
  const worse = reduceChronicleAlerts([
    { type: "alert", polityId: "polity:a", alert: "food-shortfall", detail: "need 100, available 70, shortfall 30" },
  ], repeated.alertState);
  assert.deepEqual(worse.records.map((event) => event.lifecycle).sort(), ["resolved", "worsened"]);
  assert.deepEqual(worse.triggerReasons, []);
  const resolved = reduceChronicleAlerts([], worse.alertState);
  assert.deepEqual(resolved.records.map((event) => event.lifecycle), ["resolved"]);
});

test("only material diplomatic, war, government, default and crisis events trigger decisions", () => {
  assert.deepEqual(decisionTriggerReasons([
    { type: "alert" }, { type: "goal-achieved" }, { type: "inputs-limited" },
    { type: "war-declared" }, { type: "government-transferred" },
  ]), ["government-transferred", "war-declared"]);
});
