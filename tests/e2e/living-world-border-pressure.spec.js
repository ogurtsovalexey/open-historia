import { expect, test } from "@playwright/test";

test("the production shell shows a derived border-pressure situation without creating a war order", async ({ page, request }) => {
  const gameId = "living-world-border-pressure-e2e";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: { id: gameId, name: "Border pressure", scenarioId: "scenario:napoleonic-europe-1805", playerPolityId: "polity:france" },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "History command center" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Current" }).first().click();
  await page.getByRole("tab", { name: "Ситуации" }).click();
  await expect(page.getByText(/controls the border at/i).first()).toBeVisible();
  await expect(page.getByText("A canonical adjacent region is under another polity's actual control. This does not authorize combat, occupation, or territorial transfer by itself.").first()).toBeVisible();
  await request.delete(`/api/games/${gameId}`);
});
