import assert from "node:assert/strict";
import test from "node:test";

import { validateGameplayPayload } from "./gameplaySchemas.js";

test("event consolidation requires a memory operation list", () => {
  assert.deepEqual(
    validateGameplayPayload("eventConsolidator", { summary: "A durable summary.", memoryOps: [] }),
    { valid: true, error: "" },
  );
  assert.equal(
    validateGameplayPayload("eventConsolidator", { summary: "A legacy summary." }).valid,
    false,
  );
});

test("event consolidation accepts a fully structured evidence-backed operation", () => {
  const result = validateGameplayPayload("eventConsolidator", {
    summary: "France and Russia remain bound by the settlement.",
    memoryOps: [{
      op: "upsert",
      id: "treaty-1810",
      category: "treaty",
      statement: "France and Russia guarantee the 1810 settlement.",
      parties: ["France", "Russia"],
      status: "active",
      sinceDate: "1810-04-12",
      endedDate: "",
      evidenceIds: ["event-1810-settlement"],
      entityRefs: ["FRA", "RUS"],
      domains: ["diplomacy"],
      salience: "major",
      causedBy: [],
    }],
  });

  assert.deepEqual(result, { valid: true, error: "" });
});

test("event consolidation rejects missing or invalid v2 relevance metadata", () => {
  const base = {
    op: "upsert", id: "fact-1", category: "other", statement: "A durable fact.",
    parties: [], status: "active", sinceDate: "", endedDate: "", evidenceIds: ["event-1"],
    entityRefs: [], domains: ["politics"], salience: "material", causedBy: [],
  };
  assert.equal(validateGameplayPayload("eventConsolidator", { summary: "Summary", memoryOps: [{ ...base, domains: ["science"] }] }).valid, false);
  const { salience: _salience, ...missingSalience } = base;
  assert.equal(validateGameplayPayload("eventConsolidator", { summary: "Summary", memoryOps: [missingSalience] }).valid, false);
});
