import { expect, test } from "@playwright/test";

const apiKey = process.env.GEMINI_API_KEY;

test.use({ trace: "off", screenshot: "off", video: "off" });
test.skip(!apiKey, "Set GEMINI_API_KEY to run the opt-in live Gemini smoke.");

const askAdvisor = (page, prompt) => page.evaluate(async (text) => {
  const ai = await import("/src/Game/AI/main.jsx");
  ai.startChat();
  return ai.sendMessage(text);
}, prompt);

const askCountry = (page, country, prompt) => page.evaluate(async ({ speakingAs, text }) => {
  const ai = await import("/src/Game/AI/main.jsx");
  ai.startDiplomaticChat();
  const codes = { Germany: "DEU", Czechia: "CZE", Slovakia: "SVK" };
  const result = await ai.sendDiplomaticMessage(
    text,
    speakingAs,
    [{ name: speakingAs, code: codes[speakingAs] }],
  );
  return result.reply;
}, { speakingAs: country, text: prompt });

test("live Gemini advisor and diplomacy stay grounded in the 1938 engine session", async ({ page, request }) => {
  test.setTimeout(360_000);
  const gameId = "p2-gemini-smoke-1938";
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post("/api/games", {
    data: { id: gameId, name: "P2 Gemini Smoke 1938", scenarioId: "dev-map-4c", setActive: true },
  });
  expect(created.ok()).toBeTruthy();

  await page.addInitScript(({ key }) => {
    localStorage.setItem("api_provider", "gemini");
    localStorage.setItem("gemini_api_key", key);
    localStorage.setItem("gemini_model", "gemini-3.5-flash-lite");
    localStorage.setItem("gemini_custom_params", "");
    localStorage.setItem("ai_reasoning_enabled", "0");
    localStorage.setItem("ai_chat_language", "ru");
    localStorage.setItem("ui_language", "ru");
    localStorage.setItem("Terrain", "false");
    localStorage.setItem("Globe", "false");
  }, { key: apiKey });

  const modelCalls = [];
  page.on("request", (requestEvent) => {
    if (/generativelanguage\.googleapis\.com/.test(requestEvent.url())) modelCalls.push(requestEvent.url());
  });
  await page.goto(`/?gameId=${gameId}`);
  await page.waitForTimeout(1500);
  expect(modelCalls).toHaveLength(0);

  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  const advisor = await askAdvisor(
    page,
    "Перечисли по-русски приоритеты Австрии в центральноевропейском кризисе 1938 года. Не выдумывай числовые показатели.",
  );
  expect(advisor).toMatch(/[А-Яа-яЁё]/);
  expect(advisor).toMatch(/1938|кризис|Герман|независим/i);

  const germanyBefore = await askCountry(
    page,
    "Австрия предлагает пакт о ненападении. Обсудите ваши территориальные требования к Верхней Австрии и явно признайте, что никакая передача ещё не состоялась.",
  );
  expect(germanyBefore).toMatch(/[А-Яа-яЁё]/);
  expect(germanyBefore).not.toMatch(/передача (уже )?(состоялась|завершена)|уже передан[ао]/i);
  const afterTalk = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(afterTalk.sessionRevision).toBe(initial.sessionRevision);
  expect(afterTalk.revision).toBe(initial.revision);

  const czechia = await askCountry(
    page,
    "Предложите Австрии экономическое сотрудничество в условиях кризиса 1938 года без выдуманных авторитетных цифр.",
  );
  expect(czechia).toMatch(/Чех|эконом|промышлен/i);

  const slovakia = await askCountry(
    page,
    "Обсудите с Австрией продовольственную безопасность и сохранение словацкого нейтралитета.",
  );
  expect(slovakia).toMatch(/Слова|продоволь|нейтрал/i);

  const callsBeforeAdvance = modelCalls.length;
  const transfer = await request.post(`/api/games/${gameId}/economy/advance`, {
    data: {
      targetDate: "1938-02-01",
      expectedSessionRevision: afterTalk.sessionRevision,
      commands: [{
        kind: "territory.transfer-region",
        commandId: "20000000-0000-4000-8000-000000000001",
        actorPolityId: "polity:austria",
        targetRegionId: "region:gadm:AUT.4_1",
        newControllerId: "polity:germany",
        effectiveMonth: afterTalk.month,
        expectedRevision: afterTalk.revision,
      }],
    },
  });
  expect(transfer.ok()).toBeTruthy();
  const transferred = await transfer.json();
  expect(transferred.ownershipOverrides["AUT.4_1"]).toBe("Germany");
  expect(modelCalls).toHaveLength(callsBeforeAdvance);

  const germanyAfter = await askCountry(
    page,
    "Кто сейчас контролирует Верхнюю Австрию (Oberösterreich)? Ответь строго по текущему состоянию игры.",
  );
  expect(germanyAfter).toMatch(/Герман/i);
  expect(germanyAfter).toMatch(/Верхн|Oberösterreich/i);
  expect(modelCalls.length).toBeGreaterThanOrEqual(5);

  await request.delete(`/api/games/${gameId}`);
});
