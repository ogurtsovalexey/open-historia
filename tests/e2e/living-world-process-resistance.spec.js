import { expect, test } from "@playwright/test";

const hold = (task) => ({
  taskKey: task.taskKey,
  status: "succeeded",
  modelOutput: {
    polityId: task.actorPolityId, revision: task.brief.revision,
    selectedChoiceIds: [], processDecisions: [], initiativeProposals: [],
    durablePlan: { objective: "Preserve current capacity.", goals: [], commitments: [], revisit: "Review a material change." },
    evidenceIds: [task.brief.evidence[0].evidenceId],
    hold: { reason: "no-legal-action", detail: "No other action is selected.", revisit: "next-quarter" },
  },
});

test("the production shell surfaces process resistance only after a resolved checkpoint", async ({ page, request }) => {
  const gameId = "living-world-process-resistance-e2e";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: { id: gameId, name: "Process resistance situation", scenarioId: "scenario:napoleonic-europe-1805", playerPolityId: "polity:france" },
  });
  expect(created.ok()).toBeTruthy();
  const initial = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  const actorEvidence = initial.interpretationContext.entities.find((entry) => entry.entityId === "polity:france").evidenceIds[0];
  const text = "Establish a bounded supply correspondence process.";
  const submittedResponse = await request.post(`/api/games/${gameId}/living-world/intent`, { data: {
    revision: initial.projection.revision,
    sessionRevision: initial.sessionRevision,
    intentions: [text],
    modelOutput: {
      revision: initial.projection.revision, questions: [], claims: [], proposedInitiatives: [],
      requestedActions: [{
        actionId: "action:supply-correspondence", domain: "military", scope: "domestic", intent: text, pace: "slow",
        effectFamilies: ["capacity.modify"], targetEntityIds: ["polity:france"], claimRefs: [], evidenceIds: [actorEvidence],
        operation: { kind: "process.propose" }, sourceSpan: { start: 0, end: text.length, text },
      }],
    },
  } });
  expect(submittedResponse.ok()).toBeTruthy();
  const submitted = await submittedResponse.json();
  const confirmedResponse = await request.post(`/api/games/${gameId}/living-world/intent/confirm`, { data: {
    revision: submitted.projection.revision,
    sessionRevision: submitted.sessionRevision,
    interpretationId: submitted.projection.interpretation.interpretationId,
  } });
  expect(confirmedResponse.ok()).toBeTruthy();
  const confirmed = await confirmedResponse.json();
  expect(confirmed.projection.situations.some((entry) => entry.situationId.startsWith("situation:process-resistance-"))).toBeFalsy();
  const advancedResponse = await request.post(`/api/games/${gameId}/living-world/advance`, { data: {
    revision: confirmed.projection.revision,
    sessionRevision: confirmed.sessionRevision,
    optionId: "advance-three-months",
    strategicAttempts: confirmed.strategicTasks.map(hold),
  } });
  expect(advancedResponse.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "History command center" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Current" }).first().click();
  await page.getByRole("tab", { name: "Ситуации" }).click();
  await expect(page.getByText(/supply correspondence process\.? faces recorded resistance/i)).toBeVisible();
  await expect(page.getByText("Any pace change remains limited to engine-feasible options.")).toBeVisible();

  await request.delete(`/api/games/${gameId}`);
});
