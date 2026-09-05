import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { compileScenarioV3 } from '../src/world/compileScenarioV3.js';
import { derivePolitySnapshot } from '../src/world/selectors.js';

const scenarioUrl = new URL('../../../data-packs/scenarios/central-mesoamerica-1450/scenario.json', import.meta.url);

async function loadMesoamerica1450(): Promise<unknown> {
  return JSON.parse(await readFile(scenarioUrl, 'utf8'));
}

describe('Central Mesoamerica 1450 ScenarioV3 compiler regression', () => {
  it('compiles three times to one January seed and revision', async () => {
    const input = await loadMesoamerica1450();
    const compilations = [compileScenarioV3(input), compileScenarioV3(input), compileScenarioV3(input)];
    assert.strictEqual(new Set(compilations.map((entry) => entry.bundleChecksum)).size, 1);
    assert.strictEqual(new Set(compilations.map((entry) => entry.seedChecksum)).size, 1);
    assert.strictEqual(new Set(compilations.map((entry) => entry.initialState.revision)).size, 1);
    assert.strictEqual(compilations[0].initialState.month, '1450-01-01');
    assert.strictEqual(compilations[0].initialState.regions.length, 44);
  });

  it('keeps population, household levies and locality links causally usable', async () => {
    const { initialState, runtimeProjection } = compileScenarioV3(await loadMesoamerica1450());
    assert.ok(initialState.formations.length >= 26);
    assert.ok(runtimeProjection.regions.every((region) => region.adjacentRegionIds.length > 0));
    for (const formation of initialState.formations) {
      assert.ok(formation.manpower > 0, formation.formationId);
      assert.strictEqual(formation.personnelOrigins.reduce((sum, origin) => sum + origin.personnel, 0), formation.manpower);
    }
    const tenochtitlan = derivePolitySnapshot(initialState, 'polity:tenochtitlan').value;
    assert.strictEqual(tenochtitlan.legalPopulation, 160_000);
    assert.ok(tenochtitlan.availableManpower > 0);
  });

  it('preserves three-party tribute relations without European-era catalog leakage', async () => {
    const { initialState } = compileScenarioV3(await loadMesoamerica1450());
    const alliance = initialState.relationships.find((entry) => entry.relationshipId === 'relationship:triple-alliance');
    assert.ok(alliance);
    assert.deepStrictEqual(alliance.participantPolityIds, ['polity:tenochtitlan', 'polity:texcoco', 'polity:tlacopan']);
    const catalog = JSON.stringify(initialState.catalogs).toLowerCase();
    assert.doesNotMatch(catalog, /(?:^|[^a-z])(coal|oil|steel|bonds?|gdp)(?:[^a-z]|$)/);
    assert.ok(initialState.catalogs.commodities.some((entry) => entry.commodityId === 'commodity:maize'));
    assert.ok(!initialState.catalogs.commodities.some((entry) => entry.commodityId === 'commodity:horses'));
  });
});
