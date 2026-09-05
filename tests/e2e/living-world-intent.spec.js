import { expect, test } from "@playwright/test";

test("keyboard reaches the Russian intent-first primary loop at the mobile breakpoint", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem("ui_language", "ru"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/e2e/fixtures/intent-first.html");
  await page.keyboard.press("Alt+2");
  await expect(page.getByTestId("intent-surface-orders")).toBeVisible();
  await page.getByTestId("intent-order-composer").fill("Open a bounded investigation into electrical effects.");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("intent-interpretation")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("intent-interpretation")).toHaveCount(0);
  await page.keyboard.press("Alt+1");
  await expect(page.getByTestId("intent-surface-briefing")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(errors).toEqual([]);
});
