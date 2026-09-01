import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  initState, parseScenario, parseTurnCommands, resolveMonth, stateChecksum,
  type EconWorldState,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(resolve(here, '../../fixtures/scenario-dev-map-6c/scenario.json'), 'utf8'));
const scenario = parseScenario(raw);
const initial = () => initState(scenario);
const id = (suffix: number) => `60000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const common = (state: EconWorldState, actorPolityId: string, suffix: number) => ({
  commandId: id(suffix), actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month,
});
const tick = (state: EconWorldState, commands: unknown[] = []) => resolveMonth(state, parseTurnCommands({ commands }));
const rehash = (state: EconWorldState): EconWorldState => {
  const draft = { ...state, revision: 'pending' as EconWorldState['revision'] };
  return { ...draft, revision: stateChecksum(draft) as EconWorldState['revision'] };
};

describe('P5 war, occupation and peace (canon 14)', () => {
  it('derives population-bounded manpower and conserved authored equipment', () => {
    const state = initial();
    assert.equal(state.military?.polities.length, 6);
    assert.equal(state.military?.formations.length, 6);
    for (const polity of state.military!.polities) {
      const fielded: number = state.military!.formations.filter((entry) => entry.polityId === polity.polityId).reduce((sum, entry) => sum + entry.manpower, 0);
      assert.equal(polity.manpowerPool + fielded + polity.casualties, polity.manpowerCeiling);
      assert.equal(polity.mobilized, fielded);
    }
  });

  it('mobilizes with delay and split/merge/demobilize conserve forces exactly', () => {
    const start = initial();
    const mobilized = tick(start, [{ kind: 'military.mobilize', ...common(start, 'polity:austria', 1),
      formationId: 'formation:austria-reserve-test', locationRegionId: 'region:gadm:AUT.5_1',
      manpower: 4000, equipment: 3500, commanderId: null }]);
    assert.equal(mobilized.state.military?.formations.find((entry) => entry.formationId === 'formation:austria-reserve-test')?.status, 'mobilizing');
    const reorganized = tick(mobilized.state, [
      { kind: 'military.split', ...common(mobilized.state, 'polity:austria', 2), sourceFormationId: 'formation:austria-reserve-test',
        newFormationId: 'formation:austria-reserve-detachment', manpower: 1000, equipment: 800 },
      { kind: 'military.merge', ...common(mobilized.state, 'polity:austria', 3), primaryFormationId: 'formation:austria-reserve-test',
        secondaryFormationId: 'formation:austria-reserve-detachment' },
      { kind: 'military.demobilize', ...common(mobilized.state, 'polity:austria', 4), formationId: 'formation:austria-reserve-test' },
    ]);
    assert.equal(reorganized.rejections.length, 0);
    assert.equal(reorganized.state.military?.formations.find((entry) => entry.formationId === 'formation:austria-reserve-test')?.status, 'demobilized');
    const row = reorganized.state.military!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    assert.equal(row.manpowerPool + row.mobilized + row.casualties, row.manpowerCeiling);
    assert.equal(row.equipmentReserve + reorganized.state.military!.formations.filter((entry) => entry.polityId === row.polityId && ['active', 'mobilizing'].includes(entry.status)).reduce((sum, entry) => sum + entry.equipment, 0) + row.equipmentLost, row.equipmentTotal);
  });

  it('records reasonless-war diplomatic and political penalties', () => {
    const start = initial();
    const beforeRelation = start.diplomacy!.relations.find((entry) => entry.polities.map(String).includes('polity:austria') && entry.polities.map(String).includes('polity:france'))!;
    const beforePolitics = start.politics!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    const result = tick(start, [{ kind: 'war.declare', ...common(start, 'polity:austria', 5), warId: 'war:austria-germany-test', defenderPolityId: 'polity:germany', reason: 'none' }]);
    const relation = result.state.diplomacy!.relations.find((entry) => entry.polities.map(String).includes('polity:austria') && entry.polities.map(String).includes('polity:france'))!;
    const politics = result.state.politics!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    assert.equal(relation.trust, beforeRelation.trust - 1500);
    assert.ok(relation.threat > beforeRelation.threat);
    assert.ok(politics.legitimacyBp < beforePolitics.legitimacyBp);
    assert.ok(result.events.some((entry) => entry.type === 'war-declared' && entry.reason === 'none'));
  });

  it('supplied aggregate combat is stronger, deterministic and creates occupation without ownership', () => {
    const start = initial();
    const prepare = (state: EconWorldState) => tick(state, [
      { kind: 'war.declare', ...common(state, 'polity:austria', 6), warId: 'war:austria-germany-battle', defenderPolityId: 'polity:germany', reason: 'claim' },
      { kind: 'military.mobilize', ...common(state, 'polity:austria', 7), formationId: 'formation:austria-battle-reserve',
        locationRegionId: 'region:gadm:AUT.5_1', manpower: 8000, equipment: 8000, commanderId: null },
    ]).state;
    const prepared = prepare(start);
    const commands = (state: EconWorldState) => [
      { kind: 'military.order', ...common(state, 'polity:austria', 8), formationId: 'formation:austria-first', posture: 'advance', targetRegionId: 'region:gadm:DEU.2_1' },
      { kind: 'military.order', ...common(state, 'polity:austria', 9), formationId: 'formation:austria-battle-reserve', posture: 'advance', targetRegionId: 'region:gadm:DEU.2_1' },
    ];
    const supplied = tick(prepared, commands(prepared));
    const repeat = tick(prepared, commands(prepared));
    assert.deepEqual(supplied, repeat);
    const combat = supplied.ledger.military!.combats[0]!;
    assert.equal(combat.outcome, 'occupied');
    assert.equal(combat.attackerSupplyBp, 8571);
    assert.match(combat.seedKey, /^193801\|1938-02-01\|war:/);
    const region = supplied.state.regions.find((entry) => entry.regionId === 'region:gadm:DEU.2_1')!;
    assert.equal(region.controllerId, 'polity:germany');
    assert.equal(supplied.state.military?.occupations.find((entry) => entry.regionId === region.regionId)?.actualControllerId, 'polity:austria');

    const lowSupply = structuredClone(prepared);
    lowSupply.military!.supplyLinks.find((entry) => entry.regions.map(String).includes('region:gadm:AUT.5_1') && entry.regions.map(String).includes('region:gadm:DEU.2_1'))!.capacity = 2000;
    const lowState = rehash(lowSupply);
    const underSupplied = tick(lowState, commands(lowState));
    assert.ok(combat.attackerPower > underSupplied.ledger.military!.combats[0]!.attackerPower);
    const withdrawn = tick(supplied.state, [{ kind: 'military.order', ...common(supplied.state, 'polity:austria', 19),
      formationId: 'formation:austria-first', posture: 'withdraw', targetRegionId: null }]);
    assert.equal(withdrawn.state.military?.formations.find((entry) => entry.formationId === 'formation:austria-first')?.locationRegionId, 'region:gadm:AUT.5_1');
  });

  it('accepts occupied-region peace and re-aggregates legal ownership and reparations atomically', () => {
    let state = initial();
    state = tick(state, [
      { kind: 'war.declare', ...common(state, 'polity:austria', 10), warId: 'war:austria-germany-peace', defenderPolityId: 'polity:germany', reason: 'claim' },
      { kind: 'military.mobilize', ...common(state, 'polity:austria', 11), formationId: 'formation:austria-peace-reserve', locationRegionId: 'region:gadm:AUT.5_1', manpower: 8000, equipment: 8000, commanderId: null },
    ]).state;
    state = tick(state, [
      { kind: 'military.order', ...common(state, 'polity:austria', 12), formationId: 'formation:austria-first', posture: 'advance', targetRegionId: 'region:gadm:DEU.2_1' },
      { kind: 'military.order', ...common(state, 'polity:austria', 13), formationId: 'formation:austria-peace-reserve', posture: 'advance', targetRegionId: 'region:gadm:DEU.2_1' },
    ]).state;
    const offered = tick(state, [{ kind: 'peace.propose', ...common(state, 'polity:austria', 14), offerId: 'peace:austria-germany-test',
      warId: 'war:austria-germany-peace', recipientPolityId: 'polity:germany',
      regionTransfers: [{ regionId: 'region:gadm:DEU.2_1', toPolityId: 'polity:austria' }],
      reparation: { fromPolityId: 'polity:germany', toPolityId: 'polity:austria', amount: 100 } }]);
    const germanyBefore = offered.state.polities.find((entry) => entry.id === 'polity:germany')!.treasury;
    const occupationLost = structuredClone(offered.state);
    occupationLost.military!.occupations = [];
    const staleTermsState = rehash(occupationLost);
    const staleTerms = tick(staleTermsState, [{ kind: 'peace.respond', ...common(staleTermsState, 'polity:germany', 20), offerId: 'peace:austria-germany-test', response: 'accept' }]);
    assert.equal(staleTerms.rejections[0]?.reason, 'illegal-peace-term');
    assert.equal(staleTerms.state.regions.find((entry) => entry.regionId === 'region:gadm:DEU.2_1')?.controllerId, 'polity:germany');
    const accepted = tick(offered.state, [{ kind: 'peace.respond', ...common(offered.state, 'polity:germany', 15), offerId: 'peace:austria-germany-test', response: 'accept' }]);
    assert.equal(accepted.rejections.length, 0);
    assert.equal(accepted.state.regions.find((entry) => entry.regionId === 'region:gadm:DEU.2_1')?.controllerId, 'polity:austria');
    assert.equal(accepted.state.military?.occupations.length, 0);
    assert.equal(accepted.state.military?.wars.find((entry) => entry.warId === 'war:austria-germany-peace')?.status, 'ended');
    assert.equal(accepted.state.polities.find((entry) => entry.id === 'polity:germany')!.treasury, germanyBefore - 100 + accepted.ledger.polities.find((entry) => entry.polityId === 'polity:germany')!.taxTotal
      - (accepted.ledger.polities.find((entry) => entry.polityId === 'polity:germany')!.finance?.interestPaid ?? 0));
    assert.ok(accepted.ledger.transfers.some((entry) => entry.regionId === 'region:gadm:DEU.2_1'));
  });

  it('rejects stale, disconnected, foreign and illegal peace paths without partial mutation', () => {
    const state = initial();
    const result = tick(state, [
      { kind: 'military.order', ...common(state, 'polity:austria', 16), formationId: 'formation:missing', posture: 'advance', targetRegionId: 'region:gadm:DEU.2_1' },
      { kind: 'military.order', ...common(state, 'polity:austria', 17), formationId: 'formation:austria-first', posture: 'advance', targetRegionId: 'region:gadm:FRA.1_1' },
      { kind: 'war.declare', ...common(state, 'polity:austria', 18), expectedRevision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', warId: 'war:stale', defenderPolityId: 'polity:germany', reason: 'claim' },
    ]);
    assert.deepEqual(result.rejections.map((entry) => entry.reason), ['unknown-formation', 'disconnected-front', 'stale-revision']);
    assert.equal(result.state.military?.wars.length, 0);
  });

  it('rejects war against an active non-aggression or defensive partner', () => {
    let state = initial();
    state = tick(state, [{ kind: 'diplomacy.propose', ...common(state, 'polity:austria', 21), proposalId: 'proposal:austria-germany-pact',
      recipientPolityId: 'polity:germany', terms: { kind: 'agreement', agreementType: 'defensive-alliance',
        fromPolityId: 'polity:austria', toPolityId: 'polity:germany' } }]).state;
    state = tick(state, [{ kind: 'diplomacy.respond', ...common(state, 'polity:germany', 22), proposalId: 'proposal:austria-germany-pact', response: 'accept' }]).state;
    const result = tick(state, [{ kind: 'war.declare', ...common(state, 'polity:austria', 23), warId: 'war:forbidden-alliance',
      defenderPolityId: 'polity:germany', reason: 'rivalry' }]);
    assert.equal(result.rejections[0]?.reason, 'invalid-target');
    assert.equal(result.state.military?.wars.length, 0);
  });
});
