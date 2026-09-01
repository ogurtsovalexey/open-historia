import { expect, test } from '@playwright/test';

const nextMonth = (date) => {
  const [year, month] = date.split('-').map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
};

const finishMonth = async (request, gameId, draft, decide) => {
  const confirmed = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'confirm-player',
  } });
  expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
  draft = await confirmed.json();
  expect(draft.phase).toBe('plan-strategy');
  expect(draft.tasks[0].taskId).toBe('opponents.plan-war');
  const prompt = JSON.parse(draft.tasks[0].userPrompt);
  const promptText = JSON.stringify(prompt);
  expect(promptText).not.toContain('FeatureCollection');
  expect(promptText).not.toContain('coordinates');
  expect(promptText).not.toContain('supplyLinks');
  expect(promptText).not.toContain('truths');
  expect(promptText).not.toContain('character:');
  expect(prompt.briefs.every((brief) => brief.mobilizationRegionCandidates.length <= 3
    && brief.frontRegionCandidates.length <= 6 && brief.peaceRegionCandidates.length <= 6)).toBeTruthy();
  const outputs = [{ decisions: prompt.briefs.map((brief) => decide?.(brief, prompt) ?? ({
    polityId: brief.polityId, intent: 'hold', rationale: 'No justified material action.', command: null,
  })) }];
  const strategic = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-strategy', outputs,
  } });
  expect(strategic.ok(), await strategic.text()).toBeTruthy();
  draft = await strategic.json();
  const opponent = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-opponents',
    outcomes: draft.tasks.map((task) => ({ taskKey: task.taskKey, failureCode: 'mock-utility-offline' })),
  } });
  expect(opponent.ok(), await opponent.text()).toBeTruthy();
  draft = await opponent.json();
  expect(draft.phase).toBe('ready');
  const committed = await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: {
    turnToken: draft.turnToken, turnDigest: draft.turnDigest,
  } });
  expect(committed.ok(), await committed.text()).toBeTruthy();
  return committed.json();
};

test('P5 mobilizes, occupies and settles peace with same-revision ownership economics', async ({ page, request }) => {
  test.setTimeout(120_000);
  const gameId = 'p5-war-smoke';
  const austria = 'polity:austria';
  const germany = 'polity:germany';
  const salzburg = 'region:gadm:AUT.5_1';
  const bayern = 'region:gadm:DEU.2_1';
  const warId = 'war:p5-austria-germany';
  const reserveId = 'formation:austria-p5-reserve';
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post('/api/games', { data: {
    id: gameId, name: 'P5 War', scenarioId: 'dev-map-6c', setActive: true,
  } })).ok()).toBeTruthy();
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(initial.military.polity).toMatchObject({ polityId: austria, mobilized: 6000, casualties: 0 });
  expect(initial.military.formations).toHaveLength(1);
  expect(JSON.stringify(initial.military)).not.toContain('formation:germany-first');
  expect(JSON.stringify(initial.military)).not.toContain('supplyLinks');
  const common = (state, suffix) => ({
    commandId: `60000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    actorPolityId: austria, expectedRevision: state.revision, effectiveMonth: state.month,
  });

  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(initial.gameDate), expectedSessionRevision: initial.sessionRevision,
    actions: [
      { id: 'p5-declare-war', text: 'Declare a claim war against Germany.' },
      { id: 'p5-mobilize', text: 'Mobilize 6,000 reservists with 6,000 equipment in Salzburg.' },
    ], commands: [],
  } })).json();
  expect(draft.phase).toBe('interpret-player');
  const interpreterPrompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(interpreterPrompt.military.defenderCandidates).toContainEqual(expect.objectContaining({ polityId: germany }));
  expect(interpreterPrompt.military.mobilizationRegionCandidates).toContainEqual(expect.objectContaining({ regionId: salzburg }));
  expect(JSON.stringify(interpreterPrompt.military)).not.toContain('supplyLinks');
  expect(JSON.stringify(interpreterPrompt.military)).not.toContain('formation:germany-first');
  const interpreted = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-interpretation', outputs: [{ actions: [
      { actionId: 'p5-declare-war', summary: 'Declare a claim war against Germany.', disposition: 'command',
        command: { kind: 'war.declare', actorPolityId: austria, expectedRevision: initial.revision,
          effectiveMonth: initial.month, warId, defenderPolityId: germany, reason: 'claim' } },
      { actionId: 'p5-mobilize', summary: 'Mobilize a reserve formation in Salzburg.', disposition: 'command',
        command: { kind: 'military.mobilize', actorPolityId: austria, expectedRevision: initial.revision,
          effectiveMonth: initial.month, formationId: reserveId, locationRegionId: salzburg,
          manpower: 6000, equipment: 6000, commanderId: null } },
    ] }] },
  });
  expect(interpreted.ok(), await interpreted.text()).toBeTruthy();
  draft = await interpreted.json();
  expect(draft.confirmation.map((entry) => entry.command.kind)).toEqual(['war.declare', 'military.mobilize']);
  let current = await finishMonth(request, gameId, draft);
  expect(current.military.wars.find((entry) => entry.warId === warId)).toMatchObject({ status: 'active', reason: 'claim' });
  expect(current.military.formations.find((entry) => entry.formationId === reserveId)).toMatchObject({ status: 'mobilizing', readyMonth: current.month });
  expect(current.military.orderCandidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ formationId: reserveId, regionId: bayern }),
  ]));

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: [
      { kind: 'military.order', ...common(current, 3), formationId: 'formation:austria-first', posture: 'advance', targetRegionId: bayern },
      { kind: 'military.order', ...common(current, 4), formationId: reserveId, posture: 'advance', targetRegionId: bayern },
    ],
  } })).json();
  current = await finishMonth(request, gameId, draft);
  const combat = current.lastTurn.ledger.military.combats.find((entry) => entry.targetRegionId === bayern);
  expect(combat).toMatchObject({ attackerPolityId: austria, defenderPolityId: germany, outcome: 'occupied', attackerSupplyBp: 10000 });
  expect(current.regions.find((entry) => entry.regionId === bayern).controllerId).toBe(germany);
  expect(current.military.occupations).toContainEqual(expect.objectContaining({ regionId: bayern, legalControllerId: germany, actualControllerId: austria }));

  const offerId = 'peace:p5-austria-germany';
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: [
      { kind: 'peace.propose', ...common(current, 5), offerId, warId, recipientPolityId: germany,
        regionTransfers: [{ regionId: bayern, toPolityId: austria }],
        reparation: { fromPolityId: germany, toPolityId: austria, amount: 200 } },
    ],
  } })).json();
  current = await finishMonth(request, gameId, draft);
  expect(current.military.peaceOffers.find((entry) => entry.offerId === offerId)).toMatchObject({ status: 'pending' });

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: [],
  } })).json();
  current = await finishMonth(request, gameId, draft, (brief, prompt) => brief.polityId === germany ? ({
    polityId: germany, intent: 'accept-peace', rationale: 'Accept the bounded territorial settlement.',
    command: { kind: 'peace.respond', actorPolityId: germany, expectedRevision: prompt.revision,
      effectiveMonth: prompt.month, offerId, response: 'accept' },
  }) : ({ polityId: brief.polityId, intent: 'hold', rationale: 'No justified material action.', command: null }));
  expect(current.military.wars.find((entry) => entry.warId === warId)).toMatchObject({ status: 'ended' });
  expect(current.military.occupations).toHaveLength(0);
  expect(current.regions.find((entry) => entry.regionId === bayern).controllerId).toBe(austria);
  expect(current.lastTurn.ledger.transfers).toContainEqual(expect.objectContaining({ regionId: bayern, fromPolityId: germany, toPolityId: austria }));
  expect(current.lastTurn.ledger.military.treasuryTransfers).toContainEqual(expect.objectContaining({ offerId, amount: 200 }));
  const austriaLedger = current.lastTurn.ledger.polities.find((entry) => entry.polityId === austria);
  expect(austriaLedger.populationByRegion.some((entry) => entry.regionId === bayern)).toBeTruthy();

  await page.addInitScript(() => { localStorage.setItem('Terrain', 'false'); localStorage.setItem('Globe', 'false'); });
  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole('button', { name: 'Open advisor and economy' }).click({ force: true });
  await page.getByRole('button', { name: 'War' }).click();
  const pane = page.getByTestId('military-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toContainText('National reserves');
  await expect(pane).toContainText('Austria First Army');
  await pane.getByTestId('queue-mobilization').click();
  await expect(pane.getByTestId('military-queued')).toContainText('Mobilization');
  await request.delete(`/api/games/${gameId}`);
});
