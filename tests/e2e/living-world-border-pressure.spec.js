import { expect, test } from "@playwright/test";

test("the production shell shows a derived border-pressure situation without creating a war order", async ({ page, request }) => {
  const gameId = "living-world-border-pressure-e2e";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: { id: gameId, name: "Border pressure", scenarioId: "scenario:napoleonic-europe-1805", playerPolityId: "polity:france", setActive: true },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto(`/?gameId=${gameId}`);
  await expect(page.getByRole("complementary", { name: "History command center" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("intent-nav-situations").click();
  await expect(page.getByText(/контролирует границу у региона/i).first()).toBeVisible();
  await expect(page.getByText("Соседний канонический регион находится под фактическим контролем другой державы. Само по себе это не разрешает бой, оккупацию или передачу территории.").first()).toBeVisible();
  await request.delete(`/api/games/${gameId}`);
});
