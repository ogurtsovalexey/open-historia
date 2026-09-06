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

test("a living-world territorial offer remains pending until the addressed polity accepts its frozen choice", async ({ page, request }) => {
  const gameId = "living-world-territory-e2e";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: { id: gameId, name: "Territory offer", scenarioId: "scenario:napoleonic-europe-1805", playerPolityId: "polity:france" },
  });
  expect(created.ok()).toBeTruthy();
  const initial = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  const region = initial.interpretationContext.entities.find((entry) => (
    entry.kind === "region" && entry.legalOwnerPolityId === "polity:france" && entry.actualControllerPolityId === "polity:france"
  ));
  const evidenceId = initial.interpretationContext.entities.find((entry) => entry.entityId === "polity:france").evidenceIds[0];
  expect(region).toBeTruthy();
  const text = `Offer ${region.label} to Austria.`;
  const submittedResponse = await request.post(`/api/games/${gameId}/living-world/intent`, { data: {
    revision: initial.projection.revision, sessionRevision: initial.sessionRevision, intentions: [text],
    modelOutput: { revision: initial.projection.revision, questions: [], claims: [], proposedInitiatives: [], requestedActions: [{
      actionId: "action:offer-region", domain: "diplomacy", scope: "external", intent: text, pace: "slow",
      effectFamilies: ["relation.modify"], targetEntityIds: [region.entityId, "polity:austria"], claimRefs: [], evidenceIds: [evidenceId],
      operation: { kind: "territory.offer", recipientPolityId: "polity:austria", regionId: region.entityId },
      sourceSpan: { start: 0, end: text.length, text },
    }] },
  } });
  expect(submittedResponse.ok()).toBeTruthy();
  const submitted = await submittedResponse.json();
  // The semantic envelope is seeded through the deterministic test adapter,
  // but the pending-offer preview and confirmation use the production browser
  // shell. This prevents a legal frozen proposal from regressing into a UI
  // that calls it blocked.
  await page.goto("/");
  // Production boot also warms PMTiles; wait for the actual command center
  // rather than asserting against the transient world-texture loading shell.
  await expect(page.getByRole("complementary", { name: "History command center" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Current" }).first().click();
  await page.getByRole("tab", { name: "Решения" }).click();
  await expect(page.getByText("frozen proposal terms will be recorded")).toBeVisible();
  await expect(page.getByText("no territorial control changes before acceptance")).toBeVisible();
  await expect(page.getByText("The addressed polity can reject the frozen terms")).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить обоснованные действия" }).click();
  await expect(page.getByRole("button", { name: "Продолжить на три месяца" })).toBeEnabled();
  const confirmed = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  expect(confirmed.interpretationContext.entities.find((entry) => entry.entityId === region.entityId).legalOwnerPolityId).toBe("polity:france");
  const austriaTask = confirmed.strategicTasks.find((task) => task.actorPolityId === "polity:austria");
  const acceptChoice = austriaTask.brief.frozenChoices.find((choice) => choice.choiceId.startsWith("choice:proposal-accept-"));
  expect(acceptChoice).toBeTruthy();
  const advancedResponse = await request.post(`/api/games/${gameId}/living-world/advance`, { data: {
    revision: confirmed.projection.revision, sessionRevision: confirmed.sessionRevision, optionId: "advance-three-months",
    strategicAttempts: confirmed.strategicTasks.map((task) => task.taskKey === austriaTask.taskKey ? {
      ...hold(task), modelOutput: { ...hold(task).modelOutput, selectedChoiceIds: [acceptChoice.choiceId], evidenceIds: [acceptChoice.factsUsed[0]], hold: null },
    } : hold(task)),
  } });
  expect(advancedResponse.ok()).toBeTruthy();
  const advanced = await advancedResponse.json();
  expect(advanced.interpretationContext.entities.find((entry) => entry.entityId === region.entityId).legalOwnerPolityId).toBe("polity:austria");
  expect(advanced.projection.asOf).toBe("1805-04-01");
  expect(advanced.playerDecisionIndex).toBe(1);
  expect(advanced.lastTransition.submonths).toHaveLength(3);
  expect(advanced.projection.briefing.territoryEffects).toHaveLength(1);
  expect(advanced.projection.briefing.territoryEffects[0]).toMatchObject({
    fromPolityId: "polity:france", toPolityId: "polity:austria",
  });
  await request.delete(`/api/games/${gameId}`);
});
