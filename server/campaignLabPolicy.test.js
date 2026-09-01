import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE10_CELLS,
  decisionTriggerReasons,
  isRetryableGeminiFailure,
  pacificQuotaDay,
  reduceChronicleAlerts,
} from "../scripts/lib/campaign-lab-policy.mjs";

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
  assert.deepEqual(first.triggerReasons, ["critical-food-shortfall:polity:a"]);
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
