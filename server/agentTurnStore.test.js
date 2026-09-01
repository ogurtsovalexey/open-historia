import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EMPTY_AGENT_STATE, buildDiplomacyBatches } from "@open-historia/agent-runtime";
import { initState, parseScenario } from "@open-historia/engine";
import { resolveStrategicMonth } from "./agentTurnStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarioPath = path.join(here, "..", "packages", "engine", "fixtures", "scenario-dev-map-6c", "scenario.json");
const initial = () => initState(parseScenario(JSON.parse(fs.readFileSync(scenarioPath, "utf8"))));
const draftFor = (state) => ({
  state,
  playerPolityId: "polity:austria",
  difficulty: "medium",
  agentState: structuredClone(EMPTY_AGENT_STATE),
  lastLedger: null,
  profiles: {},
  pendingStrategicBatches: buildDiplomacyBatches(state, "polity:austria"),
  strategicCommands: [],
  strategicDecisions: [],
  tasks: [{ taskKey: "material-strategy" }],
  phase: "plan-strategy",
});

describe("material strategic agent phase", () => {
  it("does not mutate or advance the draft when strategic output fails validation", () => {
    const draft = draftFor(initial());
    const before = structuredClone(draft);
    assert.throws(() => resolveStrategicMonth(draft, []), /one strategic output per batch/);
    assert.deepEqual(draft, before);
    assert.equal(draft.state.turn, 0);
  });

  it("accepts a complete no-op strategy batch and proceeds to utility planning", () => {
    const draft = draftFor(initial());
    const output = { decisions: draft.pendingStrategicBatches[0].polityIds.map((polityId) => ({
      polityId, intent: "hold", rationale: "No material action.", command: null,
    })) };
    resolveStrategicMonth(draft, [output]);
    assert.equal(draft.state.turn, 0);
    assert.equal(draft.phase, "plan-opponents");
    assert.equal(draft.strategicDecisions.length, 5);
    assert.equal(draft.tasks[0].taskId, "opponents.plan-economy");
  });
});
