import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { compileScenarioV3 } from '../src/world/compileScenarioV3.js';
import { derivePolitySnapshot } from '../src/world/selectors.js';

const scenarioUrl = new URL('../../../data-packs/scenarios/europe-1935-benchmark/scenario.json', import.meta.url);

async function loadEurope1935(): Promise<unknown> {
  return JSON.parse(await readFile(scenarioUrl, 'utf8'));
}

describe('Europe 1935 ScenarioV3 compiler regression', () => {
  it('compiles three times to one seed, projection and initial revision', async () => {
    const input = await loadEurope1935();
    const compilations = [compileScenarioV3(input), compileScenarioV3(input), compileScenarioV3(input)];
    assert.strictEqual(new Set(compilations.map((entry) => entry.bundleChecksum)).size, 1);
    assert.strictEqual(new Set(compilations.map((entry) => entry.seedChecksum)).size, 1);
    assert.strictEqual(new Set(compilations.map((entry) => entry.runtimeProjectionChecksum)).size, 1);
    assert.strictEqual(new Set(compilations.map((entry) => entry.initialState.revision)).size, 1);
  });

  it('projects 116 regions, six explicit off-map macro-regions and seven playable polities', async () => {
    const compiled = compileScenarioV3(await loadEurope1935());
    assert.strictEqual(compiled.initialState.regions.length, 116);
    assert.strictEqual(compiled.runtimeProjection.regions.filter((region) => region.geography.kind === 'off-map').length, 6);
    assert.strictEqual(compiled.runtimeProjection.polities.filter((polity) => polity.playerEligible).length, 7);
    assert.strictEqual(compiled.initialState.concepts.length, 3);
  });

  it('keeps regional population and formation origins causally reconcilable', async () => {
    const compiled = compileScenarioV3(await loadEurope1935());
    const state = compiled.initialState;
    for (const formation of state.formations) {
      assert.strictEqual(formation.manpower, 100_000);
      assert.ok(formation.personnelOrigins.length >= 2);
      assert.strictEqual(formation.personnelOrigins.reduce((sum, row) => sum + row.personnel, 0), formation.manpower);
      for (const origin of formation.personnelOrigins) {
        const region = state.regions.find((entry) => entry.regionId === origin.regionId)!;
        assert.strictEqual(region.control.legalOwnerPolityId, formation.polityId);
      }
    }
    const poland = derivePolitySnapshot(state, 'polity:poland');
    assert.strictEqual(poland.revision, state.revision);
    assert.ok(poland.value.legalPopulation > 0);
    assert.ok(poland.value.workforce > 0);
    assert.ok(poland.value.availableManpower >= 0);
  });
});
