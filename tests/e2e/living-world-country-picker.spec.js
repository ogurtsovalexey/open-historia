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
