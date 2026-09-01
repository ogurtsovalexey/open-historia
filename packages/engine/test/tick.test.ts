import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { CommandId, PolityId, RegionId } from '@open-historia/domain';
import { EMPTY_TURN_COMMANDS } from '../src/commands.js';
import type { EconCommand } from '../src/commands.js';
import { potentialOutput, resolveMonth } from '../src/tick.js';
import { canonicalState, stateChecksum } from '../src/canonical.js';
import { getStock } from '../src/state.js';
import type { EconWorldState } from '../src/state.js';
import { loadInitialState } from './helpers.js';

const OSTREYA = 'polity:ostreya' as PolityId;
const VINDAR = 'polity:vindar' as PolityId;

function region(state: EconWorldState, suffix: string) {
  const found = state.regions.find((r) => r.regionId.endsWith(`:${suffix}`));
  assert.ok(found, `region ${suffix} exists`);
  return found;
}

function polityLedger(result: ReturnType<typeof resolveMonth>, id: PolityId) {
  const entry = result.ledger.polities.find((p) => p.polityId === id);
  assert.ok(entry, `ledger for ${id}`);
  return entry;
}

describe('monthly tick — hand-checked fixture numbers (see fixtures/scenario-dev-2x5/NUMBERS.md)', () => {
  it('resolves month 1 without commands to the hand-computed values', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const next = result.state;

    // Demography with remainder carry.
    const a4 = region(next, 'A4');
    assert.strictEqual(a4.population, 250104);
    assert.strictEqual(a4.birthRemainder, 20000);
    assert.strictEqual(a4.deathRemainder, 0);
    assert.strictEqual(region(next, 'A1').population, 900825);
    assert.strictEqual(region(next, 'B3').population, 260076);

    // Production incl. infrastructure and damage factors.
    const ostreya = polityLedger(result, OSTREYA);
    const production = new Map(ostreya.production.map((p) => [p.resource, p.total]));
    assert.strictEqual(production.get('food'), 170000);
    assert.strictEqual(production.get('wood'), 10000);
    assert.strictEqual(production.get('coal'), 4800); // 15000 ×4000bp ×(10000-2000)bp
    assert.strictEqual(production.get('goods'), 40); // iron-limited

    // Goods chain: potential 5600, iron limits at 40, exact deduction.
    assert.ok(ostreya.goods);
    assert.strictEqual(ostreya.goods.potential, 5600);
    assert.strictEqual(ostreya.goods.actual, 40);
    assert.deepStrictEqual(ostreya.goods.limitingInputs, ['iron']);
    assert.strictEqual(ostreya.goods.limitedBy, 'inputs');
    const nextOstreya = next.polities.find((p) => p.id === OSTREYA)!;
    assert.strictEqual(getStock(nextOstreya, 'iron'), 0);
    assert.strictEqual(getStock(nextOstreya, 'coal'), 4810);
    assert.strictEqual(getStock(nextOstreya, 'goods'), 50);

    // Vindar goods are capacity-limited, not input-limited.
    const vindar = polityLedger(result, VINDAR);
    assert.ok(vindar.goods);
    assert.strictEqual(vindar.goods.potential, 7200);
    assert.strictEqual(vindar.goods.actual, 7200);
    assert.deepStrictEqual(vindar.goods.limitingInputs, []);
    assert.strictEqual(vindar.goods.limitedBy, 'capacity');
    assert.strictEqual(vindar.goods.inputSupplyBp, 10000);

    // Food: Ostreya surplus, Vindar shortfall floored at zero stock.
    assert.strictEqual(ostreya.food.need, 122589);
    assert.strictEqual(ostreya.food.surplus, 47611);
    assert.strictEqual(vindar.food.need, 68026);
    assert.strictEqual(vindar.food.shortfall, 12926);
    const nextVindar = next.polities.find((p) => p.id === VINDAR)!;
    assert.strictEqual(getStock(nextVindar, 'food'), 0);

    // Tax and treasury.
    assert.strictEqual(ostreya.taxTotal, 17388);
    assert.strictEqual(ostreya.treasuryClosing, 22388);
    assert.strictEqual(vindar.taxTotal, 25719);
    assert.strictEqual(vindar.treasuryClosing, 33719);

    // Turn bookkeeping.
    assert.strictEqual(next.turn, 1);
    assert.strictEqual(next.month, '1900-02-01');
    assert.ok(result.invariantsChecked.includes('treasury-identity'));
  });

  it('is pure: the input state is not mutated', () => {
    const initial = loadInitialState();
    const before = canonicalState(initial);
    resolveMonth(initial, EMPTY_TURN_COMMANDS);
    assert.strictEqual(canonicalState(initial), before);
  });

  it('carries division remainders across three months', () => {
    let state = loadInitialState();
    let births = 0;
    for (let month = 0; month < 3; month += 1) {
      const result = resolveMonth(state, EMPTY_TURN_COMMANDS);
      const row = polityLedger(result, OSTREYA).populationByRegion.find((r) => r.regionId.endsWith(':A4'))!;
      births += row.births;
      state = result.state;
    }
    // Total births over 3 months must equal the floor of the exact running sum:
    // month sums with carry — verify against a direct reconstruction.
    let pop = 250104 - 604 + 500; // reconstruct opening population
    assert.strictEqual(pop, 250000);
    let carry = 0;
    let expected = 0;
    let deathCarry = 0;
    for (let month = 0; month < 3; month += 1) {
      const birthNumerator = pop * 290 + carry;
      const b = Math.floor(birthNumerator / 120000);
      carry = birthNumerator - b * 120000;
      const deathNumerator = pop * 240 + deathCarry;
      const d = Math.floor(deathNumerator / 120000);
      deathCarry = deathNumerator - d * 120000;
      pop = pop + b - d;
      expected += b;
    }
    assert.strictEqual(births, expected);
    assert.strictEqual(region(state, 'A4').population, pop);
  });
});

describe('multi-activity production allocation', () => {
  const allocatedState = () => {
    const state = loadInitialState();
    const regions = state.regions.map((entry) => entry.regionId.endsWith(':A1') ? {
      ...entry, activity: undefined,
      activities: [
        { activity: { kind: 'extraction' as const, resource: 'food' as const }, allocationBp: 5000 },
        { activity: { kind: 'extraction' as const, resource: 'coal' as const }, allocationBp: 5000 },
      ],
    } : entry).map((entry) => {
      const { activity, ...rest } = entry;
      return activity === undefined ? rest : entry;
    }) as EconWorldState['regions'];
    const draft = { ...state, regions, revision: 'pending' as EconWorldState['revision'] };
    return { ...draft, revision: stateChecksum(draft) as EconWorldState['revision'] };
  };

  it('splits one regional capacity across authored activities and conserves the old schema', () => {
    const legacy = loadInitialState();
    assert.ok(legacy.regions.every((entry) => entry.activity !== undefined && entry.activities === undefined));
    const result = resolveMonth(allocatedState(), EMPTY_TURN_COMMANDS);
    const ledger = polityLedger(result, OSTREYA);
    const food = ledger.production.find((entry) => entry.resource === 'food')?.byRegion.find((entry) => entry.regionId.endsWith(':A1'))?.amount ?? 0;
    const coal = ledger.production.find((entry) => entry.resource === 'coal')?.byRegion.find((entry) => entry.regionId.endsWith(':A1'))?.amount ?? 0;
    assert.equal(food, coal);
    assert.ok(food > 0);
  });

  it('reallocates only among the authored catalog and rejects stale or invented activities', () => {
    const state = allocatedState();
    const base = { kind: 'economy.reallocate-production' as const, commandId: '91000000-0000-4000-8000-000000000001' as CommandId,
      actorPolityId: OSTREYA, targetRegionId: state.regions.find((entry) => entry.regionId.endsWith(':A1'))!.regionId,
      expectedRevision: state.revision, effectiveMonth: state.month };
    const accepted = resolveMonth(state, { commands: [{ ...base, allocations: [
      { activity: { kind: 'extraction', resource: 'food' }, allocationBp: 2500 },
      { activity: { kind: 'extraction', resource: 'coal' }, allocationBp: 7500 },
    ] } as EconCommand] });
    assert.equal(accepted.rejections.length, 0);
    assert.deepEqual(accepted.state.regions.find((entry) => entry.regionId === base.targetRegionId)?.activities?.map((entry) => entry.allocationBp), [2500, 7500]);
    const invented = resolveMonth(state, { commands: [{ ...base, commandId: '91000000-0000-4000-8000-000000000002' as CommandId, allocations: [
      { activity: { kind: 'extraction', resource: 'food' }, allocationBp: 2500 },
      { activity: { kind: 'extraction', resource: 'iron' }, allocationBp: 7500 },
    ] } as EconCommand] });
    assert.equal(invented.rejections[0]?.reason, 'invalid-allocation');
  });
});

describe('monthly tick — command acceptance', () => {
  function investCommand(overrides: Partial<EconCommand> = {}): EconCommand {
    return {
      kind: 'economy.invest-region',
      commandId: '6a1f5c1e-0d2b-4d3a-9a51-00000000ffff',
      actorPolityId: OSTREYA,
      targetRegionId: 'region:dev-2x5:A4' as RegionId,
      effectiveMonth: '1900-01-01',
      spend: 1000,
      ...overrides,
    } as EconCommand;
  }

  it('accepted investment: treasury down, infrastructure up before production', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, { commands: [investCommand()] });
    const ostreya = polityLedger(result, OSTREYA);
    assert.ok(ostreya.investment);
    assert.strictEqual(ostreya.investment.infrastructureGainBp, 1000);
    assert.strictEqual(region(result.state, 'A4').infrastructureBp, 5000);
    // Production uses the improved infrastructure the same month: 15000×5000bp×8000bp = 6000.
    const production = new Map(ostreya.production.map((p) => [p.resource, p.total]));
    assert.strictEqual(production.get('coal'), 6000);
    // Treasury: 5000 - 1000 + tax (tax includes the improved coal output: 6000×3×1200bp = 2160).
    assert.strictEqual(ostreya.treasuryClosing, 5000 - 1000 + 17388 - 1728 + 2160);
    assert.strictEqual(result.rejections.length, 0);
  });

  it('infrastructure clamps at 10000 bp and only the clamped gain is recorded', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, {
      commands: [investCommand({ targetRegionId: 'region:dev-2x5:A1' as RegionId, spend: 4900 })],
    });
    const ostreya = polityLedger(result, OSTREYA);
    assert.strictEqual(region(result.state, 'A1').infrastructureBp, 10000);
    assert.strictEqual(ostreya.investment!.infrastructureGainBp, 4000);
  });

  const rejectionCases: Array<{ name: string; command: EconCommand; reason: string }> = [
    { name: 'foreign target', command: investCommand({ actorPolityId: VINDAR }), reason: 'foreign-target' },
    { name: 'unknown region', command: investCommand({ targetRegionId: 'region:dev-2x5:Z9' as RegionId }), reason: 'unknown-region' },
    { name: 'unknown actor', command: investCommand({ actorPolityId: 'polity:nobody' as PolityId }), reason: 'unknown-actor' },
    { name: 'wrong month', command: investCommand({ effectiveMonth: '1900-03-01' }), reason: 'wrong-month' },
    { name: 'zero spend', command: investCommand({ spend: 0 }), reason: 'invalid-amount' },
    { name: 'negative spend', command: investCommand({ spend: -5 }), reason: 'invalid-amount' },
    { name: 'insufficient treasury', command: investCommand({ spend: 999999 }), reason: 'insufficient-treasury' },
  ];

  for (const testCase of rejectionCases) {
    it(`rejects ${testCase.name} and resolves the month exactly as with no commands`, () => {
      const initial = loadInitialState();
      const withCommand = resolveMonth(initial, { commands: [testCase.command] });
      const withoutCommand = resolveMonth(initial, EMPTY_TURN_COMMANDS);
      assert.strictEqual(withCommand.rejections.length, 1);
      assert.strictEqual(withCommand.rejections[0].reason, testCase.reason);
      assert.strictEqual(withCommand.state.revision, withoutCommand.state.revision);
    });
  }

  it('rejects a stale expectedRevision', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, {
      commands: [investCommand({ expectedRevision: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as EconCommand['expectedRevision'] })],
    });
    assert.strictEqual(result.rejections[0].reason, 'stale-revision');
  });

  it('accepts a matching expectedRevision', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, {
      commands: [investCommand({ expectedRevision: initial.revision })],
    });
    assert.strictEqual(result.rejections.length, 0);
  });

  it('accepts at most one investment per polity per month', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, {
      commands: [investCommand({ spend: 100 }), investCommand({ spend: 200, commandId: '6a1f5c1e-0d2b-4d3a-9a51-00000000fffe' as CommandId })],
    });
    assert.strictEqual(result.rejections.length, 1);
    assert.strictEqual(result.rejections[0].reason, 'command-limit');
    assert.strictEqual(polityLedger(result, OSTREYA).investment!.spend, 100);
  });
});

describe('monthly tick — goods edge cases (rre §7)', () => {
  it('a goods region with no iron keeps capacity but produces zero once stock is drained', () => {
    // After month 1 Ostreya has iron 0 and no iron extraction: month 2 goods must be 0.
    let state = loadInitialState();
    state = resolveMonth(state, EMPTY_TURN_COMMANDS).state;
    const result = resolveMonth(state, EMPTY_TURN_COMMANDS);
    const ostreya = polityLedger(result, OSTREYA);
    assert.ok(ostreya.goods);
    assert.ok(ostreya.goods.potential > 0, 'capacity is intact');
    assert.strictEqual(ostreya.goods.actual, 0);
    assert.deepStrictEqual(ostreya.goods.limitingInputs, ['iron']);
    assert.strictEqual(ostreya.goods.inputSupplyBp, 0);
    // No inputs consumed when nothing is produced.
    const coal = ostreya.stockMovements.find((m) => m.resource === 'coal')!;
    assert.strictEqual(coal.processingUse, 0);
  });

  it('partial input availability caps output and deducts exactly the inputs used', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const ostreya = polityLedger(result, OSTREYA);
    const iron = ostreya.stockMovements.find((m) => m.resource === 'iron')!;
    assert.strictEqual(ostreya.goods!.actual, 40);
    assert.strictEqual(iron.processingUse, 40);
    assert.strictEqual(iron.closing, 0);
  });
});

describe('potentialOutput overflow safety (found by cross-checking sim-core)', () => {
  it('caps at capacity without demanding the labour product be a safe integer', () => {
    // Idle labour can dwarf capacity: 1e9 workers x 1e9 output each overflows
    // 2^53, yet the answer is simply the capacity, which needs no big number.
    const region = {
      regionId: 'region:dev-2x5:BIG' as RegionId,
      controllerId: OSTREYA,
      displayName: { en: 'Big', ru: 'Большой' },
      activity: { kind: 'extraction' as const, resource: 'coal' as const },
      population: 1_000_000_000,
      annualBirthRateBp: 0,
      annualDeathRateBp: 0,
      birthRemainder: 0,
      deathRemainder: 0,
      workforceRateBp: 10000,
      infrastructureBp: 10000,
      damageBp: 0,
      baseMonthlyCapacity: 15000,
      outputPerWorker: 1_000_000_000,
    };
    assert.strictEqual(potentialOutput(region, 1_000_000_000), 15000);
  });

  it('still asserts loudly when the labour product itself is the answer', () => {
    const region = {
      regionId: 'region:dev-2x5:BIG2' as RegionId,
      controllerId: OSTREYA,
      displayName: { en: 'Big', ru: 'Большой' },
      activity: { kind: 'extraction' as const, resource: 'coal' as const },
      population: 1,
      annualBirthRateBp: 0,
      annualDeathRateBp: 0,
      birthRemainder: 0,
      deathRemainder: 0,
      workforceRateBp: 10000,
      infrastructureBp: 10000,
      damageBp: 0,
      baseMonthlyCapacity: Number.MAX_SAFE_INTEGER,
      outputPerWorker: 1_000_000_000,
    };
    assert.throws(() => potentialOutput(region, 1_000_000_000), RangeError);
  });
});
