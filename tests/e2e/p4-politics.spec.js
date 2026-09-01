import { expect, test } from '@playwright/test';

const nextMonth = (date) => {
  const [year, month] = date.split('-').map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
};

const finishMonth = async (request, gameId, draft) => {
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'confirm-player',
  } })).json();
  expect(draft.tasks[0].taskId).toBe('opponents.plan-campaign');
  const prompt = JSON.parse(draft.tasks[0].userPrompt);
  const text = JSON.stringify(prompt);
  expect(text).not.toContain('FeatureCollection');
  expect(text).not.toContain('character:');
  expect(text).not.toContain('truths');
  const outputs = [{ decisions: prompt.briefs.map((brief) => ({
    polityId: brief.polityId, intent: 'hold', rationale: 'No additional intervention.', command: null,
  })) }];
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-strategy', outputs,
  } })).json();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-opponents',
    outcomes: draft.tasks.map((task) => ({ taskKey: task.taskKey, failureCode: 'mock-utility-offline' })),
  } })).json();
  expect(draft.phase).toBe('ready');
  return (await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: {
    turnToken: draft.turnToken, turnDigest: draft.turnDigest,
  } })).json();
};

test('P4 resolves faction demands, appointments, succession and a deterministic coup', async ({ page, request }) => {
  test.setTimeout(90_000);
  const gameId = 'p4-politics-smoke';
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post('/api/games', { data: {
    id: gameId, name: 'P4 Politics', scenarioId: 'dev-map-6c', setActive: true,
  } })).ok()).toBeTruthy();
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(initial.politics.factions).toHaveLength(3);
  expect(initial.politics.characters).toHaveLength(4);
  expect(JSON.stringify(initial.politics)).not.toContain('character:germany');
  const common = (suffix) => ({
    commandId: `50000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    actorPolityId: initial.playerPolityId, expectedRevision: initial.revision, effectiveMonth: initial.month,
  });
  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(initial.gameDate), expectedSessionRevision: initial.sessionRevision,
    actions: [{ id: 'create-minister', text: 'Create a fictional establishment finance administrator named Mara Adler.' }], commands: [
      { kind: 'politics.respond', ...common(1), factionId: 'faction:austria-labor', response: 'concede' },
    ],
  } })).json();
  expect(draft.phase).toBe('interpret-player');
  const interpreterPrompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(interpreterPrompt.politics.factions).toHaveLength(3);
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-interpretation', outputs: [{ actions: [{
      actionId: 'create-minister', summary: 'Create Mara Adler as a fictional establishment administrator.', disposition: 'command',
      command: { kind: 'character.create', actorPolityId: initial.playerPolityId, expectedRevision: initial.revision,
        effectiveMonth: initial.month, characterId: 'character:austria-e2e-minister', displayName: { en: 'Mara Adler', ru: 'Мара Адлер' },
        origin: 'fictional-runtime', factionId: 'faction:austria-establishment', aptitudeTrait: 'administrator', loyaltyBand: 'high', ambitionBand: 'medium' },
    }] }],
  } })).json();
  expect(draft.confirmation[0].command).toMatchObject({ kind: 'character.create', origin: 'fictional-runtime' });
  const first = await finishMonth(request, gameId, draft);
  expect(first.lastTurn.ledger.politics.commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ factionId: 'faction:austria-labor', response: 'concede', treasurySpent: 250 }),
  ]));
  expect(first.politics.characters.find((entry) => entry.characterId === 'character:austria-e2e-minister')).toMatchObject({ office: null, origin: 'fictional-runtime' });

  let current = first;
  for (let month = 0; month < 2; month += 1) {
    const monthCommon = (suffix) => ({ commandId: `50000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
      actorPolityId: current.playerPolityId, expectedRevision: current.revision, effectiveMonth: current.month });
    draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
      targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: month === 0 ? [
        { kind: 'politics.appoint', ...monthCommon(10), characterId: 'character:austria-e2e-minister', office: 'finance' },
      ] : [],
    } })).json();
    current = await finishMonth(request, gameId, draft);
  }
  expect(current.politics.characters.find((entry) => entry.characterId === 'character:austria-e2e-minister')?.office).toBe('finance');
  expect(current.lastTurn.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'power-transferred', polityId: 'polity:germany', toCharacterId: 'character:germany-nationalist', cause: 'coup' }),
  ]));

  await page.addInitScript(() => { localStorage.setItem('Terrain', 'false'); localStorage.setItem('Globe', 'false'); });
  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole('button', { name: 'Open advisor and economy' }).click({ force: true });
  await page.getByRole('button', { name: 'Politics' }).click();
  const pane = page.getByTestId('politics-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toContainText('Mara Adler');
  await expect(pane).toContainText(/Legitimacy/);
  await pane.getByLabel('Runtime character name').fill('Elena Weiss');
  await pane.getByTestId('queue-fictional-character').click();
  await expect(pane.getByTestId('politics-queued')).toContainText('Fictional official queued');
  await request.delete(`/api/games/${gameId}`);
});
