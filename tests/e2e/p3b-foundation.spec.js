import { expect, test } from '@playwright/test';

test('P3b boots six polities and exposes separate strategic and utility AI profiles', async ({ page, request }) => {
  const gameId = 'p3b-foundation-smoke';
  await request.delete(`/api/games/${gameId}`).catch(() => {});
  const created = await request.post('/api/games', {
    data: { id: gameId, name: 'P3b Foundation', scenarioId: 'dev-map-6c', setActive: true },
  });
  expect(created.ok()).toBeTruthy();

  const snapshot = await (await request.get(`/api/games/${gameId}/economy/state`)).json();
  expect(snapshot.polities).toHaveLength(6);
  expect(snapshot.regions).toHaveLength(76);
  expect(snapshot.polities.map((polity) => polity.id).sort()).toEqual([
    'polity:austria', 'polity:czechia', 'polity:france',
    'polity:germany', 'polity:poland', 'polity:slovakia',
  ]);
  expect(snapshot.ownershipOverrides['FRA.8_1']).toBe('France');
  expect(snapshot.ownershipOverrides['POL.7_1']).toBe('Poland');

  const modelCalls = [];
  await page.route(/(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|\/api\/relay)/, async (route) => {
    modelCalls.push(route.request().url());
    await route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('Terrain', 'false');
    localStorage.setItem('Globe', 'false');
  });
  await page.goto(`/?gameId=${gameId}`);
  await page.getByRole('button', { name: '⋮' }).click({ force: true });
  await expect(page.getByText('Strategic AI provider')).toBeVisible();
  await expect(page.getByText('Utility AI provider')).toBeVisible();
  expect(modelCalls).toEqual([]);
});
