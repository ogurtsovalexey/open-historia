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
    }],
  });

  assert.deepEqual(result, { valid: true, error: "" });
});

