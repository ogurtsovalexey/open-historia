import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { compileScenarioV3 } from '../src/world/compileScenarioV3.js';
import { derivePolitySnapshot } from '../src/world/selectors.js';

const scenarioUrl = new URL('../../../data-packs/scenarios/napoleonic-europe-1805/scenario.json', import.meta.url);

async function loadNapoleonic1805(): Promise<unknown> {
  return JSON.parse(await readFile(scenarioUrl, 'utf8'));
}

describe('Napoleonic Europe 1805 ScenarioV3 compiler regression', () => {
  it('compiles deterministically from the January boundary', async () => {
    const input = await loadNapoleonic1805();
    const first = compileScenarioV3(input);
    const second = compileScenarioV3(input);
    assert.strictEqual(first.bundleChecksum, second.bundleChecksum);
    assert.strictEqual(first.seedChecksum, second.seedChecksum);
    assert.strictEqual(first.initialState.revision, second.initialState.revision);
    assert.strictEqual(first.initialState.month, '1805-01-01');
    assert.strictEqual(first.initialState.regions.length, 113);
  });

  it('preserves modeled population, army origins and occupied Hanover', async () => {
    const { initialState } = compileScenarioV3(await loadNapoleonic1805());
    for (const formation of initialState.formations) {
      assert.ok(formation.manpower > 0, formation.formationId);
      assert.strictEqual(formation.personnelOrigins.reduce((sum, origin) => sum + origin.personnel, 0), formation.manpower);
      for (const origin of formation.personnelOrigins) {
        const region = initialState.regions.find((entry) => entry.regionId === origin.regionId)!;
        assert.strictEqual(region.control.legalOwnerPolityId, formation.polityId);
      }
    }
    const france = derivePolitySnapshot(initialState, 'polity:france').value;
    assert.ok(france.legalPopulation >= 29_300_000);
    assert.ok(france.availableManpower > 0);
    const hanover = initialState.regions.find((region) => region.regionId === 'region:nap1805:hanover')!;
    assert.strictEqual(hanover.control.legalOwnerPolityId, 'polity:hanover');
    assert.strictEqual(hanover.control.actualControllerPolityId, 'polity:france');
    assert.strictEqual(hanover.control.kind, 'occupation');
  });

  it('compiles a blockade route without scripting the Third Coalition', async () => {
    const { initialState } = compileScenarioV3(await loadNapoleonic1805());
    const blockade = initialState.routes.find((route) => route.routeId === 'route:gibraltar-blockade');
    assert.ok(blockade);
    assert.strictEqual(blockade.classId, 'route-class:sea-blockade');
    assert.ok(blockade.regionIds.some((regionId) => regionId === 'region:nap1805:gibraltar'));
    assert.ok(!initialState.relationships.some((relationship) => relationship.kind === 'relationship-type:coalition-obligation'));
    assert.ok(initialState.relationships.some((relationship) => relationship.kind === 'relationship-type:coalition-negotiation'));
  });
});
