import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCampaignMemoryOps,
  buildCampaignMemoryText,
  deriveCampaignMemoryId,
  normalizeCampaignMemory,
} from "./campaignMemory.js";
import { normalizeWorldState } from "./gameState.js";

test("normalizes legacy arrays, drops empty facts, and derives stable ids", () => {
  const rawFact = {
    category: "Treaty",
    statement: "France and Russia guarantee the settlement.",
    parties: ["France", "Russia", "france"],
    sources: ["event-1"],
  };
  const first = normalizeCampaignMemory([rawFact]);
  const second = normalizeCampaignMemory({ facts: [rawFact, { statement: "" }] });

  assert.equal(first.version, 1);
  assert.equal(first.facts.length, 1);
  assert.deepEqual(first.facts[0].parties, ["France", "Russia"]);
  assert.equal(first.facts[0].id, deriveCampaignMemoryId(rawFact));
  assert.equal(second.facts[0].id, first.facts[0].id);
});

test("accepts only evidence-backed new facts from the current batch", () => {
  const memory = applyCampaignMemoryOps(null, [
    {
      op: "upsert",
      id: "",
      category: "alliance",
      statement: "France and Russia maintain a defensive alliance.",
      parties: ["France", "Russia"],
      status: "active",
      sinceDate: "1810-04-12",
      endedDate: "",
      evidenceIds: ["event-real", "event-invented"],
    },
    {
      op: "upsert",
      id: "fabricated-fact",
      category: "war",
      statement: "Britain declared war.",
      parties: ["Britain"],
      status: "active",
      sinceDate: "1810-04-12",
      endedDate: "",
      evidenceIds: ["event-invented"],
    },
  ], {
    allowedEvidenceIds: ["event-real"],
    currentRound: 8,
  });

  assert.equal(memory.facts.length, 1);
  assert.deepEqual(memory.facts[0].evidenceIds, ["event-real"]);
  assert.equal(memory.facts[0].createdRound, 8);
});

test("resolves existing facts without deleting their prior evidence or history", () => {
  const initial = normalizeCampaignMemory({ facts: [{
    id: "treaty-1",
    category: "treaty",
    statement: "A non-aggression treaty binds France and Russia.",
    parties: ["France", "Russia"],
    status: "active",
    sinceDate: "1810-01-01",
    evidenceIds: ["event-start"],
    createdRound: 3,
  }] });
  const next = applyCampaignMemoryOps(initial, [{
    op: "resolve",
    id: "treaty-1",
    category: "treaty",
    statement: "Russia broke the non-aggression treaty.",
    parties: ["France", "Russia"],
    status: "broken",
    sinceDate: "1810-01-01",
    endedDate: "1812-06-24",
    evidenceIds: ["event-break"],
  }], {
    allowedEvidenceIds: ["event-break"],
    currentDate: "1812-06-24",
    currentRound: 14,
  });

  assert.equal(next.facts.length, 1);
  assert.equal(next.facts[0].status, "broken");
  assert.equal(next.facts[0].endedDate, "1812-06-24");
  assert.equal(next.facts[0].createdRound, 3);
  assert.equal(next.facts[0].updatedRound, 14);
  assert.deepEqual(next.facts[0].evidenceIds, ["event-start", "event-break"]);
  assert.match(buildCampaignMemoryText(next), /treaty-1/);
  assert.match(buildCampaignMemoryText(next), /broken/);
});

test("ignores attempts to resolve unknown facts or cite unknown evidence", () => {
  const next = applyCampaignMemoryOps(null, [{
    op: "resolve",
    id: "unknown",
    category: "war",
    statement: "A war ended.",
    parties: [],
    status: "resolved",
    sinceDate: "",
    endedDate: "",
    evidenceIds: ["made-up"],
  }], { allowedEvidenceIds: ["real"] });

  assert.deepEqual(next, { version: 1, facts: [] });
});

test("old world saves gain empty memory and new memory survives normalization", () => {
  assert.deepEqual(normalizeWorldState({}).campaignMemory, { version: 1, facts: [] });

  const world = normalizeWorldState({
    campaignMemory: {
      facts: [{
        id: "divergence-1",
        category: "divergence",
        statement: "The 1812 invasion never occurred.",
        parties: ["France", "Russia"],
        status: "active",
        evidenceIds: ["event-1"],
      }],
    },
  });
  assert.equal(world.campaignMemory.facts[0].id, "divergence-1");
  assert.equal(world.campaignMemory.facts[0].statement, "The 1812 invasion never occurred.");
});
