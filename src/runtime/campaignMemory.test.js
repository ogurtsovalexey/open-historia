import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCampaignMemoryOps,
  buildCampaignMemoryText,
  deriveCampaignMemoryId,
  normalizeCampaignMemory,
  selectCampaignMemoryFacts,
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
  assert.deepEqual(first.facts[0].entityRefs, []);
  assert.deepEqual(first.facts[0].domains, ["other"]);
  assert.equal(first.facts[0].salience, "minor");
  assert.deepEqual(first.facts[0].causedBy, []);
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
      entityRefs: ["FRA", "RUS"],
      domains: ["diplomacy"],
      salience: "major",
      causedBy: ["event-real"],
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
    allowedEntityIds: ["FRA", "RUS"],
    currentRound: 8,
  });

  assert.equal(memory.version, 2);
  assert.equal(memory.facts.length, 1);
  assert.deepEqual(memory.facts[0].evidenceIds, ["event-real"]);
  assert.deepEqual(memory.facts[0].entityRefs, ["FRA", "RUS"]);
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

  assert.deepEqual(next, { version: 2, facts: [] });
});

test("rejects changed facts without current evidence and unknown entity or causal refs", () => {
  const initial = normalizeCampaignMemory({ version: 1, facts: [{
    id: "treaty-1",
    statement: "A treaty exists.",
    evidenceIds: ["event-old"],
  }] });
  const operations = [
    {
      op: "upsert", id: "treaty-1", statement: "The treaty changed.",
      evidenceIds: ["event-old"], entityRefs: ["FRA"], domains: ["diplomacy"],
      salience: "major", causedBy: [],
    },
    {
      op: "upsert", id: "unknown-entity", statement: "An unknown state acts.",
      evidenceIds: ["event-new"], entityRefs: ["ATL"], domains: ["war"],
      salience: "major", causedBy: [],
    },
    {
      op: "upsert", id: "unknown-cause", statement: "An unexplained crisis begins.",
      evidenceIds: ["event-new"], entityRefs: ["FRA"], domains: ["politics"],
      salience: "material", causedBy: ["event-invented"],
    },
  ];

  const next = applyCampaignMemoryOps(initial, operations, {
    allowedEvidenceIds: ["event-new"],
    allowedEntityIds: ["FRA"],
    currentRound: 9,
  });

  assert.deepEqual(next.facts, initial.facts);
});

const fact = (id, overrides = {}) => ({
  id,
  category: "other",
  statement: `Fact ${id}`,
  parties: [],
  status: "active",
  sinceDate: "",
  endedDate: "",
  evidenceIds: [`event-${id}`],
  entityRefs: [],
  domains: ["other"],
  salience: "minor",
  causedBy: [],
  createdRound: 1,
  updatedRound: 1,
  ...overrides,
});

test("selects deterministic domain-relevant memory with score and id tie-breaks", () => {
  const memory = { version: 2, facts: [
    fact("dynasty-scandal", {
      statement: "A royal marriage scandal divides the court.",
      entityRefs: ["FRA"], domains: ["dynasty", "politics"], salience: "major", updatedRound: 18,
    }),
    fact("trade-a", {
      statement: "France depends on Russian grain.",
      entityRefs: ["FRA", "RUS"], domains: ["economy"], salience: "material", updatedRound: 19,
    }),
    fact("trade-b", {
      statement: "France depends on Russian iron.",
      entityRefs: ["FRA", "RUS"], domains: ["economy"], salience: "material", updatedRound: 19,
    }),
  ] };
  const context = {
    task: "economy-brief", actorEntityId: "FRA", targetEntityIds: ["RUS"],
    domains: ["economy"], currentRound: 20,
  };

  assert.deepEqual(
    selectCampaignMemoryFacts(memory, context).map((entry) => entry.id),
    ["trade-a", "trade-b"],
  );
  assert.deepEqual(selectCampaignMemoryFacts(memory, context), selectCampaignMemoryFacts(memory, context));

  assert.deepEqual(
    selectCampaignMemoryFacts(memory, { ...context, task: "diplomatic-brief", domains: ["diplomacy", "politics", "dynasty"] })
      .map((entry) => entry.id),
    ["dynasty-scandal"],
  );
});

test("enforces fact and character budgets without truncating records", () => {
  const memory = { version: 2, facts: Array.from({ length: 15 }, (_, index) => fact(`fact-${String(index).padStart(2, "0")}`, {
    statement: `Statement ${index} ${"x".repeat(80)}`,
    domains: ["war"], updatedRound: index,
  })) };
  const selected = selectCampaignMemoryFacts(memory, {
    domains: ["war"], currentRound: 20, maxFacts: 12, maxCharacters: 650,
  });
  const rendered = buildCampaignMemoryText(memory, {
    context: { domains: ["war"], currentRound: 20, maxFacts: 12, maxCharacters: 650 },
  });

  assert.ok(selected.length <= 12);
  assert.ok(rendered.length <= 650);
  assert.ok(selected.every((entry) => rendered.includes(entry.statement)));
});

test("required facts lead the selection, unknown ids fail, and old resolved facts stay out", () => {
  const memory = { version: 2, facts: [
    fact("active" , { domains: ["politics"], updatedRound: 30 }),
    fact("old-cause", { status: "resolved", domains: ["war"], updatedRound: 1 }),
  ] };
  const selected = selectCampaignMemoryFacts(memory, {
    domains: ["politics"], requiredFactIds: ["old-cause"], currentRound: 30,
  });

  assert.deepEqual(selected.map((entry) => entry.id), ["old-cause", "active"]);
  assert.deepEqual(
    selectCampaignMemoryFacts(memory, { domains: ["war"], currentRound: 30 }),
    [],
  );
  assert.throws(
    () => selectCampaignMemoryFacts(memory, { requiredFactIds: ["missing"] }),
    /Unknown required campaign memory fact id: missing/,
  );
});

test("old world saves gain empty v2 memory while explicit v1 memory stays v1 until updated", () => {
  assert.deepEqual(normalizeWorldState({}).campaignMemory, { version: 2, facts: [] });

  const world = normalizeWorldState({
    campaignMemory: {
      version: 1,
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
  assert.equal(world.campaignMemory.version, 1);
  assert.deepEqual(world.campaignMemory.facts[0].domains, ["other"]);

  const updated = applyCampaignMemoryOps(world.campaignMemory, [{
    op: "upsert",
    id: "divergence-1",
    category: "divergence",
    statement: "The 1812 invasion never occurred, preserving the settlement.",
    parties: ["France", "Russia"],
    status: "active",
    sinceDate: "1812-01-01",
    endedDate: "",
    evidenceIds: ["event-2"],
    entityRefs: ["FRA", "RUS"],
    domains: ["diplomacy", "politics"],
    salience: "critical",
    causedBy: ["event-2"],
  }], {
    allowedEvidenceIds: ["event-2"],
    allowedEntityIds: ["FRA", "RUS"],
    currentRound: 2,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.facts.length, 1);
  assert.deepEqual(updated.facts[0].evidenceIds, ["event-1", "event-2"]);
});
