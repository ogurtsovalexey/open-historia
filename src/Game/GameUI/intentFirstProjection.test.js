import assert from "node:assert/strict";
import test from "node:test";

import {
  INTENT_FIRST_UI_SCHEMA_VERSION,
  assertIntentFirstCommands,
  parseIntentFirstProjection,
} from "./intentFirstProjection.js";

const groundedProjection = () => ({
  schemaVersion: INTENT_FIRST_UI_SCHEMA_VERSION,
  revision: `sha256:${"a".repeat(64)}`,
  asOf: "1500-04-01",
  locale: "en",
  playerPolity: { polityId: "polity:test", displayName: "Test polity" },
  briefing: {
    headline: "The harvest recovered",
    summary: "Food pressure eased, while recruitment remains constrained.",
    changes: [
      {
        changeId: "change:food",
        label: "Available food",
        magnitude: "+12,000 baskets",
        authority: "derived",
        evidenceIds: ["evidence:food"],
        sourceLabels: ["Harvest and consumption ledger"],
        causes: [{ category: "production", label: "Harvest", contribution: "+15,000" }],
      },
    ],
  },
  facts: [
    {
      factId: "fact:population",
      label: "Controlled population",
      value: "1,200,000",
      authority: "derived",
      evidenceIds: ["evidence:population"],
      sourceLabels: ["Regional cohort ledger"],
      why: ["Sum of currently controlled regional cohorts."],
    },
    {
      factId: "fact:debt",
      label: "Foreign debt",
      value: null,
      authority: "unknown",
      evidenceIds: [],
      unknownReason: "This scenario does not expose that measure.",
      why: [],
    },
  ],
  interpretation: null,
  processes: [],
  situations: [],
  diplomacy: { conversations: [], commitments: [] },
  details: [],
  time: { label: "April 1500", options: [{ optionId: "time:3m", label: "Advance 3 months" }] },
});

test("intent-first projection accepts revision-bound grounded values and unknowns", () => {
  const parsed = parseIntentFirstProjection(groundedProjection());
  assert.equal(parsed.revision, `sha256:${"a".repeat(64)}`);
  assert.equal(parsed.facts[0].authority, "derived");
  assert.equal(parsed.facts[1].authority, "unknown");
  assert.equal(parsed.facts[1].value, null);
});

test("intent-first projection rejects ungrounded material facts", () => {
  const projection = groundedProjection();
  projection.facts[0].evidenceIds = [];
  assert.throws(
    () => parseIntentFirstProjection(projection),
    /facts\[0\]\.evidenceIds must contain at least one evidence ID/,
  );
});

test("intent-first projection rejects exact values presented as narrative", () => {
  const projection = groundedProjection();
  projection.facts[0].authority = "narrative";
  assert.throws(
    () => parseIntentFirstProjection(projection),
    /facts\[0\] narrative entries cannot carry an authoritative value/,
  );
});

test("interpretations preserve contradicted claims beside valid actions", () => {
  const projection = groundedProjection();
  projection.interpretation = {
    interpretationId: "interpretation:1",
    sourceText: "I conquered the north; invest in the roads there.",
    confirmationRequired: true,
    questions: [],
    claims: [{
      claimId: "claim:1",
      text: "I conquered the north",
      status: "contradicted",
      explanation: "Current control and the causal ledger contradict this claim.",
      evidenceIds: ["evidence:control"],
    }],
    requestedActions: [{
      actionId: "action:roads",
      summary: "Investigate road investment in currently controlled regions",
      material: true,
      irreversible: false,
      targetLabels: ["controlled northern routes"],
      evidenceIds: ["evidence:routes"],
    }],
    proposedInitiatives: [],
    preview: {
      cost: { kind: "range", label: "4,000–7,000 labor-days" },
      duration: { kind: "range", label: "6–12 months" },
      risks: ["Harvest labor may tighten"],
      opportunityCosts: ["Less capacity for irrigation"],
      affected: ["Northern routes"],
      evidenceIds: ["evidence:routes"],
    },
  };

  const parsed = parseIntentFirstProjection(projection);
  assert.equal(parsed.interpretation.claims[0].status, "contradicted");
  assert.equal(parsed.interpretation.requestedActions[0].actionId, "action:roads");
});

test("projection rejects basis-point shaped standard-mode labels", () => {
  const projection = groundedProjection();
  projection.facts[0].value = "+250 bp";
  assert.throws(
    () => parseIntentFirstProjection(projection),
    /basis points and schema identifiers belong in audit details/,
  );
});

test("process cards require grounded inputs, spending and semantic decisions", () => {
  const projection = groundedProjection();
  projection.processes = [{
    processId: "process:test", name: "Test process", direction: "Investigate", stage: "emerging",
    pace: "steady", feasibility: "bounded", progressLabel: "Early work", progressPercent: 10,
    mainInputs: ["Artisan time"], blockers: [], accelerators: [], support: ["Workshop"], opposition: [],
    spending: "A bounded workshop allocation", lastSemanticDecision: "Seek a reproducible demonstration",
    latestChanges: [], nextCheckpoint: "Next review", evidenceIds: [],
  }];
  assert.throws(() => parseIntentFirstProjection(projection), /evidenceIds must contain at least one evidence ID/);
});

test("command boundary rejects direct state mutation capabilities", () => {
  assert.throws(() => assertIntentFirstCommands({
    submitIntent() {},
    confirmInterpretation() {},
    dismissInterpretation() {},
    advanceTime() {},
    writeWorldState() {},
  }), /commands contains unsupported capability writeWorldState/);
});
