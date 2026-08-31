import { expect, test } from "@playwright/test";

test("Central Europe advances map, date and economy from one session revision", async ({ page, request }) => {
  test.setTimeout(90_000);
  const gameId = "p2-economy-smoke";
  const otherGameId = "p2-economy-smoke-other";
  await request.put("/api/ui-settings", { data: { language: "en" } });
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
    localStorage.removeItem("ui_language");
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
  // Exercise the real pointer path. At the scenario's fixed 1280×720 start
  // view this point is inside Czechia and outside the right-hand drawer.
  await page.locator("canvas.maplibregl-canvas").click({ position: { x: 780, y: 400 } });
  await expect(pane).toContainText("Foreign region — view only");
  await expect(page.getByTestId("economy-invest")).toHaveCount(0);

  await page.locator("canvas.maplibregl-canvas").click({ position: { x: 720, y: 570 } });
  await expect(page.getByTestId("economy-invest")).toBeVisible();
  const investedRegionName = await page.getByTestId("economy-selected-region").textContent();
  const investedInitial = initial.regions.find((region) => region.displayName.en === investedRegionName);
  expect(investedInitial?.controllerId).toBe(initial.playerPolityId);
  await pane.locator('input[type="number"]').fill("100");
  await page.getByTestId("economy-invest").click();
  await expect(pane).toContainText("Investment queued for the next time jump");

  await page.getByRole("button", { name: "»" }).click();
  await page.getByRole("button", { name: "2/1/1900 1 month" }).click();
  await expect(pane).toContainText("1900-02-01", { timeout: 15_000 });
  const advancedResponse = await request.get(`/api/games/${gameId}/economy/state`);
  const advanced = await advancedResponse.json();
  expect(advanced.actualMonthlyTicks).toBe(1);
  expect(advanced.sessionRevision).not.toBe(initial.sessionRevision);
  expect(advanced.revision).not.toBe(initial.revision);
  expect(advanced.regions.find((region) => region.regionId === investedInitial.regionId)?.infrastructureBp)
    .toBe(investedInitial.infrastructureBp + 100);
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

  // A hard reload must reconstruct every engine-owned projection from the
  // current manifest instead of falling back to stale game/world JSON.
  await page.reload();
  await page.getByRole("button", { name: "Open advisor and economy" }).click({ force: true });
  await expect(pane).toContainText("1900-02-01", { timeout: 45_000 });
  await expect(pane).toContainText("Round 2");
  const reloaded = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(reloaded.sessionRevision).toBe(advanced.sessionRevision);

  // Crossing no calendar boundary still publishes date + round exactly once,
  // but must not run an economy tick or change the engine revision.
  await page.getByRole("button", { name: "»" }).click();
  await page.getByRole("button", { name: "2/2/1900 1 day" }).click();
  await expect(pane).toContainText("1900-02-02", { timeout: 15_000 });
  const withinMonth = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(withinMonth.round).toBe(3);
  expect(withinMonth.actualMonthlyTicks).toBe(0);
  expect(withinMonth.revision).toBe(advanced.revision);
  expect(withinMonth.sessionRevision).not.toBe(advanced.sessionRevision);

  // One user jump across three boundaries is three monthly ticks but one round.
  await page.getByRole("button", { name: "»" }).click();
  await page.getByRole("button", { name: "5/2/1900 3 months" }).click();
  await expect(pane).toContainText("1900-05-02", { timeout: 15_000 });
  const multiMonth = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(multiMonth.round).toBe(4);
  expect(multiMonth.actualMonthlyTicks).toBe(3);

  // Force a genuine race: another writer commits after the UI reads state but
  // before its POST arrives. The loser must surface stale-session and not commit.
  let winningRevision = "";
  await page.route(`**/api/games/${gameId}/economy/advance`, async (route) => {
    const body = route.request().postDataJSON();
    const winner = await request.post(`/api/games/${gameId}/economy/advance`, { data: body });
    expect(winner.ok()).toBeTruthy();
    winningRevision = (await winner.json()).sessionRevision;
    await route.continue();
  });
  await page.getByRole("button", { name: "»" }).click();
  await page.getByRole("button", { name: "5/3/1900 1 day" }).click();
  await expect(page.getByText(/stale engine session/i)).toBeVisible({ timeout: 15_000 });
  await page.unroute(`**/api/games/${gameId}/economy/advance`);
  const afterRace = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(afterRace.sessionRevision).toBe(winningRevision);
  expect(afterRace.round).toBe(5);
  expect(afterRace.gameDate).toBe("1900-05-03");

  // Economy-owned labels have authored Russian strings. The panel refreshes
  // from the committed session and picks up the selected locale without
  // rebuilding the map a second time in this already long-running smoke test.
  expect((await request.put("/api/ui-settings", { data: { language: "ru" } })).ok()).toBeTruthy();
  await page.evaluate(() => localStorage.setItem("ui_language", "ru"));
  await expect(pane).toContainText("Дата", { timeout: 45_000 });
  await expect(pane).toContainText("Ход");
  await expect(pane).toContainText("Ревизия сессии");
  await expect(pane).toContainText("Последний экономический отчёт");
  await expect(page.getByTestId("economy-selected-region")).toContainText("Бургенланд");
  await expect(pane).toContainText("Инвестиции в Бургенланд");
  await expect(pane.getByText("Население", { exact: true }).first()).toBeVisible();
  await expect(pane.getByText("Деятельность", { exact: true })).toBeVisible();
  await expect(pane.getByText("Инфраструктура", { exact: true }).first()).toBeVisible();
  await expect(pane.getByText("Казна", { exact: true })).toBeVisible();
  await expect(pane.getByText("Национальные запасы", { exact: true })).toBeVisible();
  await request.put("/api/ui-settings", { data: { language: "en" } });

  expect(modelCalls).toEqual([]);
  expect(consoleErrors.filter((message) => /status of 409/.test(message))).toHaveLength(1);
  expect(consoleErrors.some((message) => /Failed to simulate jump: Error: stale engine session/.test(message))).toBeTruthy();
  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !/Bad response code: 404|Failed to load resource: the server responded with a status of (404|409)|Startup preload failed during|Failed to load (country names|country labels|timeline lookups|region catalog)|Failed to simulate jump: Error: stale engine session/.test(message)
  );
  expect(unexpectedConsoleErrors).toEqual([]);

  await request.delete(`/api/games/${gameId}`);
  await request.delete(`/api/games/${otherGameId}`);
});
