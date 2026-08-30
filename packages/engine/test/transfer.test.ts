import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { CommandId, PolityId, RegionId } from '@open-historia/domain';
import { EMPTY_TURN_COMMANDS } from '../src/commands.js';
import type { EconCommand } from '../src/commands.js';
import { resolveMonth } from '../src/tick.js';
import { renderReport } from '../src/report.js';
import { getStock } from '../src/state.js';
import { loadInitialState } from './helpers.js';

const OSTREYA = 'polity:ostreya' as PolityId;
const VINDAR = 'polity:vindar' as PolityId;
const A1 = 'region:dev-2x5:A1' as RegionId; // Ostreya, food, 900000 people
const A5 = 'region:dev-2x5:A5' as RegionId; // Ostreya, basic_goods
const B5 = 'region:dev-2x5:B5' as RegionId; // Vindar, basic_goods

function transfer(overrides: Partial<EconCommand> = {}): EconCommand {
  return {
    kind: 'territory.transfer-region',
    commandId: '7b2f5c1e-0d2b-4d3a-9a51-000000000001' as CommandId,
    actorPolityId: OSTREYA,
    targetRegionId: A1,
    newControllerId: VINDAR,
    effectiveMonth: '1900-01-01',
    ...overrides,
  } as EconCommand;
}

function ledgerFor(result: ReturnType<typeof resolveMonth>, id: PolityId) {
  const entry = result.ledger.polities.find((p) => p.polityId === id);
  assert.ok(entry, `ledger for ${id}`);
  return entry;
}

describe('region transfer (first-economy-mvp §7, §10)', () => {
  it('moves the region and its population between national totals by the same amount', () => {
    const initial = loadInitialState();
    const withoutTransfer = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const withTransfer = resolveMonth(initial, { commands: [transfer()] });

    const region = initial.regions.find((r) => r.regionId === A1)!;
    const baseOstreya = ledgerFor(withoutTransfer, OSTREYA);
    const baseVindar = ledgerFor(withoutTransfer, VINDAR);
    const movedOstreya = ledgerFor(withTransfer, OSTREYA);
    const movedVindar = ledgerFor(withTransfer, VINDAR);

    // A decreases and B increases by the same regional population (§10).
    const populationRow = withTransfer.ledger.polities
      .flatMap((p) => p.populationByRegion)
      .find((row) => row.regionId === A1)!;
    const lost = baseOstreya.populationClosing - movedOstreya.populationClosing;
    const gained = movedVindar.populationClosing - baseVindar.populationClosing;
    assert.strictEqual(lost, gained);
    assert.strictEqual(lost, populationRow.population);

    // The region now sits under the new controller, values intact.
    const after = withTransfer.state.regions.find((r) => r.regionId === A1)!;
    assert.strictEqual(after.controllerId, VINDAR);
    assert.strictEqual(after.infrastructureBp, region.infrastructureBp);
    assert.strictEqual(after.damageBp, region.damageBp);
    assert.strictEqual(after.baseMonthlyCapacity, region.baseMonthlyCapacity);

    assert.ok(withTransfer.invariantsChecked.includes('transfer-conservation'));
    assert.deepStrictEqual(withTransfer.rejections, []);
  });

  it('assigns this month output to the new controller', () => {
    const initial = loadInitialState();
    const withoutTransfer = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const withTransfer = resolveMonth(initial, { commands: [transfer()] });

    const foodOf = (result: ReturnType<typeof resolveMonth>, id: PolityId) =>
      ledgerFor(result, id).production.find((entry) => entry.resource === 'food')?.total ?? 0;

    // A1 produces 120000 food; it must leave A's production and appear in B's.
    assert.strictEqual(foodOf(withoutTransfer, OSTREYA) - foodOf(withTransfer, OSTREYA), 120000);
    assert.strictEqual(foodOf(withTransfer, VINDAR) - foodOf(withoutTransfer, VINDAR), 120000);
    // The producing region is credited to the new controller in the ledger.
    const vindarRows = ledgerFor(withTransfer, VINDAR)
      .production.find((entry) => entry.resource === 'food')!
      .byRegion.map((row) => row.regionId);
    assert.ok(vindarRows.includes(A1));
  });

  it('does not move treasury or accumulated stockpiles', () => {
    const initial = loadInitialState();
    const withTransfer = resolveMonth(initial, { commands: [transfer()] });
    const ostreyaBefore = initial.polities.find((p) => p.id === OSTREYA)!;
    const vindarBefore = initial.polities.find((p) => p.id === VINDAR)!;
    const ostreyaLedger = ledgerFor(withTransfer, OSTREYA);
    const vindarLedger = ledgerFor(withTransfer, VINDAR);

    // Opening treasuries are untouched by the transfer itself; only tax moves them.
    assert.strictEqual(ostreyaLedger.treasuryOpening, ostreyaBefore.treasury);
    assert.strictEqual(vindarLedger.treasuryOpening, vindarBefore.treasury);
    // Opening stocks likewise stay with their original owner.
    for (const movement of ostreyaLedger.stockMovements) {
      assert.strictEqual(movement.opening, getStock(ostreyaBefore, movement.resource));
    }
    for (const movement of vindarLedger.stockMovements) {
      assert.strictEqual(movement.opening, getStock(vindarBefore, movement.resource));
    }
  });

  it('an investment paid this month travels with the ceded region', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, {
      commands: [
        {
          kind: 'economy.invest-region',
          commandId: '7b2f5c1e-0d2b-4d3a-9a51-000000000002' as CommandId,
          actorPolityId: OSTREYA,
          targetRegionId: A1,
          effectiveMonth: '1900-01-01',
          spend: 1000,
        } as EconCommand,
        transfer(),
      ],
    });
    assert.deepStrictEqual(result.rejections, []);
    const after = result.state.regions.find((r) => r.regionId === A1)!;
    // Ostreya paid for +1000 bp (6000 -> 7000) and then ceded the region.
    assert.strictEqual(after.infrastructureBp, 7000);
    assert.strictEqual(after.controllerId, VINDAR);
    assert.strictEqual(ledgerFor(result, OSTREYA).investment?.spend, 1000);
  });

  it('rejects a transfer that would give one polity two processing regions', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, {
      commands: [transfer({ targetRegionId: A5, newControllerId: VINDAR })],
    });
    assert.strictEqual(result.rejections.length, 1);
    assert.strictEqual(result.rejections[0].reason, 'processing-competition');
    assert.match(result.rejections[0].detail, new RegExp(B5));
    // State advances exactly as if no command had been issued.
    const untouched = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    assert.strictEqual(result.state.revision, untouched.state.revision);
  });

  const rejectionCases: Array<{ name: string; command: EconCommand; reason: string }> = [
    { name: 'a region the actor does not control', command: transfer({ actorPolityId: VINDAR }), reason: 'foreign-target' },
    { name: 'an unknown receiving polity', command: transfer({ newControllerId: 'polity:nowhere' as PolityId }), reason: 'unknown-new-controller' },
    { name: 'a transfer to itself', command: transfer({ newControllerId: OSTREYA }), reason: 'same-controller' },
    { name: 'an unknown region', command: transfer({ targetRegionId: 'region:dev-2x5:Z9' as RegionId }), reason: 'unknown-region' },
    { name: 'a wrong month', command: transfer({ effectiveMonth: '1900-05-01' }), reason: 'wrong-month' },
  ];

  for (const testCase of rejectionCases) {
    it(`rejects ${testCase.name} and changes nothing`, () => {
      const initial = loadInitialState();
      const result = resolveMonth(initial, { commands: [testCase.command] });
      const untouched = resolveMonth(initial, EMPTY_TURN_COMMANDS);
      assert.strictEqual(result.rejections.length, 1);
      assert.strictEqual(result.rejections[0].reason, testCase.reason);
      assert.strictEqual(result.state.revision, untouched.state.revision);
      assert.deepStrictEqual(result.ledger.transfers, []);
    });
  }

  it('rejects a second transfer of the same region in one month', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, {
      commands: [
        transfer(),
        transfer({ commandId: '7b2f5c1e-0d2b-4d3a-9a51-000000000003' as CommandId }),
      ],
    });
    assert.strictEqual(result.ledger.transfers.length, 1);
    assert.strictEqual(result.rejections.length, 1);
    assert.strictEqual(result.rejections[0].reason, 'command-limit');
  });

  it('a polity that cedes its last region keeps its treasury and stocks', () => {
    let state = loadInitialState();
    const ostreyaRegions = state.regions.filter((r) => r.controllerId === OSTREYA).map((r) => r.regionId);
    // Cede every region except the processing one, which Vindar cannot take.
    for (const [index, regionId] of ostreyaRegions.entries()) {
      const region = state.regions.find((r) => r.regionId === regionId)!;
      if (region.activity.kind === 'processing') continue;
      const result = resolveMonth(state, {
        commands: [
          transfer({
            targetRegionId: regionId,
            commandId: `7b2f5c1e-0d2b-4d3a-9a51-00000000010${index}` as CommandId,
            effectiveMonth: state.month,
          }),
        ],
      });
      assert.deepStrictEqual(result.rejections, []);
      state = result.state;
    }
    const ostreya = state.polities.find((p) => p.id === OSTREYA)!;
    assert.strictEqual(state.regions.filter((r) => r.controllerId === OSTREYA).length, 1);
    assert.ok(ostreya.treasury > 0);
    assert.strictEqual(state.polities.length, 2);
  });

  it('names the territorial change and its consequences in the report', () => {
    const initial = loadInitialState();
    const result = resolveMonth(initial, { commands: [transfer()] });
    const report = renderReport(initial, result.state, result.ledger, result.events, result.rejections);
    assert.match(report, /## Territorial changes/);
    assert.match(report, new RegExp(`${A1}: ${OSTREYA} → ${VINDAR}`));
    assert.match(report, /treasuries and stockpiles do not move/);
  });
});
