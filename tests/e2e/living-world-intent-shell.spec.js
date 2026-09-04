import { expect, test } from "@playwright/test";

const openHarness = async (page) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/e2e/fixtures/intent-first.html");
  await expect(page.getByTestId("intent-first-shell")).toBeVisible();
  return errors;
};

test("desktop intent loop grounds a false claim, confirms, advances and explains results", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openHarness(page);

  await page.getByTestId("intent-nav-orders").click();
  await page.getByTestId("intent-order-composer").fill([
    "I conquered the northern marches ten turns ago.",
    "Invest in road maintenance without weakening the harvest.",
  ].join("\n"));
  await page.getByTestId("submit-intent").click();
  await expect(page.getByTestId("claim-contradicted")).toContainText("ledger contradicts");
  await expect(page.getByTestId("intent-preview")).toContainText("4,000–7,000 labor-days");
  await expect(page.getByTestId("advance-time")).toBeDisabled();
  await page.getByTestId("confirm-intent").click();
  await expect(page.getByTestId("advance-time")).toBeEnabled();
  await page.getByTestId("advance-time").click();

  await page.getByTestId("intent-nav-briefing").click();
  await expect(page.getByTestId("causal-change-change:roads")).toContainText("+18 route capacity");
  await page.getByTestId("causal-change-change:roads").getByText("Why?").click();
  await expect(page.getByTestId("causal-change-change:roads")).toContainText("Confirmed road-maintenance intention");
  await expect(page.getByTestId("causal-change-change:roads")).toContainText("Sources: Route-capacity ledger");
  await page.getByTestId("intent-nav-details").click();
  await expect(page.getByTestId("process-card-process:roads")).toContainText("Road maintenance compact");
  await expect(page.getByTestId("process-card-process:roads")).toContainText("Seasonal labor");
  await expect(page.getByTestId("process-card-process:roads")).toContainText("Preserve harvest labor");
  expect(errors).toEqual([]);
});

test("mobile and keyboard keep the primary loop reachable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openHarness(page);

  await page.keyboard.press("Alt+2");
  await expect(page.getByTestId("intent-surface-orders")).toBeVisible();
  await page.getByTestId("intent-order-composer").fill("Open a bounded investigation into electrical effects.");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("intent-interpretation")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("intent-interpretation")).toHaveCount(0);
  await page.keyboard.press("Alt+4");
  await expect(page.getByTestId("grounded-fact-fact:population")).toContainText("Engine derived");
  await expect(page.getByTestId("grounded-fact-fact:foreign-credit")).toContainText("Unknown");
  await page.getByTestId("intent-nav-country").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("intent-surface-situations")).toBeVisible();

  const shellBox = await page.getByTestId("intent-first-shell").boundingBox();
  expect(shellBox.x).toBeGreaterThanOrEqual(0);
  expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
});
