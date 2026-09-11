import { expect, test } from "@playwright/test";

// This is deliberately a browser playthrough, rather than the lower-level
// store loop.  Its strategic provider is an unreachable local endpoint, so
// every required strategic task visibly reaches the canonical checkpoint and
// the player explicitly chooses to continue without it.  That proves the UI
// never invents an unrecorded AI decision and costs neither an API key nor a
// Codex subscription call in acceptance runs.
const scenarios = [
  { slug: "napoleon", scenarioId: "scenario:napoleonic-europe-1805", playerPolityId: "polity:france", finalDate: "1807-07-01" },
  { slug: "mesoamerica", scenarioId: "scenario:central-mesoamerica-1450", playerPolityId: "polity:tenochtitlan", finalDate: "1452-07-01" },
  { slug: "europe-1935", scenarioId: "scenario:europe-1935-benchmark", playerPolityId: "polity:poland", finalDate: "1937-07-01" },
];

for (const scenario of scenarios) {
  test(`${scenario.slug} completes ten visible player decisions without a hidden strategic result`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const gameId = `living-world-ui-ten-turn-${scenario.slug}`;
    await request.delete(`/api/games/${gameId}`).catch(() => {});
    const created = await request.post("/api/games", { data: {
      id: gameId,
      name: `UI ten-turn ${scenario.slug}`,
      scenarioId: scenario.scenarioId,
      playerPolityId: scenario.playerPolityId,
      setActive: true,
    } });
    expect(created.ok()).toBeTruthy();

    // Make model invocation fail locally and immediately. The UI must expose
    // that state and require a player click to proceed; it must not silently
    // substitute a decision, a canned event, or a server-side fallback.
    await page.addInitScript(() => {
      localStorage.setItem("api_provider", "openai-compatible");
      localStorage.setItem("openai_compatible_endpoint", "http://127.0.0.1:1/v1");
    });

    try {
      await page.goto(`/?gameId=${gameId}`);
      await expect(page.getByTestId("intent-first-shell")).toBeVisible({ timeout: 30_000 });

      for (let turn = 1; turn <= 10; turn += 1) {
        await page.getByTestId("advance-time").click();
        await expect(page.getByTestId("strategic-checkpoint")).toBeVisible();
        await page.getByTestId("continue-without-strategy").click();
        await expect(page.getByTestId("strategic-checkpoint")).toBeHidden();

        await expect.poll(async () => {
          const response = await request.get(`/api/games/${gameId}/living-world`);
          if (!response.ok()) return null;
          return (await response.json()).playerDecisionIndex;
        }).toBe(turn);
      }

      const finalView = await (await request.get(`/api/games/${gameId}/living-world`)).json();
      expect(finalView.projection.asOf).toBe(scenario.finalDate);
      expect(finalView.playerDecisionIndex).toBe(10);
      expect(finalView.lastTransition.strategicRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "skipped" }),
      ]));
      await expect(page.getByTestId("turn-resolution-progress")).toContainText("3/3");
    } finally {
      await request.delete(`/api/games/${gameId}`);
    }
  });
}
