import { expect, test } from '@playwright/test';

const nextMonth = (date) => {
  const [year, month] = date.split('-').map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
};

const completePreparedMonth = async (request, gameId, draft, decide) => {
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'confirm-player',
  } })).json();
  expect(draft.phase).toBe('plan-strategy');
  expect(draft.tasks[0].taskId).toBe('opponents.plan-campaign');
  const prompt = JSON.parse(draft.tasks[0].userPrompt);
  const promptText = JSON.stringify(prompt);
  expect(promptText).not.toContain('FeatureCollection');
  expect(promptText).not.toContain('liquid-fuel reserves');
  expect(promptText).not.toContain('truths');
  expect(promptText).not.toContain('character:');
  expect(prompt.briefs.every((brief) => brief.projectRegionCandidates.length <= 3
    && brief.mobilizationRegionCandidates.length <= 3 && brief.frontRegionCandidates.length <= 6
    && brief.peaceRegionCandidates.length <= 6)).toBeTruthy();
  expect(promptText).not.toContain('supplyLinks');
  const outputs = [{ decisions: prompt.briefs.map((brief) => decide?.(brief, prompt) ?? ({
    polityId: brief.polityId, intent: 'hold', rationale: 'No justified material action.', command: null,
  })) }];
  draft = await (await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-strategy', outputs,
  } })).json();
  const opponentResponse = await request.post(`/api/games/${gameId}/agent-turn/step`, { data: {
    turnToken: draft.turnToken, action: 'submit-opponents',
    outcomes: draft.tasks.map((task) => ({ taskKey: task.taskKey, failureCode: 'mock-utility-offline' })),
  } });
  expect(opponentResponse.ok(), await opponentResponse.text()).toBeTruthy();
  draft = await opponentResponse.json();
  expect(draft.phase).toBe('ready');
  return (await request.post(`/api/games/${gameId}/agent-turn/commit`, { data: {
    turnToken: draft.turnToken, turnDigest: draft.turnDigest,
  } })).json();
};

test('P3c funds competing projects, restructures debt and reveals no secret before intelligence completes', async ({ page, request }) => {
  test.setTimeout(90_000);
  const gameId = 'p3c-statecraft-smoke';
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  expect((await request.post('/api/games', { data: {
    id: gameId, name: 'P3c Statecraft', scenarioId: 'dev-map-6c', setActive: true,
  } })).ok()).toBeTruthy();
  const initial = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(initial.statecraft.finance.debtPrincipal).toBe(0);
  expect(JSON.stringify(initial.statecraft)).not.toContain('liquid-fuel reserves');
  const common = (suffix) => ({
    commandId: `40000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    actorPolityId: initial.playerPolityId, expectedRevision: initial.revision, effectiveMonth: initial.month,
  });
  let draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(initial.gameDate), expectedSessionRevision: initial.sessionRevision, actions: [], commands: [
      { kind: 'finance.issue-bonds', ...common(1), amount: 1000 },
      { kind: 'finance.restructure', ...common(2) },
      {
        kind: 'project.start', ...common(3), projectId: 'project:e2e-intelligence',
        templateId: 'project-template:intelligence-assessment', targetPolityId: 'polity:germany', monthlyFunding: 300, priority: 5,
      },
      {
        kind: 'project.start', ...common(4), projectId: 'project:e2e-admin-first',
        templateId: 'project-template:tax-administration', monthlyFunding: 500, priority: 3,
      },
      {
        kind: 'project.start', ...common(5), projectId: 'project:e2e-admin-blocked',
        templateId: 'project-template:tax-administration', monthlyFunding: 500, priority: 3,
      },
    ],
  } })).json();
  const first = await completePreparedMonth(request, gameId, draft, (brief, prompt) => brief.polityId === 'polity:germany' ? ({
    polityId: brief.polityId, intent: 'set-policy', rationale: 'Shift public priorities toward industry.',
    command: {
      kind: 'finance.set-policy', actorPolityId: brief.polityId,
      expectedRevision: prompt.revision, effectiveMonth: prompt.month, taxBurdenBp: 10500, exemptionBp: 500,
      priorities: { administration: 2000, science: 1500, industry: 3500, security: 1000, military: 2000 },
    },
  }) : ({ polityId: brief.polityId, intent: 'hold', rationale: 'No justified material action.', command: null }));
  expect(first.statecraft.finance).toMatchObject({ debtPrincipal: 900, defaultCount: 1 });
  expect(first.agentTurn.months[0].strategicDecisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ polityId: 'polity:germany', intent: 'set-policy', source: 'model' }),
  ]));
  expect(first.lastTurn.ledger.statecraft.projectAllocations).toEqual(expect.arrayContaining([
    expect.objectContaining({ projectId: 'project:e2e-intelligence', outcome: 'advanced' }),
    expect.objectContaining({ projectId: 'project:e2e-admin-first', outcome: 'capacity-blocked', spent: 0 }),
  ]));
  expect(JSON.stringify(first.statecraft)).not.toContain('liquid-fuel reserves');

  draft = await (await request.post(`/api/games/${gameId}/agent-turn/prepare`, { data: {
    targetDate: nextMonth(first.gameDate), expectedSessionRevision: first.sessionRevision, actions: [], commands: [],
  } })).json();
  const second = await completePreparedMonth(request, gameId, draft);
  const revealed = second.statecraft.knownFacts.find((entry) => entry.factId === 'intel:germany-statecraft-1938');
  expect(revealed).toMatchObject({
    observerPolityId: initial.playerPolityId, confidence: 'high', source: 'intelligence',
    evidenceId: 'evidence:scenario-1938-germany-brief',
  });
  expect(revealed.summary.en).toContain('liquid-fuel reserves');

  await page.addInitScript(() => {
    localStorage.setItem('Terrain', 'false'); localStorage.setItem('Globe', 'false');
  });
  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole('button', { name: 'Open advisor and economy' }).click({ force: true });
  await page.getByRole('button', { name: 'Statecraft' }).click();
  const pane = page.getByTestId('statecraft-pane');
  await expect(pane).toBeVisible();
  await expect(pane).toContainText(/Debt 900/);
  await expect(pane).toContainText(/Defaults 1/);
  await expect(pane).toContainText(/liquid-fuel reserves|запасов жидкого топлива/i);
  await request.delete(`/api/games/${gameId}`);
});
