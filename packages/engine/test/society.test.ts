import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  canonicalOf, compositionShares, initState, parseScenario, parseTurnCommands,
  polityIdentityEffects, resolveMonth, type EconWorldState,
} from '../src/index.js';
import { FIXTURES_DIR } from './helpers.js';

const scenarioRaw = JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-6c', 'scenario.json'), 'utf8'));
const scenario = parseScenario(scenarioRaw);
const initial = () => initState(scenario);
const id = (suffix: number) => `70000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const common = (state: EconWorldState, suffix: number, actorPolityId = 'polity:austria') => ({
  commandId: id(suffix), actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month,
});
const tick = (state: EconWorldState, commands: unknown[] = []) => resolveMonth(state, parseTurnCommands({ commands }));

describe('P6 capabilities and identity (canon 15)', () => {
  it('materialises separate exact culture and religion layers without changing the accepted opening balance', () => {
    const state = initial();
    assert.equal(state.capabilities?.catalog.length, 3);
    assert.equal(state.capabilities?.unlocked.length, 0);
    assert.equal(state.identity?.regions.length, state.regions.length);
    for (const row of state.identity!.regions) {
      assert.equal([...compositionShares(row.culture).values()].reduce((sum, value) => sum + value, 0), 10000);
      assert.equal([...compositionShares(row.religion).values()].reduce((sum, value) => sum + value, 0), 10000);
    }
    assert.deepEqual(polityIdentityEffects(state.identity, state.regions, 'polity:austria'), {
      cultureMismatchBp: 0, religionMismatchBp: 0, taxMultiplierBp: 10000,
      recruitmentMultiplierBp: 10000, unrestPressureBp: 0,
    });
  });

  it('unlocks research after prerequisites and applies production only from the following month', () => {
    const state = initial();
    const start = { kind: 'project.start', ...common(state, 1), projectId: 'project:industrial-test',
      templateId: 'project-template:industrial-standardization', monthlyFunding: 1000, priority: 5 };
    const first = tick(state, [start]);
    const firstPotential = first.ledger.polities.find((entry) => entry.polityId === 'polity:austria')!.goods!.potential;
    const second = tick(first.state);
    const secondPotential = second.ledger.polities.find((entry) => entry.polityId === 'polity:austria')!.goods!.potential;
    assert.equal(second.ledger.statecraft!.capabilityUnlocks?.[0]?.capabilityId, 'capability:industrial-standardization');
    assert.equal(secondPotential, firstPotential);
    const third = tick(second.state);
    assert.equal(third.ledger.polities.find((entry) => entry.polityId === 'polity:austria')!.goods!.potential, Math.floor((secondPotential * 11000) / 10000));

    const duplicate = tick(second.state, [{ ...start, ...common(second.state, 2), projectId: 'project:industrial-duplicate' }]);
    assert.equal(duplicate.rejections[0]?.reason, 'invalid-target');
    const missingPrerequisite = tick(state, [{ kind: 'project.start', ...common(state, 3), projectId: 'project:radio-too-soon',
      templateId: 'project-template:radio-command', monthlyFunding: 1000, priority: 5 }]);
    assert.equal(missingPrerequisite.rejections[0]?.reason, 'missing-prerequisite');
  });

  it('makes acceptance and policies visibly trade tax, unrest and recruitment', () => {
    const state = initial();
    const revoke = { kind: 'identity.set-culture-acceptance', ...common(state, 4), domain: 'culture', identityId: 'culture:german', accepted: false };
    const tolerant = tick(state, [revoke]);
    const privileged = tick(state, [revoke, { kind: 'identity.set-policy', ...common(state, 5), domain: 'culture', policy: 'privilege' }]);
    const tolerantIdentity = tolerant.ledger.identity!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    const privilegedIdentity = privileged.ledger.identity!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    assert.ok(tolerantIdentity.taxMultiplierBp < privilegedIdentity.taxMultiplierBp);
    assert.ok(tolerantIdentity.recruitmentMultiplierBp < privilegedIdentity.recruitmentMultiplierBp);
    assert.ok(tolerantIdentity.unrestPressureBp < privilegedIdentity.unrestPressureBp);
    assert.ok(tolerant.ledger.polities.find((entry) => entry.polityId === 'polity:austria')!.taxTotal
      < privileged.ledger.polities.find((entry) => entry.polityId === 'polity:austria')!.taxTotal);

    const military = state.military!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    const effects = polityIdentityEffects(tolerant.state.identity, tolerant.state.regions, 'polity:austria');
    const available = Math.floor((military.manpowerCeiling * effects.recruitmentMultiplierBp) / 10000) - military.mobilized - military.casualties;
    const rejected = tick(tolerant.state, [{ kind: 'military.mobilize', ...common(tolerant.state, 6), formationId: 'formation:austria-identity-limit',
      locationRegionId: 'region:gadm:AUT.5_1', manpower: available + 1, equipment: 1, commanderId: null }]);
    assert.equal(rejected.rejections[0]?.reason, 'invalid-amount');
    assert.match(rejected.rejections[0]?.detail ?? '', /identity-adjusted availability/);
  });

  it('integrates slower and with less unrest than coercion while conserving every share', () => {
    const state = initial();
    const commands = (policy: 'integration' | 'coercion', suffix: number) => [
      { kind: 'identity.set-culture-acceptance', ...common(state, suffix), domain: 'culture', identityId: 'culture:german', accepted: false },
      { kind: 'identity.set-policy', ...common(state, suffix + 1), domain: 'culture', policy },
    ];
    const integration = tick(state, commands('integration', 7));
    const coercion = tick(state, commands('coercion', 9));
    const row = (result: typeof integration) => result.ledger.identity!.regions.find((entry) => entry.regionId === 'region:gadm:AUT.5_1')!;
    assert.equal(row(integration).cultureShiftBp, 25);
    assert.equal(row(coercion).cultureShiftBp, 75);
    const polity = (result: typeof integration) => result.ledger.identity!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    assert.ok(polity(integration).unrestPressureBp < polity(coercion).unrestPressureBp);
    for (const result of [integration, coercion]) {
      const composition = result.state.identity!.regions.find((entry) => entry.regionId === 'region:gadm:AUT.5_1')!.culture;
      assert.equal([...compositionShares(composition).values()].reduce((sum, value) => sum + value, 0), 10000);
    }
  });

  it('keeps demographics attached on transfer and recalculates mismatch for the new controller', () => {
    const state = initial();
    const before = canonicalOf(state.identity!.regions.find((entry) => entry.regionId === 'region:gadm:AUT.5_1'));
    const result = tick(state, [{ kind: 'territory.transfer-region', ...common(state, 11), targetRegionId: 'region:gadm:AUT.5_1', newControllerId: 'polity:czechia' }]);
    const after = canonicalOf(result.state.identity!.regions.find((entry) => entry.regionId === 'region:gadm:AUT.5_1'));
    assert.equal(after, before);
    assert.equal(result.ledger.identity!.regions.find((entry) => entry.regionId === 'region:gadm:AUT.5_1')!.cultureMismatchBp, 10000);
  });

  it('rejects unknown, foreign, official and stale identity commands without partial command mutation', () => {
    const state = initial();
    const result = tick(state, [
      { kind: 'identity.set-culture-acceptance', ...common(state, 12), domain: 'culture', identityId: 'culture:unknown', accepted: true },
      { kind: 'identity.set-culture-acceptance', ...common(state, 13), domain: 'culture', identityId: 'culture:french', accepted: true },
      { kind: 'identity.set-culture-acceptance', ...common(state, 14), domain: 'culture', identityId: 'culture:austrian', accepted: false },
      { kind: 'identity.set-policy', ...common(state, 15), expectedRevision: `sha256:${'a'.repeat(64)}`, domain: 'culture', policy: 'coercion' },
    ]);
    assert.deepEqual(result.rejections.map((entry) => entry.reason), ['unknown-identity', 'foreign-target', 'invalid-target', 'stale-revision']);
    assert.equal(result.state.identity!.polities.find((entry) => entry.polityId === 'polity:austria')!.culturePolicy, 'tolerance');
  });

  it('replays the same capability and identity commands byte-identically', () => {
    const state = initial();
    const commands = [{ kind: 'identity.set-culture-acceptance', ...common(state, 16), domain: 'culture', identityId: 'culture:german', accepted: false },
      { kind: 'identity.set-policy', ...common(state, 17), domain: 'culture', policy: 'integration' }];
    assert.equal(canonicalOf(tick(state, commands)), canonicalOf(tick(state, commands)));
  });

  it('rejects malformed capability graphs and identity references at the scenario boundary', () => {
    const cyclic = structuredClone(scenarioRaw);
    cyclic.capabilities.catalog[0].prerequisiteIds = ['capability:radio-command'];
    cyclic.capabilities.catalog[1].prerequisiteIds = ['capability:industrial-standardization'];
    assert.throws(() => parseScenario(cyclic), /acyclic/);
    const unknownGroup = structuredClone(scenarioRaw);
    unknownGroup.identity.regions[0].culture.primaryId = 'culture:unknown';
    assert.throws(() => parseScenario(unknownGroup), /unknown region\/group/);
    const invalidStarting = structuredClone(scenarioRaw);
    invalidStarting.capabilities.starting = [{ polityId: 'polity:austria', capabilityId: 'capability:radio-command' }];
    assert.throws(() => parseScenario(invalidStarting), /lacks a prerequisite/);
  });

  it('keeps legacy scenarios free of P6 state and rejects P6 commands when the module is disabled', () => {
    const legacyScenario = parseScenario(JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-4c', 'scenario.json'), 'utf8')));
    const state = initState(legacyScenario);
    assert.equal(state.capabilities, undefined); assert.equal(state.identity, undefined);
    const result = tick(state, [{ kind: 'identity.set-policy', ...common(state, 18), domain: 'culture', policy: 'integration' }]);
    assert.equal(result.rejections[0]?.reason, 'module-disabled');
    assert.equal(result.state.capabilities, undefined); assert.equal(result.state.identity, undefined);
  });
});
