import { expect, test } from "@playwright/test";

test("the production shell records a typed external proposal without materializing a relationship before its recipient responds", async ({ page, request }) => {
  const gameId = "living-world-diplomacy-e2e";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: {
      id: gameId,
      name: "Typed coalition proposal",
      scenarioId: "scenario:napoleonic-europe-1805",
      playerPolityId: "polity:france",
    },
  });
  expect(created.ok()).toBeTruthy();

  const initial = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  const actor = initial.interpretationContext.entities.find((entry) => entry.entityId === "polity:france");
  expect(actor).toBeTruthy();
  const text = "Offer Bavaria a bounded coalition consultation.";
  const submittedResponse = await request.post(`/api/games/${gameId}/living-world/intent`, { data: {
    revision: initial.projection.revision,
    sessionRevision: initial.sessionRevision,
    intentions: [text],
    modelOutput: {
      revision: initial.projection.revision,
      questions: [],
      claims: [],
      proposedInitiatives: [],
      requestedActions: [{
        actionId: "action:coalition-consultation",
        domain: "diplomacy",
        scope: "external",
        intent: text,
        pace: "slow",
        effectFamilies: ["relation.modify"],
        targetEntityIds: ["polity:france", "polity:bavaria"],
        claimRefs: [],
        evidenceIds: [actor.evidenceIds[0]],
        operation: {
          kind: "diplomacy.propose",
          recipientPolityIds: ["polity:bavaria"],
          relationshipTypeId: "relationship-type:coalition-negotiation",
        },
        sourceSpan: { start: 0, end: text.length, text },
      }],
    },
  } });
  expect(submittedResponse.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "History command center" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Current" }).first().click();
  await page.getByRole("tab", { name: "Решения" }).click();
  await expect(page.getByText("No immediate treasury commitment; frozen proposal terms will be recorded")).toBeVisible();
  await expect(page.getByText("Pending recipient response; no territorial control changes before acceptance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Подтвердить обоснованные действия" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить обоснованные действия" }).click();

  const confirmed = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  expect(confirmed.projection.diplomacy.conversations).toEqual([
    expect.objectContaining({ counterparty: expect.stringMatching(/Bavaria/), status: "awaiting-response" }),
  ]);
  expect(confirmed.projection.diplomacy.commitments.some((entry) => (
    entry.title === "relationship-type:coalition-negotiation"
    && entry.summary.includes("Bavaria")
  ))).toBe(false);
  expect(confirmed.lastTransition.createdDiplomaticProposals).toHaveLength(1);
  await request.delete(`/api/games/${gameId}`);
});
