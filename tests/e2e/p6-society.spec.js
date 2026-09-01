import { expect, test } from '@playwright/test';

const nextMonth = (date) => {
  const [year, month] = date.split('-').map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
};

const finishMonth = async (request, gameId, draft) => {
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'confirm-player',
  } })).json();
  expect(draft.phase).toBe('plan-strategy');
  expect(draft.tasks[0].taskId).toBe('opponents.plan-campaign');
  const prompt = JSON.parse(draft.tasks[0].userPrompt);
  const text = JSON.stringify(prompt);
  expect(text).not.toContain('FeatureCollection');
  expect(text).not.toContain('supplyLinks');
  expect(text).not.toContain('minorities');
  expect(text).not.toContain('identity.regions');
  expect(prompt.briefs.every((brief) => (brief.identity?.candidates?.length ?? 0) <= 6)).toBeTruthy();
  const outputs = [{ decisions: prompt.briefs.map((brief) => ({
    polityId: brief.polityId, intent: 'hold', rationale: 'No justified material action.', command: null,
  })) }];
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-strategy', outputs,
  } })).json();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-opponents',
    outcomes: draft.tasks.map((task) => ({ taskKey: task.taskKey, failureCode: 'mock-utility-offline' })),
  } })).json();
  expect(draft.phase).toBe('ready');
  const committed = await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: {
    turnToken: draft.turnToken, turnDigest: draft.turnDigest,
  } });
  expect(committed.ok(), await committed.text()).toBeTruthy();
  return committed.json();
};

test('P6 changes identity policy, integrates a minority and unlocks next-month industrial capability', async ({ page, request }) => {
  test.setTimeout(120_000);
  const gameId = 'p6-society-smoke';
  const austria = 'polity:austria';
  const salzburg = 'region:gadm:AUT.5_1';
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post('/api/games', { data: {
    id: gameId, name: 'P6 Society', scenarioId: 'dev-map-6c', setActive: true,
  } })).ok()).toBeTruthy();
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(initial.society.identity.polity.acceptedCultureIds).toContain('culture:german');
  expect(initial.society.identity.aggregate).toMatchObject({ cultureMismatchBp: 0, taxMultiplierBp: 10000, recruitmentMultiplierBp: 10000 });

  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(initial.gameDate), expectedSessionRevision: initial.sessionRevision, commands: [],
    actions: [
      { id: 'p6-revoke', text: 'Revoke acceptance of the German culture.' },
      { id: 'p6-integrate', text: 'Set cultural policy to integration.' },
      { id: 'p6-research', text: 'Start research into industrial standardization.' },
    ],
  } })).json();
  expect(draft.phase).toBe('interpret-player');
  const interpreterPrompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(interpreterPrompt.society.identity.candidates).toContain('culture:german');
  expect(interpreterPrompt.society.researchTemplates).toContainEqual(expect.objectContaining({ templateId: 'project-template:industrial-standardization' }));
  expect(JSON.stringify(interpreterPrompt.society)).not.toContain('minorities');
  const interpreted = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-interpretation', outputs: [{ actions: [
      { actionId: 'p6-revoke', summary: 'Revoke German cultural acceptance.', disposition: 'command',
        command: { kind: 'identity.set-culture-acceptance', actorPolityId: austria, expectedRevision: initial.revision,
          effectiveMonth: initial.month, domain: 'culture', identityId: 'culture:german', accepted: false } },
      { actionId: 'p6-integrate', summary: 'Adopt cultural integration.', disposition: 'command',
        command: { kind: 'identity.set-policy', actorPolityId: austria, expectedRevision: initial.revision,
          effectiveMonth: initial.month, domain: 'culture', policy: 'integration' } },
      { actionId: 'p6-research', summary: 'Start industrial standardization research.', disposition: 'command',
        command: { kind: 'project.start', actorPolityId: austria, expectedRevision: initial.revision,
          effectiveMonth: initial.month, projectId: 'project:p6-industrial',
          templateId: 'project-template:industrial-standardization', monthlyFunding: 1000, priority: 5 } },
    ] }],
  } });
  expect(interpreted.ok(), await interpreted.text()).toBeTruthy();
  draft = await interpreted.json();
  expect(draft.confirmation.map((entry) => entry.command.kind)).toEqual([
    'identity.set-culture-acceptance', 'identity.set-policy', 'project.start',
  ]);
  let current = await finishMonth(request, gameId, draft);
  expect(current.society.identity.polity).toMatchObject({ culturePolicy: 'integration', acceptedCultureIds: [] });
  expect(current.society.identity.aggregate.cultureMismatchBp).toBeGreaterThan(0);
  expect(current.society.identity.aggregate.taxMultiplierBp).toBeLessThan(10000);
  expect(current.society.identity.aggregate.recruitmentMultiplierBp).toBeLessThan(10000);
  expect(current.lastTurn.ledger.identity.regions.find((entry) => entry.regionId === salzburg)).toMatchObject({ cultureShiftBp: 25 });
  const firstPotential = current.lastTurn.ledger.polities.find((entry) => entry.polityId === austria).goods.potential;

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: [],
  } })).json();
  current = await finishMonth(request, gameId, draft);
  expect(current.society.capabilities.unlocked).toContainEqual(expect.objectContaining({ capabilityId: 'capability:industrial-standardization' }));
  expect(current.lastTurn.ledger.statecraft.capabilityUnlocks).toContainEqual(expect.objectContaining({ capabilityId: 'capability:industrial-standardization' }));
  expect(current.lastTurn.ledger.polities.find((entry) => entry.polityId === austria).goods.potential).toBe(firstPotential);

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: [],
  } })).json();
  current = await finishMonth(request, gameId, draft);
  expect(current.lastTurn.ledger.polities.find((entry) => entry.polityId === austria).goods.potential).toBe(Math.floor((firstPotential * 11000) / 10000));

  await page.addInitScript(() => { localStorage.setItem('Terrain', 'false'); localStorage.setItem('Globe', 'false'); });
  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole('button', { name: 'Open advisor and economy' }).click({ force: true });
  await page.getByRole('button', { name: 'Society' }).click();
  const pane = page.getByTestId('society-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toContainText('Industrial standardization');
  await expect(pane).toContainText('unlocked');
  await expect(pane).toContainText('integration');
  await pane.getByTestId('queue-culture-policy').click();
  await expect(pane.getByTestId('society-queued')).toContainText('culture policy queued');
  await request.delete(`/api/games/${gameId}`);
});
