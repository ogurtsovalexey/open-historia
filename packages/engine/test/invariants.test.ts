import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { CommandId, PolityId, RegionId } from '@open-historia/domain';
import { EMPTY_TURN_COMMANDS } from '../src/commands.js';
import type { TurnCommandsFile } from '../src/commands.js';
import { checkInvariants } from '../src/ledger.js';
import { resolveMonth } from '../src/tick.js';
import { loadInitialState } from './helpers.js';

const OSTREYA = 'polity:ostreya' as PolityId;

/** §10 identities hold after every month across a grid of spend values. */
describe('invariants (first-economy-mvp §10)', () => {
  const spendGrid = [0, 1, 137, 1000, 4999];

  for (const spend of spendGrid) {
    it(`hold for 12 months with monthly Ostreya investment of ${spend}`, () => {
      let state = loadInitialState();
      for (let month = 0; month < 12; month += 1) {
        const commands: TurnCommandsFile =
          spend === 0
            ? EMPTY_TURN_COMMANDS
            : {
                commands: [
                  {
                    kind: 'economy.invest-region',
                    commandId: '6a1f5c1e-0d2b-4d3a-9a51-00000000aaaa' as CommandId,
                    actorPolityId: OSTREYA,
                    targetRegionId: 'region:dev-2x5:A4' as RegionId,
                    effectiveMonth: state.month,
                    spend,
                  },
                ],
              };
        // resolveMonth itself runs checkInvariants and throws on violation.
        const result = resolveMonth(state, commands);
        assert.ok(result.invariantsChecked.length >= 6);
        state = result.state;
      }
      assert.strictEqual(state.turn, 12);
      assert.strictEqual(state.month, '1901-01-01');
    });
  }

  it('checkInvariants rejects a doctored ledger (treasury identity)', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const doctored = structuredClone(result.ledger);
    doctored.polities[0].taxTotal += 1;
    assert.throws(() => checkInvariants(initial, result.state, doctored), /treasury-identity/);
  });

  it('checkInvariants rejects a doctored next state (population aggregation)', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const doctored = structuredClone(result.state);
    doctored.regions[0].population += 1;
    assert.throws(() => checkInvariants(initial, doctored, result.ledger), /population/);
  });
});
