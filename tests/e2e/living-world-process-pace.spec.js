import { expect, test } from "@playwright/test";

test("the production shell previews and confirms an engine-bounded process pace change", async ({ page, request }) => {
  const gameId = "living-world-process-pace-e2e";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: { id: gameId, name: "Process pace adjustment", scenarioId: "scenario:napoleonic-europe-1805", playerPolityId: "polity:france" },
  });
  expect(created.ok()).toBeTruthy();
  const initial = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  const evidenceId = initial.interpretationContext.entities.find((entry) => entry.entityId === "polity:france").evidenceIds[0];
  const createText = "Establish a bounded dispatch process.";
  const submittedResponse = await request.post(`/api/games/${gameId}/living-world/intent`, { data: {
    revision: initial.projection.revision, sessionRevision: initial.sessionRevision, intentions: [createText],
    modelOutput: { revision: initial.projection.revision, questions: [], claims: [], proposedInitiatives: [], requestedActions: [{
      actionId: "action:dispatch", domain: "administration", scope: "domestic", intent: createText, pace: "slow",
      effectFamilies: ["capacity.modify"], targetEntityIds: ["polity:france"], claimRefs: [], evidenceIds: [evidenceId],
      operation: { kind: "process.propose" }, sourceSpan: { start: 0, end: createText.length, text: createText },
    }] },
  } });
  expect(submittedResponse.ok()).toBeTruthy();
  const submitted = await submittedResponse.json();
  const confirmedResponse = await request.post(`/api/games/${gameId}/living-world/intent/confirm`, { data: {
    revision: submitted.projection.revision, sessionRevision: submitted.sessionRevision,
    interpretationId: submitted.projection.interpretation.interpretationId,
  } });
  expect(confirmedResponse.ok()).toBeTruthy();
  const confirmed = await confirmedResponse.json();
  const process = confirmed.interpretationContext.entities.find((entry) => entry.kind === "process");
  const nextPace = process.allowedPaces.find((pace) => pace !== process.currentPace);
  expect(nextPace).toBeTruthy();
  const adjustText = "Change the dispatch process pace.";
  const adjustmentResponse = await request.post(`/api/games/${gameId}/living-world/intent`, { data: {
    revision: confirmed.projection.revision, sessionRevision: confirmed.sessionRevision, intentions: [adjustText],
    modelOutput: { revision: confirmed.projection.revision, questions: [], claims: [], proposedInitiatives: [], requestedActions: [{
      actionId: "action:adjust-dispatch", domain: "administration", scope: "domestic", intent: adjustText, pace: nextPace,
      effectFamilies: ["knowledge.reveal"], targetEntityIds: [process.entityId], claimRefs: [], evidenceIds: [evidenceId],
      operation: { kind: "process.adjust", processId: process.entityId }, sourceSpan: { start: 0, end: adjustText.length, text: adjustText },
    }] },
  } });
  expect(adjustmentResponse.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "History command center" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Current" }).first().click();
  await page.getByRole("tab", { name: "Решения" }).click();
  await expect(page.getByText("No additional immediate treasury commitment; the existing process commitment remains in force")).toBeVisible();
  await expect(page.getByText("Applied at the next monthly resolution; pace remains subject to engine feasibility")).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить обоснованные действия" }).click();
  const adjusted = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  expect(adjusted.lastTransition.adjustedProcesses).toEqual([expect.objectContaining({ processId: process.entityId, pace: nextPace })]);
  expect(adjusted.interpretationContext.entities.find((entry) => entry.entityId === process.entityId).currentPace).toBe(nextPace);
  await request.delete(`/api/games/${gameId}`);
});
