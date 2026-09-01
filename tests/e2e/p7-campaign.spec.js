import { expect, test } from '@playwright/test';

const nextMonth = (date) => { const [year, month] = date.split('-').map(Number); return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`; };
const finish = async (request, gameId, draft) => {
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: { turnToken: draft.turnToken, action: 'confirm-player' } })).json();
  expect(draft.tasks[0].taskId).toBe('opponents.plan-campaign');
  const prompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(JSON.stringify(prompt)).not.toContain('FeatureCollection');
  expect(JSON.stringify(prompt)).not.toContain('startingRegionCounts');
  expect(prompt.briefs.every((brief) => brief.campaignGoals.length <= 3 && brief.campaignCrises.length <= 3)).toBeTruthy();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: { turnToken: draft.turnToken, action: 'submit-strategy', outputs: [{ decisions: prompt.briefs.map((brief) => ({ polityId: brief.polityId, intent: 'hold', rationale: 'No material action.', command: null })) }] } })).json();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: { turnToken: draft.turnToken, action: 'submit-opponents', outcomes: draft.tasks.map((task) => ({ taskKey: task.taskKey, failureCode: 'mock-utility-offline' })) } })).json();
  expect(draft.phase).toBe('ready');
  const response = await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: { turnToken: draft.turnToken, turnDigest: draft.turnDigest } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
};

test('P7 exposes bounded goals/crises, confirms commands and records a non-terminal legacy report', async ({ page, request }) => {
  test.setTimeout(120_000);
  const gameId = 'p7-campaign-smoke';
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post('/api/games', { data: { id: gameId, name: 'P7 Campaign', scenarioId: 'dev-map-6c', setActive: true } })).ok()).toBeTruthy();
  let current = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(current.campaign.horizonReached).toBe(false);
  expect(current.campaign.goals).toContainEqual(expect.objectContaining({ goalId: 'goal:austria-industry', status: 'candidate' }));

  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: { targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, actions: [], commands: [] } })).json();
  current = await finish(request, gameId, draft);
  expect(current.campaign.crises).toContainEqual(expect.objectContaining({ crisisId: 'crisis:german-political-strain', status: 'active' }));

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(current.gameDate), expectedSessionRevision: current.sessionRevision, commands: [], actions: [
      { id: 'p7-goal', text: 'Adopt industrial standardization as a durable direction.' },
      { id: 'p7-crisis', text: 'Take a compromise position in the German political crisis.' },
      { id: 'p7-legacy', text: 'Record an interim legacy assessment.' },
    ],
  } })).json();
  const interpreter = JSON.parse(draft.tasks[0].userPrompt);
  expect(interpreter.campaign.goals).toContainEqual(expect.objectContaining({ goalId: 'goal:austria-industry', status: 'candidate' }));
  expect(interpreter.campaign.crises).toContainEqual(expect.objectContaining({ crisisId: 'crisis:german-political-strain' }));
  expect(JSON.stringify(interpreter.campaign)).not.toContain('crisisTemplates');
  const interpreted = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: { turnToken: draft.turnToken, action: 'submit-interpretation', outputs: [{ actions: [
    { actionId: 'p7-goal', summary: 'Adopt industrial direction.', disposition: 'command', command: { kind: 'campaign.adopt-goal', actorPolityId: 'polity:austria', expectedRevision: current.revision, effectiveMonth: current.month, goalId: 'goal:austria-industry' } },
    { actionId: 'p7-crisis', summary: 'Seek compromise.', disposition: 'command', command: { kind: 'crisis.set-position', actorPolityId: 'polity:austria', expectedRevision: current.revision, effectiveMonth: current.month, crisisId: 'crisis:german-political-strain', position: 'compromise' } },
    { actionId: 'p7-legacy', summary: 'Assess legacy.', disposition: 'command', command: { kind: 'campaign.assess-legacy', actorPolityId: 'polity:austria', expectedRevision: current.revision, effectiveMonth: current.month, assessmentId: 'legacy:p7-interim' } },
  ] }] } });
  expect(interpreted.ok(), await interpreted.text()).toBeTruthy(); draft = await interpreted.json();
  expect(draft.phase).toBe('confirm-player');
  expect(draft.confirmation.map((entry) => entry.command.kind)).toEqual(['campaign.adopt-goal', 'crisis.set-position', 'campaign.assess-legacy']);
  current = await finish(request, gameId, draft);
  expect(current.campaign.goals.find((entry) => entry.goalId === 'goal:austria-industry').status).toBe('active');
  expect(current.campaign.assessments).toContainEqual(expect.objectContaining({ assessmentId: 'legacy:p7-interim', horizonReached: false }));
  expect(current.month).toBe('1938-03-01');

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: current.gameDate, expectedSessionRevision: current.sessionRevision,
    actions: [{ id: 'p7-report', text: 'Interpret the legacy assessment and its costs.' }], commands: [],
  } })).json();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-interpretation', outputs: [{ actions: [
      { actionId: 'p7-report', summary: 'Interpret legacy.', disposition: 'report', command: null },
    ] }],
  } })).json();
  expect(draft.phase).toBe('report-player'); expect(draft.tasks[0].taskId).toBe('reports.explain-campaign');
  const reportPrompt = JSON.parse(draft.tasks[0].userPrompt);
  expect(reportPrompt.campaign.latestLegacy.assessmentId).toBe('legacy:p7-interim');
  expect(reportPrompt.campaign.latestLegacy.scores).toBeTruthy();
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-reports', outputs: [{ reports: [{ actionId: 'p7-report', title: 'Interim legacy', body: 'The engine scores show the current legacy and visible costs.' }] }],
  } })).json();
  current = await (await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: { turnToken: draft.turnToken, turnDigest: draft.turnDigest } })).json();
  expect(current.agentTurn.reports[0]).toEqual(expect.objectContaining({ title: 'Interim legacy', source: 'model' }));

  await page.addInitScript(() => { localStorage.setItem('Terrain', 'false'); localStorage.setItem('Globe', 'false'); });
  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole('button', { name: 'Open advisor and economy' }).click({ force: true });
  await page.getByRole('button', { name: 'Campaign' }).click();
  const pane = page.getByTestId('campaign-pane'); await expect(pane).toBeVisible();
  await expect(pane).toContainText('Standardize Austrian industry'); await expect(pane).toContainText('Latest legacy');
  await pane.getByTestId('queue-legacy').click(); await expect(pane.getByTestId('campaign-queued')).toContainText('Legacy assessment queued');
  await request.delete(`/api/games/${gameId}`);
});
