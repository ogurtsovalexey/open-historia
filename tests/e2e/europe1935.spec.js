import { expect, test } from "@playwright/test";

const sectionJson = (prompt, start, end) => {
  const expression = new RegExp(`\\[${start}\\]\\n([^\\n]+)\\n\\[${end}\\]`);
  const match = expression.exec(prompt);
  if (!match) throw new Error(`missing ${start} section`);
  return JSON.parse(match[1]);
};

test("Europe 1935 starts with all engine modules and runs private Terra-medium V4 turns", async ({ page, request }) => {
  test.setTimeout(120_000);
  const gameId = "europe-1935-production-ui";
  await request.put("/api/ui-settings", { data: { language: "ru" } });
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const scenarios = await (await request.get("/api/scenarios")).json();
  const scenario = scenarios.scenarios.find((entry) => entry.id === "europe-1935-strategic-ai");
  expect(scenario.engineDriven).toBe(true);
  expect(scenario.engineScenario).toBe("europe-1935-benchmark");
  expect((await request.post("/api/games", {
    data: { id: gameId, name: "Europe 1935 Production UI", scenarioId: scenario.id, setActive: true },
  })).ok()).toBeTruthy();
  expect((await request.put(`/api/games/${gameId}`, {
    data: { gamePatch: { country: "Poland", language: "Russian" } },
  })).ok()).toBeTruthy();

  await page.addInitScript(() => {
    localStorage.setItem("ui_language", "ru");
    localStorage.setItem("api_provider", "codex-subscription");
    localStorage.setItem("codex_subscription_model", "gpt-5.6-terra");
    localStorage.setItem("codex_subscription_effort", "medium");
    localStorage.setItem("utility_api_provider", "codex-subscription");
    localStorage.setItem("utility_codex_subscription_model", "gpt-5.6-terra");
    localStorage.setItem("utility_codex_subscription_effort", "medium");
    localStorage.setItem("Terrain", "false");
    localStorage.setItem("Globe", "false");
  });

  const calls = [];
  let active = 0;
  let peak = 0;
  await page.route("**/api/codex-subscription/invoke", async (route) => {
    active += 1;
    peak = Math.max(peak, active);
    const body = route.request().postDataJSON();
    if (!body.prompt.includes("[CHECKPOINT]\n")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          response: { reply: "Советник готов. Экономические показатели берутся из движка." },
          provenance: {
            provider: "codex-subscription",
            model: "gpt-5.6-terra",
            effort: "medium",
            contract: "structured-output",
            preflightChecksum: "sha256:playwright",
          },
        }),
      });
      active -= 1;
      return;
    }
    const checkpoint = sectionJson(body.prompt, "CHECKPOINT", "GOALS_AND_RED_LINES");
    const choices = sectionJson(body.prompt, "FROZEN_CHOICES", "CANDIDATE_AUDIT");
    calls.push({ body, checkpoint, choices });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: {
          polityId: checkpoint.actor.id,
          revision: checkpoint.revision,
          objective: { domain: "campaign", summary: "Сохранить суверенитет и оценить стартовую позицию.", horizon: "medium" },
          selectedChoices: [],
          triggerCoverage: [],
          rejectedChoices: choices.length > 1 ? [{ choiceId: choices[0].choiceId, reason: "Отложить этот допустимый вариант." }] : [],
          durablePlan: { objective: "Сохранить суверенитет.", futureSteps: ["Проверить следующую ревизию движка."], commitments: [] },
          contingency: "Пересмотреть план после материального события.",
          hold: { reason: "plan-sequencing", detail: "На стартовом checkpoint действие не требуется.", revisitAfterMonths: 1 },
        },
        provenance: {
          provider: "codex-subscription",
          model: "gpt-5.6-terra",
          effort: "medium",
          contract: "StrategicBriefV4+StrategicDecisionV3",
          preflightChecksum: "sha256:playwright",
          usage: { input_tokens: 100, output_tokens: 40 },
        },
      }),
    });
    active -= 1;
  });

  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole("button", { name: "Open advisor and economy" }).click({ force: true });
  const pane = page.getByTestId("economy-pane");
  await expect(pane).toHaveAttribute("data-game-id", gameId, { timeout: 45_000 });
  await expect(pane).not.toContainText("не использует детерминированный экономический движок");
  await expect(pane).toContainText("1935-01-01");
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(Object.values(initial.modules).every(Boolean)).toBe(true);
  expect(initial.playerPolityId).toBe("polity:poland");
  expect(initial.politics.factions).toHaveLength(4);
  expect(initial.military.mobilizationRegions).toHaveLength(16);

  await page.getByRole("button", { name: "»" }).click({ force: true });
  await page.getByRole("button", { name: /2\/1\/1935/ }).click();
  await expect.poll(async () => (await (await request.get(`/api/games/${gameId}/economy/state`)).json()).gameDate, {
    timeout: 60_000,
  }).toBe("1935-02-01");
  const committed = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(calls).toHaveLength(8);
  expect(peak).toBeLessThanOrEqual(4);
  expect(calls.every((entry) => entry.body.model === "gpt-5.6-terra" && entry.body.effort === "medium")).toBe(true);
  expect(calls.every((entry) => !entry.body.prompt.includes("FeatureCollection") && entry.checkpoint.actor.id !== "polity:poland")).toBe(true);
  expect(committed.agentTurn.months[0].strategicDecisions).toHaveLength(8);
  expect(committed.agentTurn.months[0].strategicDecisions.every((entry) => entry.source === "model")).toBe(true);
  expect(committed.agentState.strategicV4.providerHistory.every((entry) => entry.model === "gpt-5.6-terra" && entry.effort === "medium")).toBe(true);
  await request.delete(`/api/games/${gameId}`);
});
