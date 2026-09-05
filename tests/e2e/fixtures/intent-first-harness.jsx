import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { IntentFirstShell } from "/src/Game/GameUI/intentFirstShell.jsx";
import { INTENT_FIRST_UI_SCHEMA_VERSION } from "/src/Game/GameUI/intentFirstProjection.js";

const baseProjection = {
  schemaVersion: INTENT_FIRST_UI_SCHEMA_VERSION,
  revision: `sha256:${"a".repeat(64)}`,
  asOf: "1500-04-01",
  locale: "en",
  playerPolity: { polityId: "polity:harness", displayName: "Marchland Compact" },
  briefing: {
    headline: "Food pressure eased",
    summary: "A better harvest created room for one careful public initiative.",
    changes: [{
      changeId: "change:harvest",
      label: "Available food",
      magnitude: "+12,000 baskets",
      authority: "derived",
      evidenceIds: ["evidence:harvest"],
      sourceLabels: ["Harvest and consumption ledger"],
      causes: [{ category: "production", label: "Recorded harvest", contribution: "+15,000" }, { category: "other", label: "Consumption", contribution: "−3,000" }],
    }],
  },
  facts: [{
    factId: "fact:population",
    label: "Controlled population",
    value: "1,200,000 people",
    authority: "derived",
    evidenceIds: ["evidence:population"],
    sourceLabels: ["Regional cohort ledger"],
    why: ["The engine sums living cohorts in currently controlled regions."],
  }, {
    factId: "fact:foreign-credit",
    label: "Foreign credit",
    value: null,
    authority: "unknown",
    evidenceIds: [],
    unknownReason: "This scenario has no declared foreign-credit measure.",
    why: [],
  }],
  interpretation: null,
  processes: [],
  situations: [{ situationId: "situation:roads", title: "Northern routes are degrading", urgency: "soon", summary: "Movement and market access may worsen before the rains.", evidenceIds: ["evidence:routes"] }],
  diplomacy: {
    conversations: [{ conversationId: "conversation:west", counterparty: "Western League", latestMessage: "They asked whether consultation implies mutual defence." }],
    commitments: [{ commitmentId: "commitment:grain", title: "Seasonal grain passage", summary: "Open through the end of summer.", evidenceIds: ["evidence:commitment"] }],
  },
  details: [{ detailId: "detail:population", label: "Population ledger", summary: "Regional cohorts reconcile with the controlled total." }],
  time: { label: "April 1500", options: [{ optionId: "time:3m", label: "Advance 3 months" }], completedSubmonths: 0, totalSubmonths: 3 },
};

const interpreted = (sourceText) => ({
  interpretationId: "interpretation:harness:1",
  sourceText,
  confirmationRequired: true,
  questions: [],
  claims: sourceText.includes("conquered") ? [{
    claimId: "claim:false-conquest",
    text: "The northern marches were conquered ten turns ago",
    status: "contradicted",
    explanation: "Current control and the causal ledger contradicts that retrospective claim.",
    evidenceIds: ["evidence:control"],
  }] : [],
  requestedActions: [{
    actionId: "action:investigate",
    summary: sourceText.includes("electrical") ? "Open an investigation into observed electrical effects" : "Maintain roads within current labor capacity",
    material: true,
    irreversible: false,
    targetLabels: ["currently controlled routes"],
    evidenceIds: ["evidence:routes"],
  }],
  proposedInitiatives: sourceText.includes("electrical") ? [{
    initiativeId: "initiative:electrical",
    summary: "Proposed electrical-effects investigation",
    material: true,
    irreversible: false,
    targetLabels: ["court workshop"],
    evidenceIds: ["evidence:workshop"],
  }] : [],
  preview: {
    cost: { kind: "range", label: "4,000–7,000 labor-days" },
    duration: { kind: "range", label: "6–12 months" },
    risks: ["Harvest labor may tighten"],
    opportunityCosts: ["Less capacity for irrigation"],
    affected: ["Northern routes", "Rural workforce"],
    evidenceIds: ["evidence:routes"],
  },
});

const Harness = () => {
  const [projection, setProjection] = useState(baseProjection);
  const failIntent = new URLSearchParams(window.location.search).has("failIntent");
  const commands = {
    submitIntent: async ({ revision, intentions }) => {
      if (revision !== projection.revision) throw new Error("Revision changed; review the current world.");
      if (failIntent) throw new Error("Semantic provider is unavailable; the order was not sent.");
      setProjection((current) => ({ ...current, interpretation: interpreted(intentions.join(" ")) }));
    },
    confirmInterpretation: async ({ revision }) => {
      if (revision !== projection.revision) throw new Error("Revision changed; review the current world.");
      setProjection((current) => ({ ...current, interpretation: null }));
    },
    dismissInterpretation: async () => setProjection((current) => ({ ...current, interpretation: null })),
    advanceTime: async ({ revision, optionId }) => {
      if (revision !== projection.revision || optionId !== "time:3m") throw new Error("Time option is stale.");
      setProjection((current) => ({
        ...current,
        revision: `sha256:${"b".repeat(64)}`,
        asOf: "1500-07-01",
        briefing: {
          headline: "The road compact began",
          summary: "Work started within the accepted labor range.",
          changes: [{
            changeId: "change:roads",
            label: "Northern route capacity",
            magnitude: "+18 route capacity",
            authority: "derived",
            evidenceIds: ["evidence:roads-result"],
            sourceLabels: ["Route-capacity ledger"],
            causes: [{ category: "process", label: "Confirmed road-maintenance intention", contribution: "+22" }, { category: "other", label: "Rain damage", contribution: "−4" }],
          }],
        },
        processes: [{
          processId: "process:roads",
          name: "Road maintenance compact",
          direction: "Restore the market and messenger route",
          stage: "emerging",
          pace: "steady",
          feasibility: "Supported with constraints",
          progressPercent: 18,
          progressLabel: "Early works",
          mainInputs: ["Seasonal labor", "Road timber"],
          blockers: ["Seasonal rain"],
          accelerators: ["Available labor"],
          support: ["Market towns"],
          opposition: ["Competing irrigation works"],
          spending: "Within the confirmed labor allocation",
          lastSemanticDecision: "Preserve harvest labor while restoring the messenger route",
          nextCheckpoint: "After the dry-season survey",
          latestChanges: ["Route capacity improved after the first work cycle."],
          evidenceIds: ["evidence:roads-result"],
          sourceLabels: ["Road compact process ledger"],
        }],
        time: { label: "July 1500", options: current.time.options, completedSubmonths: 3, totalSubmonths: 3 },
      }));
    },
  };
  return <IntentFirstShell projection={projection} commands={commands} />;
};

createRoot(document.getElementById("root")).render(<Harness />);
