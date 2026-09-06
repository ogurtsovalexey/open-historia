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

test("the production shell surfaces canonical Mesoamerican tribute arrears as a situation", async ({ page, request }) => {
  const gameId = "living-world-tribute-situation-e2e";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: {
      id: gameId,
      name: "Tribute arrears situation",
      scenarioId: "scenario:central-mesoamerica-1450",
      playerPolityId: "polity:tenochtitlan",
    },
  });
  expect(created.ok()).toBeTruthy();

  const initial = await (await request.get(`/api/games/${gameId}/living-world`)).json();
  const advancedResponse = await request.post(`/api/games/${gameId}/living-world/advance`, { data: {
    revision: initial.projection.revision,
    sessionRevision: initial.sessionRevision,
    optionId: "advance-three-months",
    strategicAttempts: initial.strategicTasks.map(hold),
  } });
  expect(advancedResponse.ok()).toBeTruthy();
  const advanced = await advancedResponse.json();
  expect(advanced.projection.situations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      situationId: "situation:tribute-arrears-obligation-xochimilco-triple-alliance",
      urgency: "medium",
    }),
  ]));

  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "History command center" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Current" }).first().click();
  await page.getByRole("tab", { name: "Ситуации" }).click();
  await expect(page.getByText("Xochimilco tribute remains in arrears")).toBeVisible();
  await expect(page.getByText("unsettled maize deliveries")).toBeVisible();
  await page.getByRole("button", { name: /Respond with an intention|Ответить намерением/ }).click();
  await expect(page.getByRole("tab", { name: "Решения", selected: true })).toBeVisible();

  await request.delete(`/api/games/${gameId}`);
});
