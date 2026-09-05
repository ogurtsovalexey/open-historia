import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { validateScenarioV3 } from '../src/v3/validator.js';

const packageUrl = new URL('../../scenarios/europe-1935-benchmark/scenario.json', import.meta.url);

async function loadEurope1935(): Promise<unknown> {
  return JSON.parse(await readFile(packageUrl, 'utf8'));
}

describe('Europe 1935 shipped ScenarioV3', () => {
  it('is a closed, provenance-valid historical authoring package', async () => {
    const validation = validateScenarioV3(await loadEurope1935());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    assert.strictEqual(validation.scenario?.id, 'scenario:europe-1935-benchmark');
    assert.strictEqual(validation.scenario?.profile, 'historical');
    assert.strictEqual(validation.scenario?.game.startDate, '1935-01-01');
    assert.strictEqual(Object.keys(validation.scenario?.startingState.regions ?? {}).length, 116);
    assert.deepStrictEqual(validation.scenario?.game.playerEligiblePolityIds, [
      'polity:austria',
      'polity:czechoslovakia',
      'polity:france',
      'polity:germany',
      'polity:italy',
      'polity:poland',
      'polity:united-kingdom',
    ]);
    const scenario = validation.scenario!;
    assert.ok(scenario.game.playerEligiblePolityIds.every(
      (polityId) => scenario.startingState.polities[polityId]!.decisionMode === 'active',
    ));
    assert.deepStrictEqual(
      Object.values(scenario.startingState.polities)
        .filter((polity) => polity.decisionMode === 'inert')
        .map((polity) => polity.id)
        .sort(),
      ['polity:free-city-of-danzig', 'polity:saargebiet'],
    );
  });

  it('owns era catalogs and starts capabilities as exact concepts, never future outcomes', async () => {
    const validation = validateScenarioV3(await loadEurope1935());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    assert.deepStrictEqual(Object.keys(scenario.catalogs.commodities).sort(), [
      'commodity:coal', 'commodity:food', 'commodity:goods',
      'commodity:iron', 'commodity:oil', 'commodity:wood',
    ]);
    assert.deepStrictEqual(Object.keys(scenario.startingState.concepts).sort(), [
      'concept:administrative-coordination',
      'concept:industrial-planning',
      'concept:staff-planning',
    ]);
    assert.deepStrictEqual(scenario.worldRules.knowledgeBaseline.sort(), Object.keys(scenario.startingState.concepts).sort());
    assert.ok(!('milestones' in scenario.startingState));
    assert.ok(!('causalAnchors' in scenario.startingState));
  });

  it('authors every formation from conserved regional origins', async () => {
    const validation = validateScenarioV3(await loadEurope1935());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    const formations = Object.values(scenario.startingState.formations);
    assert.strictEqual(formations.length, 7);
    for (const formation of formations) {
      const origins = Object.entries(formation.personnelOrigins).filter(([, personnel]) => personnel > 0);
      assert.ok(origins.length >= 2, `${formation.id} must not invent a single-region origin`);
      assert.strictEqual(origins.reduce((sum, [, personnel]) => sum + personnel, 0), 100_000);
    }
  });

  it('fixes geography links without inventing feature identifiers', async () => {
    const validation = validateScenarioV3(await loadEurope1935());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const links = Object.values(validation.scenario!.geography.regions).map((region) => region.link);
    const serialized = JSON.stringify(links);
    assert.doesNotMatch(serialized, /undefined|null/);
    assert.ok(links.some((link) => link.kind === 'off-map'));
  });
});
