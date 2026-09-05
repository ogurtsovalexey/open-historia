import { expect, test } from "@playwright/test";

test("the primary pointer path advances three months and exposes the resulting process card", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tests/e2e/fixtures/intent-first.html");
  await page.getByTestId("intent-nav-orders").click();
  await page.getByTestId("intent-order-composer").fill("Maintain the northern roads.");
  await page.getByTestId("submit-intent").click();
  await page.getByTestId("confirm-intent").click();
  await page.getByTestId("advance-time").click();
  await expect(page.getByTestId("advance-time")).toContainText("Advance 3 months");
  await expect(page.getByTestId("turn-resolution-progress")).toContainText("3/3 monthly boundaries resolved");
  await page.getByTestId("intent-nav-details").click();
  await expect(page.getByTestId("process-card-process:roads")).toContainText("Road maintenance compact");
  await expect(page.getByTestId("process-card-process:roads")).toContainText("Next checkpoint");
  expect(errors).toEqual([]);
});
