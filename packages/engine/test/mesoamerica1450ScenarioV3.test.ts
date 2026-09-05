import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { compileScenarioV3 } from '../src/world/compileScenarioV3.js';
import { applyTributeDelivery } from '../src/world/tribute.js';
import { derivePolitySnapshot, deriveRegionSnapshot } from '../src/world/selectors.js';

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
    const obligation = initialState.tributeObligations.find((entry) => entry.obligationId === 'obligation:xochimilco-triple-alliance');
    assert.ok(obligation);
    assert.strictEqual(obligation.beneficiaries.reduce((sum, entry) => sum + entry.shareBp, 0), 10_000);
    const controls = initialState.regions.map((region) => structuredClone(region.control));
    const beforeMaize = initialState.polities.reduce((sum, polity) => sum + (polity.stockpiles.find((entry) => entry.commodityId === 'commodity:maize')?.quantity ?? 0), 0);
    const delivered = applyTributeDelivery(initialState, { obligationId: obligation.obligationId, expectedRevision: initialState.revision });
    const afterMaize = delivered.state.polities.reduce((sum, polity) => sum + (polity.stockpiles.find((entry) => entry.commodityId === 'commodity:maize')?.quantity ?? 0), 0);
    assert.strictEqual(afterMaize, beforeMaize);
    assert.strictEqual(delivered.rows[0]!.payerDebits.reduce((sum, row) => sum + row.quantity, 0), delivered.rows[0]!.beneficiaryCredits.reduce((sum, row) => sum + row.quantity, 0));
    assert.deepStrictEqual(delivered.state.regions.map((region) => region.control), controls);
    const xochimilco = deriveRegionSnapshot(initialState, 'region:meso1450:xochimilco').value;
    assert.ok(xochimilco.obligatedLabor > 0 && xochimilco.obligatedMilitaryService > 0);
    const catalog = JSON.stringify(initialState.catalogs).toLowerCase();
    assert.doesNotMatch(catalog, /(?:^|[^a-z])(coal|oil|steel|bonds?|gdp)(?:[^a-z]|$)/);
    assert.ok(initialState.catalogs.commodities.some((entry) => entry.commodityId === 'commodity:maize'));
    assert.ok(!initialState.catalogs.commodities.some((entry) => entry.commodityId === 'commodity:horses'));
  });
});
