import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateScenarioV3 } from '../src/v3/validator.js';
import { minimalScenarioV3 } from './scenarioV3Fixtures.js';

describe('ScenarioV3 reference closure', () => {
  it('accepts a minimal scenario-neutral authoring package', () => {
    const result = validateScenarioV3(minimalScenarioV3());
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  const cases: Array<[string, (input: ReturnType<typeof minimalScenarioV3>) => void, string]> = [
    ['default player', (input) => { input.game.defaultPlayerPolityId = 'polity:missing'; }, '/game/defaultPlayerPolityId'],
    ['world model', (input) => { input.worldRules.physicalModel = 'world-model:missing'; }, '/worldRules/physicalModel'],
    ['module', (input) => { input.modules.enabled[0] = 'module:missing'; }, '/modules/enabled/0'],
    ['stock commodity', (input) => { input.startingState.polities['polity:alpha']!.stockpiles['commodity:missing'] = 1; }, '/startingState/polities/polity:alpha/stockpiles/commodity:missing'],
    ['region owner', (input) => { input.startingState.regions['region:test:A']!.legalOwnerPolityId = 'polity:missing'; }, '/startingState/regions/region:test:A/legalOwnerPolityId'],
    ['control profile', (input) => { input.startingState.regions['region:test:A']!.controlProfileId = 'control-profile:missing'; }, '/startingState/regions/region:test:A/controlProfileId'],
    ['geography asset', (input) => { const link = input.geography.regions['region:test:A']!.link; if (link.kind === 'scenario-asset') link.assetId = 'asset:test:missing'; }, '/geography/regions/region:test:A/link/assetId'],
    ['cohort region', (input) => { input.startingState.populationCohorts['cohort:alpha']!.regionId = 'region:test:missing'; }, '/startingState/populationCohorts/cohort:alpha/regionId'],
    ['entity evidence', (input) => { input.startingState.regions['region:test:A']!.evidenceIds[0] = 'evidence:missing'; }, '/startingState/regions/region:test:A/evidenceIds/0'],
  ];

  for (const [label, mutate, expectedPath] of cases) {
    it(`rejects unknown ${label} with an exact JSON path`, () => {
      const input = minimalScenarioV3();
      mutate(input);
      const result = validateScenarioV3(input);
      assert.ok(result.errors.some((error) => error.path === expectedPath), JSON.stringify(result.errors));
    });
  }

  it('rejects record key/value identity mismatch at the value id', () => {
    const input = minimalScenarioV3();
    input.startingState.polities['polity:alpha']!.id = 'polity:beta';
    const result = validateScenarioV3(input);
    assert.ok(result.errors.some((error) => error.path === '/startingState/polities/polity:alpha/id'));
  });

  it('enforces commodity usage separately for stockpiles and regional resources', () => {
    const stockOnly = minimalScenarioV3();
    stockOnly.catalogs.commodities['commodity:food']!.usage = 'stockpile';
    assert.ok(validateScenarioV3(stockOnly).errors.some((error) => error.path === '/startingState/regions/region:test:A/resources/commodity:food'));

    const regionalOnly = minimalScenarioV3();
    regionalOnly.catalogs.commodities['commodity:food']!.usage = 'regional';
    assert.ok(validateScenarioV3(regionalOnly).errors.some((error) => error.path === '/startingState/polities/polity:alpha/stockpiles/commodity:food'));
  });

  it('validates evidence visibility scopes and their polity references', () => {
    const publicScoped = minimalScenarioV3();
    publicScoped.provenance.evidence['evidence:polity-alpha']!.visibleToPolityIds = ['polity:alpha'];
    assert.ok(validateScenarioV3(publicScoped).errors.some((error) => error.path === '/provenance/evidence/evidence:polity-alpha/visibleToPolityIds'));

    const polityUnscoped = minimalScenarioV3();
    const evidence = polityUnscoped.provenance.evidence['evidence:knowledge-alpha-writing']!;
    evidence.visibleToPolityIds = [];
    assert.ok(validateScenarioV3(polityUnscoped).errors.some((error) => error.path === '/provenance/evidence/evidence:knowledge-alpha-writing/visibleToPolityIds'));

    const unknownScope = minimalScenarioV3();
    unknownScope.provenance.evidence['evidence:knowledge-alpha-writing']!.visibleToPolityIds = ['polity:missing'];
    assert.ok(validateScenarioV3(unknownScope).errors.some((error) => error.path === '/provenance/evidence/evidence:knowledge-alpha-writing/visibleToPolityIds/0'));
  });

  it('rejects duplicate set-like references at their repeated position', () => {
    const input = minimalScenarioV3();
    input.game.playerEligiblePolityIds.push('polity:alpha');
    const result = validateScenarioV3(input);
    assert.ok(result.errors.some((error) => error.path === '/game/playerEligiblePolityIds/1' && error.code === 'integrity.duplicate-ref'));
  });

  it('rejects a provenance binding that does not resolve', () => {
    const input = minimalScenarioV3();
    input.provenance.evidence['evidence:polity-alpha']!.binding.path = '/startingState/missing';
    const result = validateScenarioV3(input);
    assert.ok(result.errors.some((error) => error.path === '/provenance/evidence/evidence:polity-alpha/binding/path'));
  });
});
