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

for (const scenario of [
  { id: "scenario:europe-1935-benchmark", playerPolityId: "polity:poland", start: "1935-01-01" },
  { id: "scenario:napoleonic-europe-1805", playerPolityId: "polity:france", start: "1805-01-01" },
  { id: "scenario:central-mesoamerica-1450", playerPolityId: "polity:tenochtitlan", start: "1450-01-01" },
]) {
  test(`${scenario.id} opens the production living-world session and resolves its first three-month decision`, async ({ request }) => {
    const gameId = `living-world-start-${scenario.id.split(":")[1]}`;
    await request.delete(`/api/games/${gameId}`).catch(() => {});
    const created = await request.post("/api/games", { data: { id: gameId, name: gameId, scenarioId: scenario.id, playerPolityId: scenario.playerPolityId } });
    expect(created.ok()).toBeTruthy();
    const initial = await (await request.get(`/api/games/${gameId}/living-world`)).json();
    expect(initial.projection.asOf).toBe(scenario.start);
    expect(initial.projection.time.options).toEqual([{ optionId: "advance-three-months", label: "Advance three months" }]);
    const advancedResponse = await request.post(`/api/games/${gameId}/living-world/advance`, { data: {
      revision: initial.projection.revision, sessionRevision: initial.sessionRevision,
      optionId: "advance-three-months", strategicAttempts: initial.strategicTasks.map(hold),
    } });
    expect(advancedResponse.ok()).toBeTruthy();
    const advanced = await advancedResponse.json();
    expect(advanced.lastTransition.submonths).toHaveLength(3);
    expect(advanced.playerDecisionIndex).toBe(1);
    expect(advanced.projection.asOf).not.toBe(scenario.start);
    await request.delete(`/api/games/${gameId}`);
  });
}
