import { describe, it } from 'node:test';
import assert from 'node:assert';
import { econScenarioSchema, parseScenario } from '../src/scenario.js';
import { initState, moduleEnabled } from '../src/state.js';
import { canonicalState } from '../src/canonical.js';
import { loadScenarioRaw } from './helpers.js';

/**
 * Modules are opt-in and their ABSENCE is load-bearing: a scenario that enables
 * nothing must serialise exactly as it did before modules existed, otherwise
 * every recorded revision — including the checked-in golden campaign — breaks.
 */
describe('optional mechanics (canon 00, "Modular mechanics")', () => {
  it('a scenario without modules produces a state with no modules field at all', () => {
    const state = initState(parseScenario(loadScenarioRaw()));
    assert.strictEqual(state.modules, undefined);
    assert.ok(!canonicalState(state).includes('"modules"'), 'canonical state must not mention modules');
    for (const module of ['projects', 'budget', 'trade', 'shortages', 'unrest'] as const) {
      assert.strictEqual(moduleEnabled(state, module), false);
    }
  });

  it('explicitly disabled modules are also absent from the state', () => {
    const raw = structuredClone(loadScenarioRaw()) as Record<string, unknown>;
    raw.modules = { projects: false, trade: false };
    const state = initState(parseScenario(raw));
    assert.strictEqual(state.modules, undefined);
    assert.strictEqual(moduleEnabled(state, 'projects'), false);
  });

  it('enabled modules are carried, sorted, and readable', () => {
    const raw = structuredClone(loadScenarioRaw()) as Record<string, unknown>;
    raw.modules = { unrest: true, trade: true, budget: false };
    // The projects module additionally demands a ceiling per region, so it is
    // deliberately left out of this case.
    const state = initState(parseScenario(raw));
    assert.deepStrictEqual(Object.keys(state.modules ?? {}), ['trade', 'unrest']);
    assert.strictEqual(moduleEnabled(state, 'trade'), true);
    assert.strictEqual(moduleEnabled(state, 'unrest'), true);
    assert.strictEqual(moduleEnabled(state, 'budget'), false);
  });

  it('the projects module requires a capacity ceiling on every region', () => {
    const raw = structuredClone(loadScenarioRaw()) as Record<string, unknown>;
    raw.modules = { projects: true };
    const result = econScenarioSchema.safeParse(raw);
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error!.issues.some((issue) => issue.message.includes('capacityCeiling')),
      'the failure must name the missing ceiling'
    );
  });

  it('a ceiling below the starting capacity is rejected', () => {
    const raw = structuredClone(loadScenarioRaw()) as { regions: Array<Record<string, unknown>> };
    raw.regions[0].capacityCeiling = 1;
    const result = econScenarioSchema.safeParse(raw);
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.issues.some((issue) => issue.message.includes('below its starting capacity')));
  });

  it('a ceiling alone does not enable anything', () => {
    const raw = structuredClone(loadScenarioRaw()) as { regions: Array<Record<string, unknown>> };
    for (const region of raw.regions) region.capacityCeiling = 10_000_000;
    const state = initState(parseScenario(raw));
    assert.strictEqual(state.modules, undefined);
    assert.strictEqual(state.regions[0].capacityCeiling, 10_000_000);
  });
});
