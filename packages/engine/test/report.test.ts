import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EMPTY_TURN_COMMANDS } from '../src/commands.js';
import { resolveMonth } from '../src/tick.js';
import { renderReport } from '../src/report.js';
import { loadCommandsFixture, loadInitialState } from './helpers.js';

describe('turn report', () => {
  it('is byte-stable across runs', () => {
    const initial = loadInitialState();
    const a = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const b = resolveMonth(initial, EMPTY_TURN_COMMANDS);
    const reportA = renderReport(initial, a.state, a.ledger, a.events, a.rejections);
    const reportB = renderReport(initial, b.state, b.ledger, b.events, b.rejections);
    assert.strictEqual(reportA, reportB);
  });

  it('names the cause of every changed total', () => {
    const initial = loadInitialState();
    const commands = loadCommandsFixture('turn-001.json');
    const result = resolveMonth(initial, commands);
    const report = renderReport(initial, result.state, result.ledger, result.events, result.rejections);

    // Treasury change names tax sources per region and the investment spend.
    assert.match(report, /tax from region:dev-2x5:A1 \(food\): \+9600/);
    assert.match(report, /Investment: 1000 gold into region:dev-2x5:A4/);
    // Population change names births and deaths per region.
    assert.match(report, /region:dev-2x5:A1: 900825 \(births \+2400, deaths -1575\)/);
    // Goods limiting cause is explicit.
    assert.match(report, /limited by iron/);
    // Food shortfall is loud.
    assert.match(report, /Food: SHORTFALL 12926/);
    // The rejected foreign-target command is reported with its reason.
    assert.match(report, /foreign-target/);
    // Revisions frame the report.
    assert.match(report, new RegExp(`Base revision: \`${initial.revision}\``));
    assert.match(report, new RegExp(`New revision: {2}\`${result.state.revision}\``));
  });
});
