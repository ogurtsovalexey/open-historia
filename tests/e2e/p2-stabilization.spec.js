import { expect, test } from "@playwright/test";

const AUSTRIA = "polity:austria";
const GERMANY = "polity:germany";
const UPPER_AUSTRIA = "region:gadm:AUT.4_1";

const investments = {
  2: "region:gadm:AUT.9_1",
  3: "region:gadm:AUT.7_1",
  4: "region:gadm:AUT.6_1",
  5: "region:gadm:AUT.3_1",
  7: "region:gadm:AUT.9_1",
  8: "region:gadm:AUT.2_1",
  9: "region:gadm:AUT.5_1",
};

const isoMonth = (turn) => `1938-${String(turn + 1).padStart(2, "0")}-01`;
const commandId = (gameIndex, turn, suffix = 0) =>
  `10000000-0000-4000-8${gameIndex}${suffix}0-${String(turn).padStart(12, "0")}`;

const stateFor = async (request, gameId) => {
  const response = await request.get(`/api/games/${gameId}/economy/state`);
  expect(response.ok()).toBeTruthy();
  return response.json();
};

const regionCounts = (snapshot) => Object.fromEntries(
  snapshot.polities.map((polity) => [
    polity.id,
    snapshot.regions.filter((region) => region.controllerId === polity.id).length,
  ]),
);

const stableEngineState = (snapshot) => ({
  turn: snapshot.engineTurn,
  month: snapshot.month,
  revision: snapshot.revision,
  economy: snapshot.economy,
  polities: snapshot.polities,
  regions: snapshot.regions,
  ownershipOverrides: snapshot.ownershipOverrides,
  lastTurn: snapshot.lastTurn,
});

const reportRow = (snapshot, turn, command) => ({
  turn,
  date: snapshot.gameDate,
  round: snapshot.round,
  monthlyTicks: snapshot.actualMonthlyTicks,
  sessionRevision: snapshot.sessionRevision,
  engineRevision: snapshot.revision,
  command,
  polities: snapshot.polities.map((polity) => {
    const regions = snapshot.regions.filter((region) => region.controllerId === polity.id);
    const ledger = snapshot.lastTurn?.ledger?.polities?.find((entry) => entry.polityId === polity.id);
    return {
      polityId: polity.id,
      treasury: polity.treasury,
      population: regions.reduce((sum, region) => sum + region.population, 0),
      stockpile: Object.fromEntries(polity.stockpile.map((entry) => [entry.resource, entry.amount])),
      infrastructureBp: regions.reduce((sum, region) => sum + region.infrastructureBp, 0),
      regionCount: regions.length,
      production: Object.fromEntries((ledger?.production ?? []).map((entry) => [entry.resource, entry.total])),
      tax: ledger?.taxTotal ?? 0,
    };
  }),
});

async function runTenTurns({ request, gameId, gameIndex, onReload }) {
  let snapshot = await stateFor(request, gameId);
  expect(snapshot.gameDate).toBe("1938-01-01");
  expect(snapshot.round).toBe(1);
  expect(snapshot.engineTurn).toBe(0);
  const initialNames = snapshot.regions.map(({ regionId, displayName }) => ({ regionId, displayName }));
  const report = [];

  for (let turn = 1; turn <= 10; turn += 1) {
    const before = snapshot;
    const targetDate = isoMonth(turn);

    if (turn === 8) {
      const stale = await request.post(`/api/games/${gameId}/economy/advance`, {
        data: { targetDate, expectedSessionRevision: "sha256:stale", commands: [] },
      });
      expect(stale.status()).toBe(409);
      expect((await stateFor(request, gameId)).sessionRevision).toBe(before.sessionRevision);
    }

    if (turn === 9) {
      const foreign = await request.post(`/api/games/${gameId}/economy/advance`, {
        data: {
          targetDate,
          expectedSessionRevision: before.sessionRevision,
          commands: [{
            kind: "economy.invest-region",
            commandId: commandId(gameIndex, turn, 1),
            actorPolityId: AUSTRIA,
            targetRegionId: UPPER_AUSTRIA,
            effectiveMonth: before.month,
            expectedRevision: before.revision,
            spend: 100,
          }],
        },
      });
      expect(foreign.status()).toBe(400);
      await expect(foreign.json()).resolves.toEqual(expect.objectContaining({
        error: expect.stringContaining("is not controlled by the player's polity"),
      }));
      expect((await stateFor(request, gameId)).sessionRevision).toBe(before.sessionRevision);
    }

    let command = null;
    if (investments[turn]) {
      command = {
        kind: "economy.invest-region",
        commandId: commandId(gameIndex, turn),
        actorPolityId: AUSTRIA,
        targetRegionId: investments[turn],
        effectiveMonth: before.month,
        expectedRevision: before.revision,
        spend: 100,
      };
    } else if (turn === 6) {
      command = {
        kind: "territory.transfer-region",
        commandId: commandId(gameIndex, turn),
        actorPolityId: AUSTRIA,
        targetRegionId: UPPER_AUSTRIA,
        newControllerId: GERMANY,
        effectiveMonth: before.month,
        expectedRevision: before.revision,
      };
    }

    const advanced = await request.post(`/api/games/${gameId}/economy/advance`, {
      data: {
        targetDate,
        expectedSessionRevision: before.sessionRevision,
        commands: command ? [command] : [],
      },
    });
    expect(advanced.ok(), `advance failed: ${advanced.status()} ${await advanced.text()}`).toBeTruthy();
    snapshot = await advanced.json();
    expect(snapshot.actualMonthlyTicks).toBe(1);
    expect(snapshot.gameDate).toBe(targetDate);
    expect(snapshot.round).toBe(turn + 1);
    expect(snapshot.engineTurn).toBe(turn);
    expect(snapshot.sessionRevision).not.toBe(before.sessionRevision);
    expect(snapshot.revision).not.toBe(before.revision);
    expect(snapshot.regions.map(({ regionId, displayName }) => ({ regionId, displayName }))).toEqual(initialNames);

    if (command?.kind === "economy.invest-region") {
      const beforeRegion = before.regions.find((region) => region.regionId === command.targetRegionId);
      const afterRegion = snapshot.regions.find((region) => region.regionId === command.targetRegionId);
      expect(afterRegion.infrastructureBp).toBe(beforeRegion.infrastructureBp + 100);
      expect(snapshot.lastTurn.ledger.polities.find((entry) => entry.polityId === AUSTRIA).investment)
        .toEqual(expect.objectContaining({ regionId: command.targetRegionId, spend: 100 }));
    }

    if (turn === 6) {
      expect(snapshot.regions.find((region) => region.regionId === UPPER_AUSTRIA).controllerId).toBe(GERMANY);
      expect(regionCounts(snapshot)).toEqual(expect.objectContaining({ [AUSTRIA]: 8, [GERMANY]: 17 }));
      expect(snapshot.ownershipOverrides["AUT.4_1"]).toBe("Germany");
      expect(snapshot.lastTurn.ledger.transfers).toEqual([
        expect.objectContaining({ regionId: UPPER_AUSTRIA, fromPolityId: AUSTRIA, toPolityId: GERMANY }),
      ]);
      const beforeAustria = before.lastTurn?.ledger?.polities?.find((entry) => entry.polityId === AUSTRIA);
      const afterAustria = snapshot.lastTurn.ledger.polities.find((entry) => entry.polityId === AUSTRIA);
      const beforeGermany = before.lastTurn?.ledger?.polities?.find((entry) => entry.polityId === GERMANY);
      const afterGermany = snapshot.lastTurn.ledger.polities.find((entry) => entry.polityId === GERMANY);
      expect(afterAustria.populationClosing).toBeLessThan(beforeAustria.populationClosing);
      expect(afterGermany.populationClosing).toBeGreaterThan(beforeGermany.populationClosing);
      expect(afterAustria.taxTotal).toBeLessThan(beforeAustria.taxTotal);
      expect(afterGermany.taxTotal).toBeGreaterThan(beforeGermany.taxTotal);
      expect(afterAustria.production.find((entry) => entry.resource === "food").total)
        .toBeLessThan(beforeAustria.production.find((entry) => entry.resource === "food").total);
      expect(afterGermany.production.find((entry) => entry.resource === "food").total)
        .toBeGreaterThan(beforeGermany.production.find((entry) => entry.resource === "food").total);
    }

    report.push(reportRow(snapshot, turn, command?.kind ?? "none"));
    if ([3, 6, 10].includes(turn)) await onReload?.(snapshot, turn);
  }

  return { initialNames, report, snapshot };
}

test("P2 stabilization commits and restores the ten-month economy soak twice", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const gameIds = ["p2-stabilization-1938", "p2-stabilization-1938-replay"];
  await request.put("/api/ui-settings", { data: { language: "en" } });
  for (const gameId of gameIds) await request.delete(`/api/games/${gameId}`).catch(() => {});

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

  for (const [index, gameId] of gameIds.entries()) {
    const created = await request.post("/api/games", {
      data: { id: gameId, name: `P2 Stabilization ${index + 1}`, scenarioId: "dev-map-4c", setActive: index === 0 },
    });
    expect(created.ok()).toBeTruthy();
  }

  await page.goto(`/?gameId=${gameIds[0]}`);
  await page.getByRole("button", { name: "Open advisor and economy" }).click({ force: true });
  const pane = page.getByTestId("economy-pane");
  await expect(pane).toHaveAttribute("data-game-id", gameIds[0], { timeout: 45_000 });

  const first = await runTenTurns({
    request,
    gameId: gameIds[0],
    gameIndex: 1,
    onReload: async (expected, turn) => {
      await page.reload();
      await page.getByRole("button", { name: "Open advisor and economy" }).click({ force: true });
      await expect(pane).toContainText(expected.gameDate, { timeout: 45_000 });
      await expect(pane).toContainText(`Round ${expected.round}`);
      const restored = await stateFor(request, gameIds[0]);
      expect(restored.sessionRevision).toBe(expected.sessionRevision);
      expect(restored.revision).toBe(expected.revision);
      expect(restored.ownershipOverrides).toEqual(expected.ownershipOverrides);
      if (turn >= 6) expect(restored.ownershipOverrides["AUT.4_1"]).toBe("Germany");
      const runtimeGame = await (await request.get("/api/runtime/json/game")).json();
      const runtimeWorld = await (await request.get("/api/runtime/json/world")).json();
      expect(runtimeGame.gameDate).toBe(expected.gameDate);
      expect(runtimeGame.round).toBe(expected.round);
      expect(runtimeWorld.regionOwnershipOverrides).toEqual(expect.objectContaining(expected.ownershipOverrides));
    },
  });

  const second = await runTenTurns({ request, gameId: gameIds[1], gameIndex: 2 });
  expect(first.snapshot.revision).toBe(second.snapshot.revision);
  expect(stableEngineState(first.snapshot)).toEqual(stableEngineState(second.snapshot));
  expect(first.snapshot.sessionRevision).not.toBe(second.snapshot.sessionRevision);
  expect(first.snapshot.gameDate).toBe("1938-11-01");
  expect(first.snapshot.round).toBe(11);
  expect(first.snapshot.engineTurn).toBe(10);

  await testInfo.attach("p2-stabilization-1938-report.json", {
    body: Buffer.from(JSON.stringify(first.report, null, 2)),
    contentType: "application/json",
  });
  expect(modelCalls).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !/Bad response code: 404|Failed to load resource: the server responded with a status of 404|Startup preload failed during|Failed to load (country names|country labels|timeline lookups|region catalog)/.test(message)
  );
  expect(unexpectedConsoleErrors).toEqual([]);

  for (const gameId of gameIds) await request.delete(`/api/games/${gameId}`);
});
