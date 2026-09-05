import { expect, test } from "@playwright/test";

test("claims remain visibly contradicted while a separate valid intention stays confirmable", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("ui_language", "ru"));
  await page.goto("/tests/e2e/fixtures/intent-first.html");
  await page.getByTestId("intent-nav-orders").click();
  await expect(page.getByRole("heading", { name: "Решения" })).toBeVisible();
  await page.getByTestId("intent-order-composer").fill("I conquered the northern marches ten turns ago.\nInvest in road maintenance.");
  await page.getByTestId("submit-intent").click();
  await expect(page.getByTestId("claim-contradicted")).toBeVisible();
  await expect(page.getByTestId("intent-preview")).toBeVisible();
  await expect(page.getByTestId("confirm-intent")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(errors).toEqual([]);
});
