import { expect, test } from "@playwright/test";

test("timeline confirms a prose order and runs bounded opponent planning", async ({ page, request }) => {
  test.setTimeout(90_000);
  const gameId = "p3a-agent-turn-ui";
  await request.put("/api/ui-settings", { data: { language: "en" } });
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post("/api/games", {
    data: { id: gameId, name: "P3a Agent UI", scenarioId: "dev-map-4c", setActive: true },
  })).ok()).toBeTruthy();
  expect((await request.put("/api/runtime/json/actions", { data: [{
    id: "ui-invest-vienna",
    kind: "action",
    source: "manual",
    status: "planned",
    title: "Инвестиции в Вену",
    text: "Инвестировать 100 золотых в Вену",
    rawInput: "Инвестировать 100 золотых в Вену",
  }, {
    id: "ui-report-economy",
    kind: "action",
    source: "manual",
    status: "planned",
    title: "Экономический отчёт",
    text: "Подготовить отчёт о состоянии экономики",
    rawInput: "Подготовить отчёт о состоянии экономики",
  }] })).ok()).toBeTruthy();

  await page.addInitScript(() => {
    localStorage.setItem("ui_language", "en");
    localStorage.setItem("api_provider", "gemini");
    localStorage.setItem("gemini_api_key", "synthetic-test-key");
    localStorage.setItem("gemini_model", "gemini-3.5-flash-lite");
    localStorage.setItem("ai_reasoning_enabled", "0");
    localStorage.setItem("Terrain", "false");
    localStorage.setItem("Globe", "false");
  });

  const calls = [];
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    const body = route.request().postDataJSON();
    const declaration = body.tools?.[0]?.functionDeclarations?.[0];
    const prompt = JSON.parse(body.contents?.at(-1)?.parts?.[0]?.text ?? "{}");
    expect(JSON.stringify(declaration?.parameters)).not.toContain('"const"');
    if (declaration?.name !== "submit_player_economy_reports") {
      expect(JSON.stringify(declaration?.parameters)).toContain('"enum":["economy.invest-region"]');
    }
    calls.push({ name: declaration?.name, body, prompt });
    let args;
    if (declaration?.name === "submit_player_economy_orders") {
      args = { actions: prompt.actions.map((action, index) => ({
        actionId: action.id,
        summary: action.id === "ui-report-economy" ? "Подготовить экономический отчёт" : "Инвестировать 100 золотых в Вену",
        disposition: action.id === "ui-report-economy" ? "report" : "command",
        command: action.id === "ui-report-economy" ? null : {
          kind: "economy.invest-region",
          actorPolityId: prompt.polityId,
          targetRegionId: "region:gadm:AUT.9_1",
          expectedRevision: prompt.revision,
          effectiveMonth: prompt.month,
          spend: 100,
        },
      })) };
    } else if (declaration?.name === "submit_player_economy_reports") {
      args = { reports: prompt.requests.map((request) => ({
        actionId: request.actionId,
        title: "Доклад об экономике Австрии",
        body: "Казна выросла, но сохраняется продовольственный дефицит.",
      })) };
    } else {
      args = { decisions: prompt.briefs.map((brief) => ({
        polityId: brief.polityId,
        intent: "conserve",
        rationale: "No bounded investment is necessary this month.",
        command: null,
      })) };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{
        functionCall: { name: declaration.name, args },
      }] } }] }),
    });
  });

  await page.goto(`/?gameId=${gameId}`);
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  await page.getByRole("button", { name: "»" }).click({ force: true });
  await page.getByRole("button", { name: /2\/1\/1938/ }).click();
  await expect(page.getByTestId("agent-order-confirmation")).toContainText("Вену", { timeout: 30_000 });
  await expect(page.getByTestId("agent-order-confirmation")).toContainText("report");
  await expect(page.getByTestId("agent-order-confirmation")).toContainText("Confirm & advance");
  expect(calls).toHaveLength(1);
  expect(calls[0].body.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
  expect(JSON.stringify(calls[0].prompt)).not.toContain("FeatureCollection");
  await page.getByTestId("confirm-agent-turn").click();

  await expect.poll(async () => (await (await request.get(`/api/games/${gameId}/economy/state`)).json()).gameDate, {
    timeout: 30_000,
  }).toBe("1938-02-01");
  const committed = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(calls.map((entry) => entry.name)).toEqual([
    "submit_player_economy_orders", "submit_opponent_economy_decisions", "submit_player_economy_reports",
  ]);
  expect(calls[1].prompt.briefs).toHaveLength(3);
  expect(calls[1].prompt.briefs.every((brief) => JSON.stringify(brief).length <= 1600)).toBeTruthy();
  expect(committed.regions.find((region) => region.regionId === "region:gadm:AUT.9_1").infrastructureBp)
    .toBe(initial.regions.find((region) => region.regionId === "region:gadm:AUT.9_1").infrastructureBp + 100);
  expect(committed.agentState.polities.every((polity) => polity.source === "model")).toBeTruthy();
  expect(committed.agentState.consumedActionIds).toEqual(["ui-invest-vienna", "ui-report-economy"]);
  expect((await (await request.get("/api/runtime/json/actions")).json()).map((action) => action.status)).toEqual(["resolved", "resolved"]);
  await expect(page.getByText("Доклад об экономике Австрии")).toBeVisible();
  await expect(page.getByText("Казна выросла, но сохраняется продовольственный дефицит.")).toBeVisible();
  await request.delete(`/api/games/${gameId}`);
});

test("read-only report skips confirmation and does not advance time", async ({ page, request }) => {
  test.setTimeout(60_000);
  const gameId = "p3a-report-only-ui";
  await request.put("/api/ui-settings", { data: { language: "ru" } });
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post("/api/games", { data: { id: gameId, name: "P3a Report UI", scenarioId: "dev-map-4c", setActive: true } })).ok()).toBeTruthy();
  expect((await request.put("/api/runtime/json/actions", { data: [{
    id: "ui-report-only", kind: "action", source: "manual", status: "planned",
    title: "Экономический отчёт", text: "Подготовить отчёт об экономике", rawInput: "Подготовить отчёт об экономике",
  }] })).ok()).toBeTruthy();
  await page.addInitScript(() => {
    localStorage.setItem("ui_language", "ru");
    localStorage.setItem("api_provider", "gemini");
    localStorage.setItem("gemini_api_key", "synthetic-test-key");
    localStorage.setItem("gemini_model", "gemini-3.5-flash-lite");
    localStorage.setItem("ai_reasoning_enabled", "0");
    localStorage.setItem("Terrain", "false");
    localStorage.setItem("Globe", "false");
  });
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    const body = route.request().postDataJSON();
    const declaration = body.tools?.[0]?.functionDeclarations?.[0];
    const prompt = JSON.parse(body.contents?.at(-1)?.parts?.[0]?.text ?? "{}");
    const args = declaration.name === "submit_player_economy_orders"
      ? { actions: [{ actionId: "ui-report-only", summary: "Подготовить отчёт", disposition: "report", command: null }] }
      : { reports: [{ actionId: prompt.requests[0].actionId, title: "Экономический отчёт", body: "Казна и производство рассчитаны движком." }] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: declaration.name, args } }] } }] }) });
  });
  await page.goto(`/?gameId=${gameId}`);
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  await page.getByRole("button", { name: "»" }).click({ force: true });
  await page.getByRole("button", { name: /2\/1\/1938/ }).click();
  await expect(page.getByText("Экономический отчёт")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("confirm-agent-turn")).toHaveCount(0);
  const committed = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(committed.gameDate).toBe(initial.gameDate);
  expect(committed.round).toBe(initial.round);
  await request.delete(`/api/games/${gameId}`);
});

test("unavailable war order has no confirm action and cannot advance time", async ({ page, request }) => {
  test.setTimeout(60_000);
  const gameId = "p3a-war-unavailable-ui";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post("/api/games", { data: { id: gameId, name: "P3a War UI", scenarioId: "dev-map-4c", setActive: true } })).ok()).toBeTruthy();
  expect((await request.put("/api/runtime/json/actions", { data: [{
    id: "ui-attack-germany", kind: "action", source: "manual", status: "planned",
    title: "Напасть на Германию", text: "Напасть на Германию", rawInput: "Напасть на Германию",
  }] })).ok()).toBeTruthy();
  await page.addInitScript(() => {
    localStorage.setItem("ui_language", "ru");
    localStorage.setItem("api_provider", "gemini");
    localStorage.setItem("gemini_api_key", "synthetic-test-key");
    localStorage.setItem("gemini_model", "gemini-3.5-flash-lite");
    localStorage.setItem("Terrain", "false");
    localStorage.setItem("Globe", "false");
  });
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    const body = route.request().postDataJSON();
    const declaration = body.tools[0].functionDeclarations[0];
    const args = { actions: [{
      actionId: "ui-attack-germany", disposition: "unsupported", command: null,
      summary: "Военная механика пока недоступна; приказ не исполнен.",
    }] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: declaration.name, args } }] } }] }) });
  });
  await page.goto(`/?gameId=${gameId}`);
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  await page.getByRole("button", { name: "»" }).click({ force: true });
  await page.getByRole("button", { name: /2\/1\/1938/ }).click();
  await expect(page.getByTestId("agent-order-confirmation")).toContainText("Военная механика пока недоступна", { timeout: 30_000 });
  await expect(page.getByTestId("confirm-agent-turn")).toHaveCount(0);
  const unchanged = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(unchanged.sessionRevision).toBe(initial.sessionRevision);
  expect(unchanged.gameDate).toBe(initial.gameDate);
  expect(unchanged.round).toBe(initial.round);
  await request.delete(`/api/games/${gameId}`);
});
