import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { validateScenarioV3 } from '../src/v3/validator.js';

const scenarioUrl = new URL('../../scenarios/napoleonic-europe-1805/scenario.json', import.meta.url);

async function loadScenario(): Promise<unknown> {
  return JSON.parse(await readFile(scenarioUrl, 'utf8'));
}

describe('Napoleonic Europe 1805 shipped ScenarioV3', () => {
  it('ships the January boundary, exact playable titles, 26 polities and 113 regions', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    assert.strictEqual(scenario.id, 'scenario:napoleonic-europe-1805');
    assert.strictEqual(scenario.profile, 'historical');
    assert.strictEqual(scenario.game.startDate, '1805-01-01');
    assert.strictEqual(Object.keys(scenario.startingState.polities).length, 26);
    assert.strictEqual(Object.keys(scenario.startingState.regions).length, 113);
    assert.deepStrictEqual(
      scenario.game.playerEligiblePolityIds.map((id) => scenario.startingState.polities[id]!.displayName.en),
      [
        'French Empire',
        'United Kingdom of Great Britain and Ireland',
        'Austrian Empire',
        'Russian Empire',
        'Kingdom of Prussia',
        'Kingdom of Spain',
        'Ottoman Empire',
        'Kingdom of Sweden',
        'Denmark–Norway',
        'Kingdoms of Naples and Sicily',
        'Italian Republic',
        'Electorate of Bavaria',
      ],
    );
    assert.ok(scenario.game.playerEligiblePolityIds.every(
      (polityId) => scenario.startingState.polities[polityId]!.decisionMode === 'active',
    ));
    assert.strictEqual(
      Object.values(scenario.startingState.polities).filter((polity) => polity.decisionMode === 'supported').length,
      14,
    );
  });

  it('owns Napoleonic catalogs, formation origins and the Gibraltar blockade route', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    assert.deepStrictEqual(Object.keys(scenario.catalogs.commodities).sort(), [
      'commodity:arms', 'commodity:cloth', 'commodity:fibers', 'commodity:grain',
      'commodity:gunpowder', 'commodity:horses', 'commodity:iron', 'commodity:luxury',
      'commodity:powder', 'commodity:provisions', 'commodity:timber',
    ]);
    assert.ok(Object.values(scenario.startingState.formations).length > 26);
    for (const formation of Object.values(scenario.startingState.formations)) {
      const ownedRegionCount = Object.values(scenario.startingState.regions).filter((region) => region.legalOwnerPolityId === formation.polityId).length;
      assert.ok(Object.keys(formation.personnelOrigins).length >= Math.min(2, ownedRegionCount), formation.id);
      assert.ok(Object.values(formation.personnelOrigins).reduce((sum, value) => sum + value, 0) > 0, formation.id);
      assert.ok(Object.values(formation.equipment).every((value) => value > 0), formation.id);
    }
    const route = scenario.startingState.routes['route:gibraltar-blockade'];
    assert.ok(route);
    assert.strictEqual(route.classId, 'route-class:sea-blockade');
    assert.ok(route.regionIds.some((id) => id === 'region:nap1805:gibraltar'));
  });

  it('grounds population, capacity and mobilization in nonzero causal controls', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    const cohortByRegion = new Map(Object.values(scenario.startingState.populationCohorts).map((cohort) => [cohort.regionId, cohort]));
    for (const region of Object.values(scenario.startingState.regions)) {
      const cohort = cohortByRegion.get(region.id);
      assert.ok(cohort && cohort.population > 0, region.id);
      assert.ok(region.fiscalBase > 0 && region.productiveCapacity > 0 && region.supplyCapacity > 0, region.id);
    }
    for (const polity of Object.values(scenario.startingState.polities)) {
      const regionIds = Object.values(scenario.startingState.regions).filter((region) => region.legalOwnerPolityId === polity.id).map((region) => region.id);
      const recruitmentPool = regionIds.reduce((sum, id) => {
        const cohort = cohortByRegion.get(id)!;
        return sum + Math.floor(cohort.population * cohort.recruitmentEligibilityBp / 10_000);
      }, 0);
      const personnel = Object.values(scenario.startingState.formations)
        .filter((formation) => formation.polityId === polity.id)
        .reduce((sum, formation) => sum + Object.values(formation.personnelOrigins).reduce((subtotal, value) => subtotal + value, 0), 0);
      assert.ok(polity.treasury > 0, polity.id);
      assert.ok(personnel > 0 && personnel <= recruitmentPool, `${polity.id}: ${personnel}/${recruitmentPool}`);
    }
  });

  it('carries historical evidence for every authored starting entity and no scripted outcomes', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    const text = JSON.stringify(scenario).toLowerCase();
    assert.doesNotMatch(text, /scripted[- ](?:austerlitz|trafalgar|third coalition)|guaranteed[- ](?:austerlitz|trafalgar|coalition)/);
    assert.ok(Object.keys(scenario.provenance.sources).length >= 8);
    assert.ok(!Object.values(scenario.startingState.relationships).some((relationship) => relationship.typeId === 'relationship-type:coalition-obligation'));
    assert.ok(Object.values(scenario.startingState.relationships).some((relationship) => relationship.typeId === 'relationship-type:coalition-negotiation'));
    assert.ok(Object.values(scenario.provenance.evidence).every((evidence) => (
      evidence.basis.kind === 'historical' && evidence.basis.sourceIds.length > 0
    )));
    for (const collection of [
      scenario.startingState.polities,
      scenario.startingState.regions,
      scenario.startingState.populationCohorts,
      scenario.startingState.formations,
      scenario.startingState.relationships,
      scenario.startingState.routes,
      scenario.startingState.concepts,
      scenario.startingState.knowledge,
    ]) {
      assert.ok(Object.values(collection).every((entry) => entry.evidenceIds.length > 0));
    }
  });
});
