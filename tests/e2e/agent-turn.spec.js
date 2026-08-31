import { expect, test } from "@playwright/test";

const create = async (request, gameId) => {
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const response = await request.post("/api/games", {
    data: { id: gameId, name: "P3a Agent Turn", scenarioId: "dev-map-4c", setActive: true },
  });
  expect(response.ok()).toBeTruthy();
};

test("P3a interprets, confirms, falls back monthly and commits one atomic revision", async ({ request }) => {
  const gameId = "p3a-agent-turn";
  await create(request, gameId);
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  const preparedResponse = await request.post(`/api/games/${gameId}/agent-turn/prepare`, {
    data: {
      targetDate: "1938-03-01",
      expectedSessionRevision: initial.sessionRevision,
      actions: [
        { id: "action-invest-vienna", text: "Инвестировать 100 золотых в Вену" },
        { id: "action-report-economy", text: "Подготовить отчёт о состоянии экономики" },
      ],
    },
  });
  expect(preparedResponse.ok()).toBeTruthy();
  let draft = await preparedResponse.json();
  expect(draft.phase).toBe("interpret-player");
  expect(draft.tasks).toHaveLength(1);
  expect(draft.tasks[0].userPrompt).not.toContain("FeatureCollection");
  expect(JSON.stringify(draft.tasks[0].tool.schema)).not.toContain("commandId");

  const interpreted = await request.post(`/api/games/${gameId}/agent-turn/step`, {
    data: {
      turnToken: draft.turnToken,
      action: "submit-interpretation",
      outputs: [{ actions: [{
        actionId: "action-invest-vienna",
        summary: "Инвестировать 100 золотых в Вену",
        disposition: "command",
        command: {
          kind: "economy.invest-region",
          actorPolityId: "polity:austria",
          targetRegionId: "region:gadm:AUT.9_1",
          expectedRevision: initial.revision,
          effectiveMonth: initial.month,
          spend: 100,
        },
      }, {
        actionId: "action-report-economy",
        summary: "Подготовить экономический отчёт",
        disposition: "report",
        command: null,
      }] }],
    },
  });
  expect(interpreted.ok()).toBeTruthy();
  draft = await interpreted.json();
  expect(draft.phase).toBe("confirm-player");
  expect(draft.confirmation[0].command.spend).toBe(100);
  expect(draft.confirmation[1]).toEqual(expect.objectContaining({ disposition: "report", command: null }));

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, {
    data: { turnToken: draft.turnToken, action: "confirm-player" },
  })).json();
  expect(draft.phase).toBe("plan-opponents");
  expect(draft.tasks).toHaveLength(1);
  expect(JSON.stringify(draft.tasks[0].tool.schema)).not.toContain("commandId");
  expect(draft.tasks[0].context).toEqual(expect.objectContaining({ fullMapIncluded: false, polityCount: 3 }));

  for (let month = 0; month < 2; month += 1) {
    const response = await request.post(`/api/games/${gameId}/agent-turn/step`, {
      data: {
        turnToken: draft.turnToken,
        action: "submit-opponents",
        outcomes: draft.tasks.map((task) => ({ taskKey: task.taskKey, failureCode: "mock-provider-down" })),
      },
    });
    expect(response.ok()).toBeTruthy();
    draft = await response.json();
  }
  expect(draft.phase).toBe("report-player");
  expect(draft.tasks).toHaveLength(1);
  expect(draft.tasks[0].taskId).toBe("reports.explain-economy");
  expect(draft.tasks[0].userPrompt).not.toContain("FeatureCollection");
  const reportPrompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(reportPrompt.polity.id).toBe("polity:austria");
  expect(reportPrompt.requests).toEqual([{ actionId: "action-report-economy", request: "Подготовить отчёт о состоянии экономики" }]);
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, {
    data: {
      turnToken: draft.turnToken,
      action: "submit-reports",
      outputs: [{ reports: [{
        actionId: "action-report-economy",
        title: "Доклад об экономике Австрии",
        body: "Казна и выпуск рассчитаны движком; продовольственный дефицит требует внимания.",
      }] }],
    },
  })).json();
  expect(draft.phase).toBe("ready");
  expect(draft.turnDigest).toMatch(/^sha256:/);

  const committedResponse = await request.post(`/api/games/${gameId}/agent-turn/commit`, {
    data: { turnToken: draft.turnToken, turnDigest: draft.turnDigest },
  });
  expect(committedResponse.ok()).toBeTruthy();
  const committed = await committedResponse.json();
  expect(committed.gameDate).toBe("1938-03-01");
  expect(committed.round).toBe(2);
  expect(committed.engineTurn).toBe(2);
  expect(committed.sessionRevision).not.toBe(initial.sessionRevision);
  expect(committed.agentState.polities).toHaveLength(3);
  expect(committed.agentState.polities.every((entry) => entry.source === "fallback")).toBeTruthy();
  expect(committed.agentTurn.months).toHaveLength(2);
  expect(committed.agentTurn.months.every((month) => month.batchOutcomes.every((batch) => (
    batch.source === "fallback" && batch.failureCode === "mock-provider-down"
  )))).toBeTruthy();
  expect(committed.agentTurn.resolvedMonths).toHaveLength(2);
  expect(committed.agentTurn.reports).toEqual([{
    actionId: "action-report-economy",
    title: "Доклад об экономике Австрии",
    body: "Казна и выпуск рассчитаны движком; продовольственный дефицит требует внимания.",
    source: "model",
    failureCode: null,
  }]);
  expect(committed.regions.find((entry) => entry.regionId === "region:gadm:AUT.9_1").infrastructureBp)
    .toBe(initial.regions.find((entry) => entry.regionId === "region:gadm:AUT.9_1").infrastructureBp + 100);
  expect(await (await request.get(`/api/games/${gameId}/agent-turn/draft`)).json()).toBeNull();

  const restored = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(restored.sessionRevision).toBe(committed.sessionRevision);
  expect(restored.agentTurn).toEqual(committed.agentTurn);
  expect(restored.agentState.consumedActionIds).toContain("action-invest-vienna");
  expect(restored.agentState.consumedActionIds).toContain("action-report-economy");

  // A client crash between the atomic engine commit and the best-effort
  // actions.json status update must not execute the same prose order twice.
  const duplicate = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, {
    data: {
      targetDate: "1938-04-01",
      expectedSessionRevision: restored.sessionRevision,
      actions: [{ id: "action-invest-vienna", text: "Инвестировать 100 золотых в Вену" }],
    },
  })).json();
  expect(duplicate.phase).toBe("confirm-player");
  expect(duplicate.tasks).toEqual([]);
  expect(duplicate.confirmation).toEqual([]);
  await request.delete(`/api/games/${gameId}/agent-turn/draft`);
  await request.delete(`/api/games/${gameId}`);
});

test("read-only economy report commits without advancing date or round and follows locale", async ({ request }) => {
  const gameId = "p3a-read-only-report";
  await create(request, gameId);
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: "1938-02-01",
    expectedSessionRevision: initial.sessionRevision,
    locale: "ru",
    actions: [{ id: "report-only", text: "Подготовить отчёт об экономике" }],
  } })).json();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken,
    action: "submit-interpretation",
    outputs: [{ actions: [{
      actionId: "report-only", summary: "Подготовить отчёт", disposition: "report", command: null,
    }] }],
  } })).json();
  expect(draft.phase).toBe("report-player");
  expect(draft.targetDate).toBe(initial.gameDate);
  expect(draft.tasks[0].systemPrompt).toContain("in Russian");
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken,
    action: "submit-reports",
    outputs: [{ reports: [{ actionId: "report-only", title: "Экономический отчёт", body: "Казна стабильна." }] }],
  } })).json();
  const committed = await (await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: {
    turnToken: draft.turnToken, turnDigest: draft.turnDigest,
  } })).json();
  expect(committed.gameDate).toBe(initial.gameDate);
  expect(committed.round).toBe(initial.round);
  expect(committed.engineTurn).toBe(initial.engineTurn);
  expect(committed.sessionRevision).not.toBe(initial.sessionRevision);
  expect(committed.agentTurn.reports[0]).toEqual(expect.objectContaining({ title: "Экономический отчёт", source: "model" }));
  await request.delete(`/api/games/${gameId}`);
});

test("an unavailable war order cannot be confirmed and does not advance state", async ({ request }) => {
  const gameId = "p3a-unavailable-war";
  await create(request, gameId);
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: "1938-02-01",
    expectedSessionRevision: initial.sessionRevision,
    locale: "ru",
    actions: [{ id: "attack-germany", text: "Напасть на Германию" }],
  } })).json();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken,
    action: "submit-interpretation",
    outputs: [{ actions: [{
      actionId: "attack-germany",
      summary: "Военная механика пока недоступна; приказ не исполнен.",
      disposition: "unsupported",
      command: null,
    }] }],
  } })).json();
  expect(draft.phase).toBe("no-executable-action");
  expect(draft.turnDigest).toBeNull();
  const rejectedCommit = await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: {
    turnToken: draft.turnToken, turnDigest: null,
  } });
  expect(rejectedCommit.ok()).toBeFalsy();
  const unchanged = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(unchanged.sessionRevision).toBe(initial.sessionRevision);
  expect(unchanged.gameDate).toBe(initial.gameDate);
  expect(unchanged.round).toBe(initial.round);
  await request.delete(`/api/games/${gameId}/agent-turn/draft`);
  await request.delete(`/api/games/${gameId}`);
});
