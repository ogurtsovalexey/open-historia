import { expect, test } from "@playwright/test";

test("Central Europe advances map, date and economy from one session revision", async ({ page, request }) => {
  const gameId = "p2-economy-smoke";
  const otherGameId = "p2-economy-smoke-other";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  await request.delete(`/api/games/${otherGameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: { id: gameId, name: "P2 Economy Smoke", scenarioId: "dev-map-4c", setActive: true },
  });
  expect(created.ok()).toBeTruthy();
  const otherCreated = await request.post("/api/games", {
    data: { id: otherGameId, name: "P2 Economy Smoke Other", scenarioId: "dev-map-4c", setActive: false },
  });
  expect(otherCreated.ok()).toBeTruthy();

  const modelCalls = [];
  await page.route(/(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|\/api\/relay)/, async (route) => {
    modelCalls.push(route.request().url());
    await route.abort();
  });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem("Terrain", "false");
    localStorage.setItem("Globe", "false");
  });

  await page.goto(`/?gameId=${gameId}`);
  // The startup progress layer intentionally blocks pointer input while remote
  // map textures warm; invoke the already-mounted control underneath it.
  await page.getByRole("button", { name: "Open advisor and economy" }).click({ force: true });
  const pane = page.getByTestId("economy-pane");
  await expect(pane).toHaveAttribute("data-game-id", gameId, { timeout: 45_000 });
  await expect(page.getByTestId("economy-selected-region")).toBeVisible();
  await expect(pane.getByRole("button", { name: /Advance month|Reset/i })).toHaveCount(0);

  const initialResponse = await request.get(`/api/games/${gameId}/economy/state`);
  const initial = await initialResponse.json();
  const otherInitial = await (await request.get(`/api/games/${otherGameId}/economy/state`)).json();
  expect(initial.playerPolityId).toBe("polity:austria");
  expect(initial.regions.find((region) => region.regionId === "region:gadm:AUT.9_1")?.controllerId).toBe(initial.playerPolityId);

  const foreignCommand = await request.post(`/api/games/${gameId}/economy/advance`, {
    data: {
      targetDate: "1900-02-01",
      expectedSessionRevision: initial.sessionRevision,
      commands: [{
        kind: "economy.invest-region",
        commandId: "00000000-0000-4000-8000-000000000001",
        actorPolityId: "polity:czechia",
        targetRegionId: "region:gadm:CZE.11_1",
        effectiveMonth: initial.month,
        expectedRevision: initial.revision,
        spend: 1,
      }],
    },
  });
  expect(foreignCommand.status()).toBe(400);
  await expect(foreignCommand.json()).resolves.toEqual(expect.objectContaining({
    error: expect.stringContaining("polity:czechia is not the player's polity"),
  }));
  expect((await (await request.get(`/api/games/${gameId}/economy/state`)).json()).sessionRevision).toBe(initial.sessionRevision);
  await expect(page.getByTestId("economy-invest")).toBeVisible();
  await page.evaluate(async () => {
    const { onRegionSelected } = await import("/src/Game/Selection/Regions.jsx");
    onRegionSelected({
      id: "CZE.11_1", GID_1: "CZE.11_1", GID_0: "CZE", gid0: "CZE",
      COUNTRY: "Czechia", NAME_1: "Prague", owner: "Czechia", lngLat: { lng: 14.4, lat: 50.1 },
    });
  });
  await expect(pane).toContainText("Foreign region — view only");
  await expect(page.getByTestId("economy-invest")).toHaveCount(0);

  await page.getByRole("button", { name: "»" }).click();
  await page.getByRole("button", { name: "2/1/1900 1 month" }).click();
  await expect(pane).toContainText("1900-02-01", { timeout: 15_000 });
  const advancedResponse = await request.get(`/api/games/${gameId}/economy/state`);
  const advanced = await advancedResponse.json();
  expect(advanced.actualMonthlyTicks).toBe(1);
  expect(advanced.sessionRevision).not.toBe(initial.sessionRevision);
  expect(advanced.revision).not.toBe(initial.revision);
  const otherAfterAdvance = await (await request.get(`/api/games/${otherGameId}/economy/state`)).json();
  expect(otherAfterAdvance.sessionRevision).toBe(otherInitial.sessionRevision);
  expect(otherAfterAdvance.gameDate).toBe(otherInitial.gameDate);

  const stale = await request.post(`/api/games/${gameId}/economy/advance`, {
    data: { targetDate: "1900-03-01", expectedSessionRevision: initial.sessionRevision, commands: [] },
  });
  expect(stale.status()).toBe(409);

  await expect(pane).toContainText("Round 2");
  await expect(pane).toContainText("Last economic report");
  await expect(page.getByText("P2 Economy Smoke / Austria / 1900-02-01")).toBeVisible();
  const runtimeGame = await (await request.get("/api/runtime/json/game")).json();
  const runtimeWorld = await (await request.get("/api/runtime/json/world")).json();
  expect(runtimeGame.gameDate).toBe(advanced.gameDate);
  expect(runtimeGame.round).toBe(advanced.round);
  expect(runtimeWorld.regionOwnershipOverrides).toEqual(expect.objectContaining(advanced.ownershipOverrides));
  expect(modelCalls).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !/Bad response code: 404|Failed to load resource: the server responded with a status of 404|Startup preload failed during|Failed to load (country names|country labels|timeline lookups|region catalog)/.test(message)
  );
  expect(unexpectedConsoleErrors).toEqual([]);

  await request.delete(`/api/games/${gameId}`);
  await request.delete(`/api/games/${otherGameId}`);
});
