import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { canonicalOf, initState, parseScenario, parseTurnCommands, resolveMonth, type EconWorldState } from '../src/index.js';
import { FIXTURES_DIR } from './helpers.js';

const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-6c', 'scenario.json'), 'utf8'));
const scenario = parseScenario(raw);
const initial = () => initState(scenario);
const id = (suffix: number) => `80000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const common = (state: EconWorldState, suffix: number, actorPolityId = 'polity:austria') => ({
  commandId: id(suffix), actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month,
});
const tick = (state: EconWorldState, commands: unknown[] = []) => resolveMonth(state, parseTurnCommands({ commands }));

describe('P7 campaign goals, crises and legacy (canon 16)', () => {
  it('materialises directions without terminal victory and triggers crises deterministically', () => {
    const state = initial();
    assert.equal(state.campaign?.softHorizonMonth, '1939-01-01');
    assert.equal(state.campaign?.goals.some((entry) => entry.status === 'candidate'), true);
    const result = tick(state);
    assert.equal(result.state.month, '1938-02-01');
    assert.equal(result.state.campaign?.crises[0]?.crisisId, 'crisis:german-political-strain');
    assert.ok((result.state.campaign?.crises[0]?.evidenceValue ?? 0) >= 2);
    assert.equal(result.ledger.campaign?.goals.find((entry) => entry.goalId === 'goal:czechia-stability')?.achieved, true);
    assert.equal(canonicalOf(tick(state)), canonicalOf(tick(state)));
    assert.equal('ended' in result.state.campaign!, false);
  });

  it('accepts only owned candidates and crisis participants, then resolves convergent positions', () => {
    let state = tick(initial()).state;
    const rejected = tick(state, [
      { kind: 'campaign.adopt-goal', ...common(state, 1), goalId: 'goal:missing' },
      { kind: 'campaign.adopt-goal', ...common(state, 2, 'polity:france'), goalId: 'goal:austria-industry' },
      { kind: 'crisis.set-position', ...common(state, 3, 'polity:poland'), crisisId: 'crisis:german-political-strain', position: 'press' },
    ]);
    assert.deepEqual(rejected.rejections.map((entry) => entry.reason), ['unknown-goal', 'unauthorized', 'unauthorized']);
    state = tick(state, [
      { kind: 'campaign.adopt-goal', ...common(state, 4), goalId: 'goal:austria-industry' },
      { kind: 'crisis.set-position', ...common(state, 5), crisisId: 'crisis:german-political-strain', position: 'press' },
      { kind: 'crisis.set-position', ...common(state, 6, 'polity:france'), crisisId: 'crisis:german-political-strain', position: 'status-quo' },
      { kind: 'crisis.set-position', ...common(state, 7, 'polity:germany'), crisisId: 'crisis:german-political-strain', position: 'compromise' },
    ]).state;
    assert.equal(state.campaign?.goals.find((entry) => entry.goalId === 'goal:austria-industry')?.status, 'active');
    assert.equal(state.campaign?.crises[0]?.status, 'active');
    state = tick(state, [{ kind: 'crisis.set-position', ...common(state, 20), crisisId: 'crisis:german-political-strain', position: 'compromise' }]).state;
    assert.equal(state.campaign?.crises[0]?.status, 'resolved');
  });

  it('records interim and post-horizon legacy while play continues', () => {
    let state = initial();
    let result = tick(state, [{ kind: 'campaign.assess-legacy', ...common(state, 8), assessmentId: 'legacy:austria-opening' }]);
    assert.equal(result.state.campaign?.assessments[0]?.horizonReached, false);
    state = result.state;
    for (let month = 0; month < 11; month += 1) state = tick(state).state;
    assert.equal(state.month, '1939-01-01');
    result = tick(state, [{ kind: 'campaign.assess-legacy', ...common(state, 9), assessmentId: 'legacy:austria-horizon' }]);
    assert.equal(result.state.campaign?.assessments.find((entry) => entry.assessmentId === 'legacy:austria-horizon')?.horizonReached, true);
    assert.equal(result.state.month, '1939-02-01');
    assert.ok(Object.values(result.state.campaign!.assessments.at(-1)!.scores).every((score) => score >= 0 && score <= 10000));
  });

  it('runs the complete playable path and diverges under different commands', () => {
    let state = initial();
    state = tick(state, [{ kind: 'diplomacy.propose', ...common(state, 10), proposalId: 'proposal:austria-france-campaign', recipientPolityId: 'polity:france',
      terms: { kind: 'agreement', agreementType: 'defensive-alliance', fromPolityId: 'polity:austria', toPolityId: 'polity:france' } }]).state;
    state = tick(state, [
      { kind: 'diplomacy.respond', ...common(state, 11, 'polity:france'), proposalId: 'proposal:austria-france-campaign', response: 'accept' },
      { kind: 'war.declare', ...common(state, 12), warId: 'war:austria-germany-campaign', defenderPolityId: 'polity:germany', reason: 'none' },
      { kind: 'military.mobilize', ...common(state, 13), formationId: 'formation:austria-campaign-reserve', locationRegionId: 'region:gadm:AUT.5_1', manpower: 8000, equipment: 8000, commanderId: null },
    ]).state;
    assert.equal(state.campaign?.goals.find((entry) => entry.goalId === 'goal:austria-france-alliance')?.status, 'achieved');
    assert.ok(state.campaign?.crises.some((entry) => entry.crisisId === 'crisis:german-war'));
    state = tick(state, [
      { kind: 'military.order', ...common(state, 14), formationId: 'formation:austria-first', posture: 'advance', targetRegionId: 'region:gadm:DEU.2_1' },
      { kind: 'military.order', ...common(state, 15), formationId: 'formation:austria-campaign-reserve', posture: 'advance', targetRegionId: 'region:gadm:DEU.2_1' },
    ]).state;
    assert.equal(state.military?.occupations[0]?.actualControllerId, 'polity:austria');
    state = tick(state, [{ kind: 'peace.propose', ...common(state, 16), offerId: 'peace:austria-germany-campaign', warId: 'war:austria-germany-campaign', recipientPolityId: 'polity:germany',
      regionTransfers: [{ regionId: 'region:gadm:DEU.2_1', toPolityId: 'polity:austria' }], reparation: null }]).state;
    state = tick(state, [{ kind: 'peace.respond', ...common(state, 17, 'polity:germany'), offerId: 'peace:austria-germany-campaign', response: 'accept' }]).state;
    const completed = tick(state, [{ kind: 'campaign.assess-legacy', ...common(state, 18), assessmentId: 'legacy:austria-campaign' }]);
    assert.equal(completed.state.military?.wars[0]?.status, 'ended');
    assert.equal(completed.state.regions.find((entry) => entry.regionId === 'region:gadm:DEU.2_1')?.controllerId, 'polity:austria');
    assert.ok(completed.state.politics!.polities.find((entry) => entry.polityId === 'polity:austria')!.legitimacyBp < 6200);
    assert.notEqual(completed.state.revision, tick(initial()).state.revision);
    assert.equal(canonicalOf(completed), canonicalOf(tick(state, [{ kind: 'campaign.assess-legacy', ...common(state, 18), assessmentId: 'legacy:austria-campaign' }])));
  });

  it('rejects malformed authored references and leaves legacy scenarios untouched', () => {
    const malformed = structuredClone(raw); malformed.campaign.goals[0].targetPolityId = 'polity:missing';
    assert.throws(() => parseScenario(malformed), /unknown id or disabled module/);
    const legacy = parseScenario(JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-4c', 'scenario.json'), 'utf8')));
    const state = initState(legacy); assert.equal(state.campaign, undefined);
    const result = tick(state, [{ kind: 'campaign.assess-legacy', ...common(state, 19), assessmentId: 'legacy:disabled' }]);
    assert.equal(result.rejections[0]?.reason, 'module-disabled'); assert.equal(result.state.campaign, undefined);
  });
});
