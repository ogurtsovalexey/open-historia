import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { initState, parseScenario, parseTurnCommands, parseWorldState, resolveMonth, stateChecksum, type EconWorldState } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = parseScenario(JSON.parse(readFileSync(resolve(here, '../../fixtures/scenario-dev-map-6c/scenario.json'), 'utf8')));
const id = (suffix: number) => `81000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const common = (state: EconWorldState, actorPolityId: string, suffix: number) => ({
  commandId: id(suffix), actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month,
});
const tick = (state: EconWorldState, commands: unknown[] = []) => resolveMonth(state, parseTurnCommands({ commands }));
const relation = (state: EconWorldState, left: string, right: string) => state.diplomacy!.relations.find((entry) =>
  entry.polities.includes(left as never) && entry.polities.includes(right as never))!;
const agree = (state: EconWorldState, from: string, to: string, type: 'defensive-alliance' | 'guarantee', suffix: number) => {
  const proposalId = `proposal:p8-${type}-${suffix}`;
  state = tick(state, [{ kind: 'diplomacy.propose', ...common(state, from, suffix), proposalId, recipientPolityId: to,
    terms: { kind: 'agreement', agreementType: type, fromPolityId: from, toPolityId: to } }]).state;
  return tick(state, [{ kind: 'diplomacy.respond', ...common(state, to, suffix + 1), proposalId, response: 'accept' }]).state;
};

const withStartingAlliance = () => {
  const raw = JSON.parse(readFileSync(resolve(here, '../../fixtures/scenario-dev-map-6c/scenario.json'), 'utf8'));
  raw.diplomacy.startingAgreements = [{
    agreementId: 'agreement:authored-austria-france',
    sourceProposalId: 'proposal:authored-austria-france',
    acceptedMonth: '1934-01-01',
    terms: {
      kind: 'agreement', agreementType: 'defensive-alliance',
      fromPolityId: 'polity:austria', toPolityId: 'polity:france',
    },
  }];
  return parseScenario(raw);
};

describe('P8 executable alliance obligations (canon 17)', () => {
  it('materialises an in-force scenario agreement before the first decision', () => {
    const initial = initState(withStartingAlliance());
    assert.deepEqual(initial.diplomacy?.agreements, [{
      agreementId: 'agreement:authored-austria-france',
      sourceProposalId: 'proposal:authored-austria-france',
      acceptedMonth: '1934-01-01',
      terms: {
        kind: 'agreement', agreementType: 'defensive-alliance',
        fromPolityId: 'polity:austria', toPolityId: 'polity:france',
      },
    }]);
    const declared = tick(initial, [{ kind: 'war.declare', ...common(initial, 'polity:germany', 30),
      warId: 'war:p8-authored-alliance', defenderPolityId: 'polity:austria', reason: 'rivalry' }]);
    assert.deepEqual(declared.state.military?.callsToArms?.map((entry) => ({
      calledPolityId: entry.calledPolityId,
      beneficiaryPolityId: entry.beneficiaryPolityId,
      sourceAgreementIds: entry.sourceAgreementIds,
    })), [{
      calledPolityId: 'polity:france', beneficiaryPolityId: 'polity:austria',
      sourceAgreementIds: ['agreement:authored-austria-france'],
    }]);
  });

  it('rejects future, duplicate and unknown-party starting agreements', () => {
    const raw = JSON.parse(readFileSync(resolve(here, '../../fixtures/scenario-dev-map-6c/scenario.json'), 'utf8'));
    const agreement = {
      agreementId: 'agreement:authored-invalid', sourceProposalId: 'proposal:authored-invalid',
      acceptedMonth: '1936-01-01', terms: { kind: 'agreement', agreementType: 'guarantee',
        fromPolityId: 'polity:france', toPolityId: 'polity:unknown' },
    };
    raw.diplomacy.startingAgreements = [agreement, { ...agreement }];
    assert.throws(() => parseScenario(raw), /starting agreement parties|starting agreement cannot postdate|duplicate starting agreement/);
  });

  it('reads a pre-P8 military state and writes the optional collection on its next tick', () => {
    const legacy = structuredClone(initState(scenario));
    delete legacy.military!.callsToArms;
    legacy.revision = 'pending' as EconWorldState['revision'];
    legacy.revision = stateChecksum(legacy) as EconWorldState['revision'];
    const parsed = parseWorldState(legacy);
    assert.equal(parsed.military!.callsToArms, undefined);
    assert.deepEqual(tick(parsed).state.military!.callsToArms, []);
  });

  it('creates one reciprocal defensive call and acceptance joins the existing defenders deterministically', () => {
    const state = agree(initState(scenario), 'polity:austria', 'polity:france', 'defensive-alliance', 1);
    const declared = tick(state, [{ kind: 'war.declare', ...common(state, 'polity:germany', 3),
      warId: 'war:p8-alliance', defenderPolityId: 'polity:austria', reason: 'rivalry' }]);
    const call = declared.state.military!.callsToArms![0]!;
    assert.match(call.callId, /^call:p8-alliance-[a-f0-9]{16}$/);
    assert.deepEqual({ ...call, callId: '<stable>' }, { callId: '<stable>', warId: 'war:p8-alliance',
      beneficiaryPolityId: 'polity:austria', calledPolityId: 'polity:france',
      sourceAgreementIds: ['agreement:p8-defensive-alliance-1'], status: 'pending',
      createdMonth: state.month, resolvedMonth: null });
    const accepted = tick(declared.state, [{ kind: 'war.respond-call', ...common(declared.state, 'polity:france', 4),
      callId: call.callId, response: 'accept' }]);
    assert.deepEqual(accepted.state.military!.wars[0]!.defenders, ['polity:austria', 'polity:france']);
    assert.equal(accepted.state.military!.callsToArms![0]!.status, 'accepted');
    const allyPeace = tick(accepted.state, [{ kind: 'peace.propose', ...common(accepted.state, 'polity:france', 5),
      offerId: 'peace:p8-ally-cannot-end-war', warId: 'war:p8-alliance', recipientPolityId: 'polity:germany',
      regionTransfers: [], reparation: null }]);
    assert.equal(allyPeace.rejections[0]?.reason, 'unauthorized');
    assert.equal(allyPeace.state.military!.wars[0]!.status, 'active');
    assert.deepEqual(tick(declared.state, [{ kind: 'war.respond-call', ...common(declared.state, 'polity:france', 4),
      callId: call.callId, response: 'accept' }]), accepted);
  });

  it('respects guarantee direction, scopes refusal trust damage, and rejects foreign or stale responses', () => {
    let state = agree(initState(scenario), 'polity:france', 'polity:austria', 'guarantee', 10);
    const unrelated = tick(state, [{ kind: 'war.declare', ...common(state, 'polity:germany', 12),
      warId: 'war:p8-wrong-direction', defenderPolityId: 'polity:france', reason: 'claim' }]);
    assert.equal(unrelated.state.military!.callsToArms!.length, 0);
    state = tick(unrelated.state, [{ kind: 'peace.propose', ...common(unrelated.state, 'polity:germany', 13), offerId: 'peace:p8-wrong-direction',
      warId: 'war:p8-wrong-direction', recipientPolityId: 'polity:france', regionTransfers: [], reparation: null }]).state;
    state = tick(state, [{ kind: 'peace.respond', ...common(state, 'polity:france', 14), offerId: 'peace:p8-wrong-direction', response: 'accept' }]).state;
    const beforeBeneficiary = relation(state, 'polity:france', 'polity:austria').trust;
    const beforeOther = relation(state, 'polity:france', 'polity:poland').trust;
    const declared = tick(state, [{ kind: 'war.declare', ...common(state, 'polity:germany', 15),
      warId: 'war:p8-guarantee', defenderPolityId: 'polity:austria', reason: 'claim' }]);
    const call = declared.state.military!.callsToArms![0]!;
    assert.equal(call.calledPolityId, 'polity:france');
    const foreign = tick(declared.state, [{ kind: 'war.respond-call', ...common(declared.state, 'polity:poland', 16), callId: call.callId, response: 'accept' }]);
    assert.equal(foreign.rejections[0]?.reason, 'unauthorized');
    const refused = tick(declared.state, [{ kind: 'war.respond-call', ...common(declared.state, 'polity:france', 17), callId: call.callId, response: 'refuse' }]);
    assert.equal(relation(refused.state, 'polity:france', 'polity:austria').trust, beforeBeneficiary - 1000);
    assert.equal(relation(refused.state, 'polity:france', 'polity:poland').trust, beforeOther);
    const stale = tick(refused.state, [{ kind: 'war.respond-call', ...common(refused.state, 'polity:france', 18), callId: call.callId, response: 'accept' }]);
    assert.equal(stale.rejections[0]?.reason, 'invalid-target');
  });

  it('expires unanswered calls when peace ends the war', () => {
    let state = agree(initState(scenario), 'polity:austria', 'polity:france', 'defensive-alliance', 20);
    state = tick(state, [{ kind: 'war.declare', ...common(state, 'polity:germany', 22), warId: 'war:p8-expiry', defenderPolityId: 'polity:austria', reason: 'claim' }]).state;
    state = tick(state, [{ kind: 'peace.propose', ...common(state, 'polity:germany', 23), offerId: 'peace:p8-expiry', warId: 'war:p8-expiry',
      recipientPolityId: 'polity:austria', regionTransfers: [], reparation: null }]).state;
    const ended = tick(state, [{ kind: 'peace.respond', ...common(state, 'polity:austria', 24), offerId: 'peace:p8-expiry', response: 'accept' }]);
    assert.equal(ended.state.military!.callsToArms![0]!.status, 'expired');
    assert.ok(ended.events.some((entry) => entry.type === 'call-to-arms-resolved' && entry.response === 'expired'));
  });
});
