import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { EMPTY_AGENT_STATE, STRATEGIC_INPUT_TOKEN_LIMIT, buildDiplomacyBatches } from "@open-historia/agent-runtime";
import { initState, parseScenario } from "@open-historia/engine";
import {
  makeProductionStrategicTasks,
  resolveProductionStrategicMonth,
  resolveStrategicMonth,
} from "./agentTurnStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarioPath = path.join(here, "..", "packages", "engine", "fixtures", "scenario-dev-map-6c", "scenario.json");
const initial = () => initState(parseScenario(JSON.parse(fs.readFileSync(scenarioPath, "utf8"))));
const europeScenarioPath = path.join(here, "..", "packages", "data-packs", "fixtures", "europe-1935-benchmark", "engine", "scenario.json");
const initialEurope = () => initState(parseScenario(JSON.parse(fs.readFileSync(europeScenarioPath, "utf8"))));
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

const productionDraft = () => ({
  state: initialEurope(),
  playerPolityId: "polity:poland",
  difficulty: "medium",
  agentState: structuredClone(EMPTY_AGENT_STATE),
  lastLedger: null,
  profiles: {},
  startMonth: "1935-01-01",
  targetDate: "1935-02-01",
  strategicContract: "StrategicBriefV4+StrategicDecisionV3",
  strategicCallBudget: 16,
  strategicCallsPlanned: 0,
  monthlyTicks: 1,
  monthlyCommands: [],
  monthTraces: [],
  playerCommands: [],
  interpretedActions: [],
  actions: [],
  reports: [],
  pendingBatches: [],
  pendingStrategicV4: [],
  strategicCommands: [],
  strategicDecisions: [],
  tasks: [],
  locale: "ru",
  phase: "confirm-player",
});

const heldDecision = (brief) => ({
  polityId: brief.actor.id,
  revision: brief.revision,
  objective: { domain: "campaign", summary: "Preserve sovereignty while reviewing the opening position.", horizon: "medium" },
  selectedChoices: [],
  triggerCoverage: [],
  rejectedChoices: brief.choices.length > 1 ? [{ choiceId: brief.choices[0].choiceId, reason: "Defer this legal choice." }] : [],
  durablePlan: { objective: "Preserve sovereignty.", futureSteps: ["Review the next engine revision."], commitments: [] },
  contingency: "Reassess after a material checkpoint.",
  hold: { reason: "plan-sequencing", detail: "No opening material action is required.", revisitAfterMonths: 1 },
});

describe("Europe 1935 production StrategicBriefV4 phase", () => {
  it("builds one private bounded task per non-player strategic actor", () => {
    const draft = productionDraft();
    makeProductionStrategicTasks(draft);
    assert.equal(draft.phase, "plan-strategy-v4");
    assert.equal(draft.tasks.length, 8);
    assert.equal(new Set(draft.tasks.map((task) => task.taskKey)).size, 8);
    assert.equal(draft.tasks.every((task) => task.contract === "StrategicBriefV4+StrategicDecisionV3"), true);
    assert.equal(draft.tasks.every((task) => task.context.polityCount === 1), true);
    assert.equal(draft.pendingStrategicV4.every((entry) => entry.brief.inputTokenCount <= STRATEGIC_INPUT_TOKEN_LIMIT), true);
    assert.equal(draft.tasks.some((task) => task.userPrompt.includes("coordinates")), false);
  });

  it("turns provider failures into durable visible holds and advances without fallback", () => {
    const draft = productionDraft();
    makeProductionStrategicTasks(draft);
    const outcomes = draft.pendingStrategicV4.map(({ taskKey, brief }, index) => index === 0
      ? { taskKey, failureCode: "provider offline" }
      : {
        taskKey,
        output: heldDecision(brief),
        provenance: {
          provider: "codex-subscription", model: "gpt-5.6-terra", effort: "medium",
          preflightChecksum: "sha256:test",
        },
      });
    resolveProductionStrategicMonth(draft, outcomes);
    assert.equal(draft.state.month, "1935-02-01");
    assert.equal(draft.monthlyCommands.length, 1);
    assert.equal(draft.phase, "ready");
    const failed = draft.agentState.strategicV4.memories.find((entry) => entry.reason === "provider offline");
    assert.equal(failed.lastStatus, "hold");
    assert.equal(failed.retryMonth, "1935-02-01");
    assert.equal(failed.pendingTriggerIds.length, 1);
    assert.equal(draft.monthTraces[0].strategicDecisions.some((entry) => entry.source === "provider-hold"), true);
    assert.equal(draft.agentState.strategicV4.providerHistory.length, 7);
  });
});
