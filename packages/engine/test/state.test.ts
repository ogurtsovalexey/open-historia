import { describe, it } from 'node:test';
import assert from 'node:assert';
import { addMonth, initState, isStrategicActor, parseWorldState } from '../src/state.js';
import { canonicalState, stateChecksum } from '../src/canonical.js';
import { loadScenario, loadScenarioRaw } from './helpers.js';
import { parseScenario } from '../src/scenario.js';
import { resolveMonth } from '../src/tick.js';
import { EMPTY_TURN_COMMANDS } from '../src/commands.js';

describe('world state', () => {
  it('initState is deterministic: two builds produce identical canonical text', () => {
    const a = initState(loadScenario());
    const b = initState(loadScenario());
    assert.strictEqual(canonicalState(a), canonicalState(b));
    assert.strictEqual(a.revision, b.revision);
  });

  it('revision is the sha256 of the canonical state', () => {
    const state = initState(loadScenario());
    assert.strictEqual(state.revision, stateChecksum(state));
    assert.match(state.revision, /^sha256:[0-9a-f]{64}$/);
  });

  it('regions and polities are sorted; stockpile covers every active resource', () => {
    const state = initState(loadScenario());
    const regionIds = state.regions.map((r) => r.regionId);
    assert.deepStrictEqual(regionIds, [...regionIds].sort());
    const polityIds = state.polities.map((p) => p.id);
    assert.deepStrictEqual(polityIds, [...polityIds].sort());
    for (const polity of state.polities) {
      assert.deepStrictEqual(
        polity.stockpile.map((entry) => entry.resource),
        [...state.activeResources].sort()
      );
    }
  });

  it('parseWorldState rejects a tampered state whose revision no longer matches', () => {
    const state = initState(loadScenario());
    const tampered = structuredClone(state) as { polities: Array<{ treasury: number }> };
    tampered.polities[0].treasury += 1;
    assert.throws(() => parseWorldState(tampered), /revision mismatch/);
  });

  it('addMonth walks the calendar deterministically without Date', () => {
    assert.strictEqual(addMonth('1900-01-01'), '1900-02-01');
    assert.strictEqual(addMonth('1900-12-01'), '1901-01-01');
    assert.strictEqual(addMonth('1900-01-31'), '1900-02-28'); // 1900 is not a leap year
    assert.strictEqual(addMonth('2000-01-31'), '2000-02-29'); // 2000 is
  });

  it('preserves an authored inert decision mode across monthly resolution', () => {
    const raw = structuredClone(loadScenarioRaw()) as { polities: Array<{ decisionMode?: string }> };
    raw.polities[0].decisionMode = 'inert';
    const initial = initState(parseScenario(raw));
    assert.strictEqual(isStrategicActor(initial.polities[0]), false);
    const next = resolveMonth(initial, EMPTY_TURN_COMMANDS).state;
    assert.strictEqual(next.polities[0].decisionMode, 'inert');
    assert.strictEqual(isStrategicActor(next.polities[0]), false);
    assert.strictEqual(isStrategicActor(next.polities[1]), true);
  });
});
