import { expect, test } from "@playwright/test";

const nextMonth = (date) => {
  const [year, month] = date.split("-").map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`;
};

const utilityFallbacks = (draft) => draft.tasks.map((task) => ({
  taskKey: task.taskKey, failureCode: "mock-utility-unavailable",
}));

const finishMonth = async (request, gameId, draft, strategicDecision) => {
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: "confirm-player",
  } })).json();
  expect(draft.phase).toBe("plan-strategy");
  const strategicPrompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(JSON.stringify(strategicPrompt)).not.toContain("FeatureCollection");
  expect(strategicPrompt.briefs.flatMap((brief) => brief.projectRegionCandidates ?? [])).toHaveLength(15);
  const outputs = [{ decisions: strategicPrompt.briefs.map((brief) => strategicDecision?.(brief, strategicPrompt) ?? ({
    polityId: brief.polityId, intent: "hold", rationale: "No material action.", command: null,
  })) }];
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: "submit-strategy", outputs,
  } })).json();
  expect(draft.phase).toBe("plan-opponents");
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: "submit-opponents", outcomes: utilityFallbacks(draft),
  } })).json();
  expect(draft.phase).toBe("ready");
  return (await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: {
    turnToken: draft.turnToken, turnDigest: draft.turnDigest,
  } })).json();
};

test("P3b negotiates and settles a private bilateral trade through bounded mocked agents", async ({ page, request }) => {
  test.setTimeout(90_000);
  const gameId = "p3b-diplomacy-smoke";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post("/api/games", {
    data: { id: gameId, name: "P3b Diplomacy", scenarioId: "dev-map-6c", setActive: true },
  })).ok()).toBeTruthy();

  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  const proposalId = "proposal:e2e-austria-germany-food";
  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(initial.gameDate), expectedSessionRevision: initial.sessionRevision, actions: [],
    commands: [{
      kind: "diplomacy.propose", commandId: "00000000-0000-4000-8000-000000000101",
      actorPolityId: initial.playerPolityId, recipientPolityId: "polity:germany",
      expectedRevision: initial.revision, effectiveMonth: initial.month, proposalId,
      terms: {
        kind: "trade", fromPolityId: initial.playerPolityId, toPolityId: "polity:germany",
        fromLeg: { kind: "resource", resource: "wood", amount: 10 },
        toLeg: { kind: "treasury", amount: 10 }, cadence: "one-off", durationMonths: 1,
        earlyTerminationPenalty: 0,
      },
    }],
  } })).json();
  const proposed = await finishMonth(request, gameId, draft);
  expect(proposed.diplomacy.proposals.find((entry) => entry.proposalId === proposalId)?.terms.kind).toBe("trade");

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(proposed.gameDate), expectedSessionRevision: proposed.sessionRevision,
    actions: [], commands: [],
  } })).json();
  const settled = await finishMonth(request, gameId, draft, (brief, prompt) => {
    if (brief.polityId !== "polity:germany") return { polityId: brief.polityId, intent: "hold", rationale: "No material action.", command: null };
    expect(brief.proposals.some((entry) => entry.proposalId === proposalId)).toBeTruthy();
    return {
      polityId: brief.polityId, intent: "accept", rationale: "Wood imports support production.",
      command: {
        kind: "diplomacy.respond", actorPolityId: brief.polityId, proposalId, response: "accept",
        expectedRevision: prompt.revision, effectiveMonth: prompt.month,
      },
    };
  });
  const execution = settled.lastTurn.ledger.trade.executions.find((entry) => entry.contractId === "agreement:e2e-austria-germany-food");
  expect(execution).toMatchObject({ fulfillmentBp: 10000, breach: false });
  expect(settled.lastTurn.ledger.trade.resourceTransfers).toContainEqual(expect.objectContaining({
    resource: "wood", amount: 10, fromPolityId: initial.playerPolityId, toPolityId: "polity:germany",
  }));
  expect(settled.lastTurn.ledger.trade.treasuryTransfers).toContainEqual(expect.objectContaining({
    amount: 10, fromPolityId: "polity:germany", toPolityId: initial.playerPolityId,
  }));

  await page.addInitScript(() => {
    localStorage.setItem("Terrain", "false");
    localStorage.setItem("Globe", "false");
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  await page.goto(`/?gameId=${gameId}`);
  await page.waitForTimeout(500);
  expect(pageErrors).toEqual([]);
  await page.getByRole("button", { name: "Open advisor and economy" }).click({ force: true });
  await page.getByRole("button", { name: "Diplomacy" }).click();
  await expect(page.getByTestId("diplomacy-pane")).toBeVisible();
  await expect(page.getByTestId("diplomacy-pane").getByText(/Germany|Германия/).first()).toBeVisible();
  await expect(page.getByText(/100% delivered/)).toBeVisible();
  await request.delete(`/api/games/${gameId}`);
});
