import { expect, test } from '@playwright/test';

const nextMonth = (date) => {
  const [year, month] = date.split('-').map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
};

const advance = async (request, gameId, current, commands, decide) => {
  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands,
  } })).json();
  if (draft.phase === 'confirm-player') {
    const response = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: { turnToken: draft.turnToken, action: 'confirm-player' } });
    expect(response.ok(), await response.text()).toBeTruthy(); draft = await response.json();
  }
  expect(draft.phase).toBe('plan-strategy');
  const prompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(JSON.stringify(prompt)).not.toContain('coordinates');
  const strategy = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-strategy', outputs: [{ decisions: prompt.briefs.map((brief) =>
      decide?.(brief, prompt) ?? ({ polityId: brief.polityId, intent: 'hold', rationale: 'No material action.', command: null })) }],
  } });
  expect(strategy.ok(), await strategy.text()).toBeTruthy(); draft = await strategy.json();
  const opponents = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-opponents', outcomes: draft.tasks.map((task) => ({ taskKey: task.taskKey, failureCode: 'mock-utility-offline' })),
  } });
  expect(opponents.ok(), await opponents.text()).toBeTruthy(); draft = await opponents.json();
  const commit = await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: { turnToken: draft.turnToken, turnDigest: draft.turnDigest } });
  expect(commit.ok(), await commit.text()).toBeTruthy(); return commit.json();
};

test('P8 guarantee produces an explicit player call with confirmation and UI controls', async ({ page, request }) => {
  test.setTimeout(120_000);
  const gameId = 'p8-alliance-obligations';
  const austria = 'polity:austria'; const france = 'polity:france'; const germany = 'polity:germany';
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post('/api/games', { data: { id: gameId, name: 'P8 Alliance Obligations', scenarioId: 'dev-map-6c', setActive: true } })).ok()).toBeTruthy();
  let current = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  const common = (suffix) => ({ commandId: `83000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    actorPolityId: austria, expectedRevision: current.revision, effectiveMonth: current.month });
  current = await advance(request, gameId, current, [{ kind: 'diplomacy.propose', ...common(1), proposalId: 'proposal:p8-austria-guarantees-france',
    recipientPolityId: france, terms: { kind: 'agreement', agreementType: 'guarantee', fromPolityId: austria, toPolityId: france } }]);
  current = await advance(request, gameId, current, [], (brief, prompt) => brief.polityId === france ? ({ polityId: france, intent: 'accept', rationale: 'Accept the public guarantee.',
    command: { kind: 'diplomacy.respond', actorPolityId: france, expectedRevision: prompt.revision, effectiveMonth: prompt.month,
      proposalId: 'proposal:p8-austria-guarantees-france', response: 'accept' } }) : undefined);
  current = await advance(request, gameId, current, [], (brief, prompt) => brief.polityId === germany ? ({ polityId: germany, intent: 'declare-war', rationale: 'Press the public rivalry.',
    command: { kind: 'war.declare', actorPolityId: germany, expectedRevision: prompt.revision, effectiveMonth: prompt.month,
      warId: 'war:p8-germany-france', defenderPolityId: france, reason: 'rivalry' } }) : undefined);
  const call = current.military.callsToArms.find((entry) => entry.status === 'pending');
  expect(call).toMatchObject({ calledPolityId: austria, beneficiaryPolityId: france, warId: 'war:p8-germany-france' });

  await page.addInitScript(() => { localStorage.setItem('Terrain', 'false'); localStorage.setItem('Globe', 'false'); });
  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole('button', { name: 'Open advisor and economy' }).click({ force: true });
  await page.getByRole('button', { name: 'War' }).click();
  const pane = page.getByTestId('military-pane');
  await expect(pane.getByTestId('call-to-arms')).toContainText('war:p8-germany-france');
  await pane.getByTestId('accept-call').click();
  await expect(pane.getByTestId('military-queued')).toContainText('acceptance queued for confirmation');

  const prepared = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: [
      { kind: 'war.respond-call', ...common(2), callId: call.callId, response: 'accept' },
    ],
  } })).json();
  expect(prepared.phase).toBe('confirm-player');
  expect(prepared.confirmation).toContainEqual(expect.objectContaining({ command: expect.objectContaining({ kind: 'war.respond-call', callId: call.callId }) }));
  await request.delete(`/api/games/${gameId}`);
});
