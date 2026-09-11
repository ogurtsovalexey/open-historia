import { expect, test } from "@playwright/test";

test("Napoleonic country selection renders the authored European map before play begins", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Новая игра" }).first().click();
  await expect(page.getByText("Выберите свою страну")).toBeVisible();
  await expect(page.getByTestId("scenario-map-status")).toContainText("797 регионов", { timeout: 45_000 });
  await expect(page.getByTestId("country-picker-map").locator("canvas").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Российская империя" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Французская империя" })).toBeVisible();
  expect(failures).toEqual([]);
});

test("a Russian Napoleonic session is usable while its map loads and keeps grounded surfaces localized", async ({ page, request }) => {
  const gameId = "living-world-russian-ui-regression";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: {
      id: gameId,
      name: "Russian UI regression",
      scenarioId: "scenario:napoleonic-europe-1805",
      playerPolityId: "polity:russia",
      setActive: true,
    },
  });
  expect(created.ok()).toBeTruthy();

  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/?gameId=${gameId}`, { waitUntil: "domcontentloaded" });

    // The UI must not remain under the loading screen until MapLibre finishes.
    await expect(page.getByTestId("intent-nav-country")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("intent-nav-country").click();
    await expect(page.getByTestId("intent-surface-country")).toContainText("Доступная рабочая сила");
    await expect(page.getByTestId("intent-surface-country")).not.toContainText("Available workforce");

    await page.getByTestId("intent-nav-diplomacy").click();
    await expect(page.getByTestId("intent-surface-diplomacy")).toContainText("Переговоры — не обязательство");
    await expect(page.getByTestId("intent-surface-diplomacy")).not.toContainText(/polity:/);
    await expect(page.locator("canvas").first()).toBeVisible();
    expect(failures).toEqual([]);
  } finally {
    await request.delete(`/api/games/${gameId}`);
  }
});
