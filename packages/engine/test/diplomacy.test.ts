import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandId, PolityId } from '@open-historia/domain';
import type { DiplomacyCommand, EconCommand } from '../src/commands.js';
import { parseScenario } from '../src/scenario.js';
import { initState, getStock } from '../src/state.js';
import type { EconWorldState } from '../src/state.js';
import { resolveMonth } from '../src/tick.js';
import { FIXTURES_DIR } from './helpers.js';

const scenario = parseScenario(JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-6c', 'scenario.json'), 'utf8')));
const AUSTRIA = 'polity:austria' as PolityId;
const FRANCE = 'polity:france' as PolityId;
const POLAND = 'polity:poland' as PolityId;
let commandSequence = 1;
const commandId = (): CommandId => `10000000-0000-4000-8000-${String(commandSequence++).padStart(12, '0')}` as CommandId;
const common = (state: EconWorldState, actorPolityId: PolityId) => ({
  commandId: commandId(), actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month,
});

const proposeAgreement = (state: EconWorldState, proposalId = 'proposal:pact-1'): DiplomacyCommand => ({
  kind: 'diplomacy.propose', ...common(state, AUSTRIA), proposalId,
  recipientPolityId: POLAND,
  terms: { kind: 'agreement', agreementType: 'non-aggression', fromPolityId: AUSTRIA, toPolityId: POLAND },
});

const tradeCommands = (state: EconWorldState, options: { amount?: number; duration?: number; penalty?: number } = {}): DiplomacyCommand[] => {
  const amount = options.amount ?? 100;
  const duration = options.duration ?? 1;
  const proposalId = `proposal:trade-${commandSequence}`;
  return [{
    kind: 'diplomacy.propose', ...common(state, FRANCE), proposalId,
    recipientPolityId: POLAND,
    terms: {
      kind: 'trade', fromPolityId: FRANCE, toPolityId: POLAND,
      fromLeg: { kind: 'resource', resource: 'food', amount },
      toLeg: { kind: 'treasury', amount: 200 },
      cadence: duration === 1 ? 'one-off' : 'monthly', durationMonths: duration,
      earlyTerminationPenalty: options.penalty ?? 50,
    },
  }, {
    kind: 'diplomacy.respond', ...common(state, POLAND), proposalId, response: 'accept',
  }];
};

describe('P3b negotiation state machine (canon 11)', () => {
  it('proposes, counters and accepts only by the current recipient', () => {
    const state = initState(scenario);
    const proposed = resolveMonth(state, { commands: [proposeAgreement(state)] });
    assert.deepStrictEqual(proposed.rejections, []);
    assert.strictEqual(proposed.state.diplomacy?.proposals.length, 1);
    const unauthorized: DiplomacyCommand = {
      kind: 'diplomacy.respond', ...common(proposed.state, FRANCE), proposalId: 'proposal:pact-1', response: 'accept',
    };
    const rejected = resolveMonth(proposed.state, { commands: [unauthorized] });
    assert.strictEqual(rejected.rejections[0]?.reason, 'unauthorized');
    assert.strictEqual(rejected.state.diplomacy?.proposals.length, 1);

    const counter: DiplomacyCommand = {
      kind: 'diplomacy.counter', ...common(proposed.state, POLAND), proposalId: 'proposal:pact-1',
      counterProposalId: 'proposal:pact-2',
      terms: { kind: 'agreement', agreementType: 'defensive-alliance', fromPolityId: POLAND, toPolityId: AUSTRIA },
    };
    const countered = resolveMonth(proposed.state, { commands: [counter] });
    assert.strictEqual(countered.state.diplomacy?.proposals[0]?.proposalId, 'proposal:pact-2');
    assert.strictEqual(countered.state.diplomacy?.proposals[0]?.parentProposalId, 'proposal:pact-1');
    const accept: DiplomacyCommand = {
      kind: 'diplomacy.respond', ...common(countered.state, AUSTRIA), proposalId: 'proposal:pact-2', response: 'accept',
    };
    const accepted = resolveMonth(countered.state, { commands: [accept] });
    assert.deepStrictEqual(accepted.rejections, []);
    assert.strictEqual(accepted.state.diplomacy?.proposals.length, 0);
    assert.deepStrictEqual(accepted.state.diplomacy?.agreements[0], {
      agreementId: 'agreement:pact-2', sourceProposalId: 'proposal:pact-2',
      acceptedMonth: countered.state.month,
      terms: { kind: 'agreement', agreementType: 'defensive-alliance', fromPolityId: POLAND, toPolityId: AUSTRIA },
    });
  });

  it('rejects stale, unknown and mismatched references without partial mutation', () => {
    const state = initState(scenario);
    const invalid = proposeAgreement(state, 'proposal:mismatch') as Extract<DiplomacyCommand, { kind: 'diplomacy.propose' }>;
    invalid.terms = { kind: 'agreement', agreementType: 'guarantee', fromPolityId: AUSTRIA, toPolityId: FRANCE };
    const unknown: DiplomacyCommand = {
      kind: 'diplomacy.respond', ...common(state, POLAND), proposalId: 'proposal:missing', response: 'reject',
    };
    const stale = proposeAgreement(state, 'proposal:stale') as Extract<DiplomacyCommand, { kind: 'diplomacy.propose' }>;
    stale.expectedRevision = 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as typeof state.revision;
    const result = resolveMonth(state, { commands: [invalid, unknown, stale] });
    assert.deepStrictEqual(result.rejections.map((entry) => entry.reason), ['invalid-terms', 'unknown-proposal', 'stale-revision']);
    assert.deepStrictEqual(result.state.diplomacy?.proposals, []);
    assert.deepStrictEqual(result.state.diplomacy?.agreements, []);
  });
});

describe('P3b bilateral trade settlement (canon 11)', () => {
  it('accepts and settles a one-off resource-for-treasury trade before production', () => {
    const state = initState(scenario);
    const result = resolveMonth(state, { commands: tradeCommands(state) as EconCommand[] });
    assert.deepStrictEqual(result.rejections, []);
    assert.strictEqual(result.ledger.trade?.executions.length, 1);
    const execution = result.ledger.trade!.executions[0];
    assert.strictEqual(execution.fulfillmentBp, 10000);
    assert.strictEqual(execution.fromDelivered.amount, 100);
    assert.strictEqual(execution.toDelivered.amount, 200);
    assert.strictEqual(execution.breach, false);
    assert.strictEqual(result.state.trade?.contracts.length, 0);
    assert.ok(result.state.diplomacy?.agreements.some((entry) => entry.agreementId === execution.contractId));
    const france = result.ledger.polities.find((entry) => entry.polityId === FRANCE)!;
    const poland = result.ledger.polities.find((entry) => entry.polityId === POLAND)!;
    assert.strictEqual(france.treasuryTradeNet, 200);
    assert.strictEqual(poland.treasuryTradeNet, -200);
    assert.strictEqual(france.stockMovements.find((entry) => entry.resource === 'food')?.tradeOut, 100);
    assert.strictEqual(poland.stockMovements.find((entry) => entry.resource === 'food')?.tradeIn, 100);
    assert.ok(result.invariantsChecked.includes('trade-resource-conservation'));
    assert.ok(execution.fromDelivered.referenceValue > 0);
  });

  it('partially delivers a shortage, records breach and lowers trust deterministically', () => {
    const state = initState(scenario);
    const beforeTrust = state.diplomacy!.relations.find((entry) => entry.polities.includes(FRANCE) && entry.polities.includes(POLAND))!.trust;
    const first = resolveMonth(state, { commands: tradeCommands(state, { amount: 1000, duration: 2 }) as EconCommand[] });
    const execution = first.ledger.trade!.executions[0];
    assert.strictEqual(execution.fulfillmentBp, 4200);
    assert.strictEqual(execution.fromDelivered.amount, 420);
    assert.strictEqual(execution.toDelivered.amount, 84);
    assert.strictEqual(execution.breach, true);
    assert.strictEqual(first.state.trade?.contracts[0]?.remainingSettlements, 1);
    const afterTrust = first.state.diplomacy!.relations.find((entry) => entry.polities.includes(FRANCE) && entry.polities.includes(POLAND))!.trust;
    assert.strictEqual(afterTrust, beforeTrust - 500);
    const replay = resolveMonth(initState(scenario), { commands: tradeCommands(initState(scenario), { amount: 1000, duration: 2 }) as EconCommand[] });
    assert.strictEqual(replay.ledger.trade?.executions[0]?.fulfillmentBp, execution.fulfillmentBp);
  });

  it('settles a recurring contract for its exact term and replays byte-identically', () => {
    const run = () => {
      const state = initState(scenario);
      const proposalId = 'proposal:recurring-replay';
      const commands: DiplomacyCommand[] = [{
        kind: 'diplomacy.propose',
        commandId: '20000000-0000-4000-8000-000000000001' as CommandId,
        actorPolityId: FRANCE, recipientPolityId: POLAND, proposalId,
        expectedRevision: state.revision, effectiveMonth: state.month,
        terms: {
          kind: 'trade', fromPolityId: FRANCE, toPolityId: POLAND,
          fromLeg: { kind: 'resource', resource: 'wood', amount: 10 },
          toLeg: { kind: 'treasury', amount: 20 }, cadence: 'monthly', durationMonths: 2,
          earlyTerminationPenalty: 5,
        },
      }, {
        kind: 'diplomacy.respond',
        commandId: '20000000-0000-4000-8000-000000000002' as CommandId,
        actorPolityId: POLAND, proposalId, response: 'accept',
        expectedRevision: state.revision, effectiveMonth: state.month,
      }];
      const first = resolveMonth(state, { commands });
      const second = resolveMonth(first.state, { commands: [] });
      return { first, second };
    };
    const left = run();
    const right = run();
    assert.deepStrictEqual(left, right);
    assert.strictEqual(left.first.ledger.trade?.executions[0]?.fulfillmentBp, 10000);
    assert.strictEqual(left.second.ledger.trade?.executions[0]?.fulfillmentBp, 10000);
    assert.strictEqual(left.first.state.trade?.contracts[0]?.remainingSettlements, 1);
    assert.strictEqual(left.second.state.trade?.contracts.length, 0);
  });

  it('terminates a recurring contract before settlement and transfers the bounded penalty', () => {
    const state = initState(scenario);
    const accepted = resolveMonth(state, { commands: tradeCommands(state, { duration: 3, penalty: 500 }) as EconCommand[] });
    const agreementId = accepted.state.trade!.contracts[0].contractId;
    const polishOpening = accepted.state.polities.find((entry) => entry.id === POLAND)!.treasury;
    const command: DiplomacyCommand = {
      kind: 'diplomacy.terminate-agreement', ...common(accepted.state, FRANCE), agreementId,
    };
    const terminated = resolveMonth(accepted.state, { commands: [command] });
    assert.strictEqual(terminated.state.trade?.contracts.length, 0);
    assert.ok(!terminated.state.diplomacy?.agreements.some((entry) => entry.agreementId === agreementId));
    assert.deepStrictEqual(terminated.ledger.trade?.treasuryTransfers.find((entry) => entry.reason === 'termination-penalty'), {
      sourceId: agreementId, reason: 'termination-penalty', fromPolityId: FRANCE, toPolityId: POLAND, amount: 500,
    });
    assert.ok(terminated.state.polities.find((entry) => entry.id === POLAND)!.treasury >= polishOpening + 500);
  });

  it('rejects trade acceptance when no authored route connects the parties', () => {
    const state = initState(scenario);
    state.trade!.routes = state.trade!.routes.filter((entry) => !(entry.polities.includes(FRANCE) && entry.polities.includes(POLAND)));
    const result = resolveMonth(state, { commands: tradeCommands(state) as EconCommand[] });
    assert.strictEqual(result.rejections[0]?.reason, 'route-unavailable');
    assert.strictEqual(result.state.trade?.contracts.length, 0);
    assert.strictEqual(result.state.diplomacy?.proposals.length, 1, 'failed acceptance leaves the proposal actionable');
  });

  it('does not attach diplomacy state to old scenarios', () => {
    const legacy = parseScenario(JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-4c', 'scenario.json'), 'utf8')));
    const state = initState(legacy);
    assert.strictEqual(state.diplomacy, undefined);
    assert.strictEqual(state.trade, undefined);
    const command = proposeAgreement(state);
    const result = resolveMonth(state, { commands: [command] });
    assert.strictEqual(result.rejections[0]?.reason, 'module-disabled');
    assert.strictEqual(result.state.diplomacy, undefined);
    assert.strictEqual(result.state.trade, undefined);
    assert.strictEqual(getStock(result.state.polities[0], 'food') >= 0, true);
  });
});
