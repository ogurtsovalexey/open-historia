import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { validateScenarioV3 } from '../src/v3/validator.js';

const scenarioUrl = new URL('../../scenarios/central-mesoamerica-1450/scenario.json', import.meta.url);

async function loadScenario(): Promise<unknown> {
  return JSON.parse(await readFile(scenarioUrl, 'utf8'));
}

describe('Central Mesoamerica 1450 shipped ScenarioV3', () => {
  it('ships the canonical boundary, 44 regions and ten active strategic subjects', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    assert.strictEqual(scenario.id, 'scenario:central-mesoamerica-1450');
    assert.strictEqual(scenario.profile, 'historical');
    assert.strictEqual(scenario.game.startDate, '1450-01-01');
    assert.strictEqual(Object.keys(scenario.startingState.regions).length, 44);
    assert.deepStrictEqual(scenario.game.playerEligiblePolityIds, [
      'polity:tenochtitlan', 'polity:texcoco', 'polity:tlacopan', 'polity:tlatelolco',
      'polity:tlaxcallan', 'polity:purepecha', 'polity:cholollan', 'polity:chalco',
      'polity:huexotzinco', 'polity:tututepec',
    ]);
    assert.ok(scenario.game.playerEligiblePolityIds.every(
      (polityId) => scenario.startingState.polities[polityId]!.decisionMode === 'active',
    ));
    assert.strictEqual(
      Object.values(scenario.startingState.polities).filter((polity) => polity.decisionMode === 'supported').length,
      16,
    );
  });

  it('owns Mesoamerican catalogs and contains no industrial or modern-state defaults', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    const commodities = Object.keys(scenario.catalogs.commodities);
    for (const expected of ['maize', 'obsidian', 'cotton', 'cacao', 'timber', 'stone', 'mantles', 'copal']) {
      assert.ok(commodities.includes(`commodity:${expected}`), expected);
    }
    const serialized = JSON.stringify(scenario).toLowerCase();
    assert.doesNotMatch(serialized, /(?:^|[^a-z])(coal|oil|steel|bonds?|gdp|unemployment|central[- ]bank|finance minister|head of government|industry budget)(?:[^a-z]|$)/);
    assert.strictEqual(Object.keys(scenario.catalogs.financeInstruments).length, 0);
  });

  it('models the Triple Alliance as three polities and a sourced obligation, without transferring control', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    const alliance = scenario.startingState.relationships['relationship:triple-alliance'];
    assert.ok(alliance);
    assert.deepStrictEqual(alliance.participantPolityIds, ['polity:tenochtitlan', 'polity:texcoco', 'polity:tlacopan']);
    assert.strictEqual(alliance.typeId, 'relationship-type:tribute-alliance');
    const obligation = scenario.startingState.tributeObligations['obligation:xochimilco-triple-alliance'];
    assert.ok(obligation);
    assert.deepStrictEqual(obligation.payerPolityIds, ['polity:xochimilco']);
    assert.strictEqual(obligation.beneficiaries.reduce((sum, entry) => sum + entry.shareBp, 0), 10_000);
    assert.deepStrictEqual(obligation.deliveries, [{ commodityId: 'commodity:maize', quantity: 300 }]);
    assert.strictEqual(obligation.enforcementBasisId, alliance.id);
    assert.ok(obligation.evidenceIds.every((evidenceId) => scenario.provenance.evidence[evidenceId]?.basis.kind === 'historical'));
    for (const region of Object.values(scenario.startingState.regions)) {
      assert.strictEqual(region.legalOwnerPolityId, region.actualControllerPolityId, region.id);
    }
  });

  it('uses nonzero causal controls while preserving uncertainty and full provenance coverage', async () => {
    const validation = validateScenarioV3(await loadScenario());
    assert.strictEqual(validation.valid, true, JSON.stringify(validation.errors, null, 2));
    const scenario = validation.scenario!;
    assert.ok(Object.keys(scenario.provenance.sources).length >= 8);
    assert.ok(Object.values(scenario.startingState.populationCohorts).every((cohort) => cohort.population > 0));
    assert.ok(Object.values(scenario.startingState.regions).every((region) => region.fiscalBase > 0 && region.productiveCapacity > 0 && region.supplyCapacity > 0));
    assert.ok(Object.keys(scenario.startingState.formations).length >= 26);
    const cohortsByRegion = new Map(Object.values(scenario.startingState.populationCohorts).map((cohort) => [cohort.regionId, cohort]));
    for (const polity of Object.values(scenario.startingState.polities)) {
      const regionIds = Object.values(scenario.startingState.regions).filter((region) => region.legalOwnerPolityId === polity.id).map((region) => region.id);
      const eligible = regionIds.reduce((sum, regionId) => {
        const cohort = cohortsByRegion.get(regionId)!;
        return sum + Math.floor(cohort.population * cohort.recruitmentEligibilityBp / 10_000);
      }, 0);
      const personnel = Object.values(scenario.startingState.formations)
        .filter((formation) => formation.polityId === polity.id)
        .reduce((sum, formation) => sum + Object.values(formation.personnelOrigins).reduce((subtotal, value) => subtotal + value, 0), 0);
      assert.ok(polity.treasury > 0, polity.id);
      assert.ok(personnel > 0 && personnel <= eligible, `${polity.id}: ${personnel}/${eligible}`);
    }
    assert.ok(Object.values(scenario.provenance.evidence).every((evidence) => {
      return evidence.basis.kind === 'historical'
        && evidence.basis.sourceIds.length > 0
        && (evidence.basis.confidence !== 'low' || Boolean(evidence.basis.todo));
    }));
  });
});
