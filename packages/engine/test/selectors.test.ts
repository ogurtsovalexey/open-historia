import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PolityId, RegionId } from '@open-historia/domain';
import { describeSelector, expandSelector, regionSelectorSchema } from '../src/selectors.js';
import type { RegionSelector } from '../src/selectors.js';
import { parseScenario } from '../src/scenario.js';
import { initState } from '../src/state.js';
import { FIXTURES_DIR, loadInitialState } from './helpers.js';

const OSTREYA = 'polity:ostreya' as PolityId;
const VINDAR = 'polity:vindar' as PolityId;

const mapState = () =>
  initState(
    parseScenario(JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-4c', 'scenario.json'), 'utf8')))
  );

describe('region selectors', () => {
  it('a named region resolves to itself', () => {
    const state = loadInitialState();
    const selector: RegionSelector = { kind: 'region', regionId: 'region:dev-2x5:A4' as RegionId };
    assert.deepStrictEqual(expandSelector(state, selector, OSTREYA), ['region:dev-2x5:A4']);
  });

  it('a named region that does not exist resolves to nothing', () => {
    const state = loadInitialState();
    const selector: RegionSelector = { kind: 'region', regionId: 'region:dev-2x5:ZZ' as RegionId };
    assert.deepStrictEqual(expandSelector(state, selector, OSTREYA), []);
  });

  it('"self" means the acting polity, so the same selector differs per actor', () => {
    const state = loadInitialState();
    const selector: RegionSelector = { kind: 'query', controller: 'self' };
    const mine = expandSelector(state, selector, OSTREYA);
    const theirs = expandSelector(state, selector, VINDAR);
    assert.strictEqual(mine.length, 5);
    assert.strictEqual(theirs.length, 5);
    assert.strictEqual(mine.filter((id) => theirs.includes(id)).length, 0);
  });

  it('filters by extraction resource', () => {
    const state = loadInitialState();
    const coal = expandSelector(
      state,
      { kind: 'query', controller: 'self', activity: { kind: 'extraction', resource: 'coal' } },
      OSTREYA
    );
    assert.deepStrictEqual(coal, ['region:dev-2x5:A4']);
    const food = expandSelector(
      state,
      { kind: 'query', controller: 'self', activity: { kind: 'extraction', resource: 'food' } },
      OSTREYA
    );
    assert.deepStrictEqual(food, ['region:dev-2x5:A1', 'region:dev-2x5:A2']);
  });

  it('filters by processing, which is one region per polity', () => {
    const state = loadInitialState();
    for (const actor of [OSTREYA, VINDAR]) {
      const processing = expandSelector(
        state,
        { kind: 'query', controller: 'self', activity: { kind: 'processing' } },
        actor
      );
      assert.strictEqual(processing.length, 1);
    }
  });

  it('names another polity explicitly', () => {
    const state = loadInitialState();
    const theirs = expandSelector(state, { kind: 'query', controller: VINDAR }, OSTREYA);
    assert.strictEqual(theirs.length, 5);
    assert.ok(theirs.every((id) => id.endsWith('B1') || /B[1-5]$/.test(id)));
  });

  it('always returns ids in sorted order, whatever the state order', () => {
    const state = loadInitialState();
    const shuffled = { ...state, regions: [...state.regions].reverse() };
    const expanded = expandSelector(shuffled, { kind: 'query', controller: 'self' }, OSTREYA);
    assert.deepStrictEqual(expanded, [...expanded].sort());
  });

  it('limit takes the first N in id order', () => {
    const state = loadInitialState();
    const all = expandSelector(state, { kind: 'query', controller: 'self' }, OSTREYA);
    const two = expandSelector(state, { kind: 'query', controller: 'self', limit: 2 }, OSTREYA);
    assert.deepStrictEqual(two, all.slice(0, 2));
  });

  it('an empty match is empty, not an error — the caller turns it into a typed rejection', () => {
    const state = loadInitialState();
    const none = expandSelector(
      state,
      { kind: 'query', controller: 'self', activity: { kind: 'extraction', resource: 'oil' } },
      OSTREYA
    );
    assert.deepStrictEqual(none, []);
  });

  it('works on the four-polity map scenario', () => {
    const state = mapState();
    const austrianCoal = expandSelector(
      state,
      { kind: 'query', controller: 'self', activity: { kind: 'extraction', resource: 'coal' } },
      'polity:austria' as PolityId
    );
    assert.deepStrictEqual(austrianCoal, ['region:gadm:AUT.7_1', 'region:gadm:AUT.8_1']);
    const germanRegions = expandSelector(
      state,
      { kind: 'query', controller: 'polity:germany' as PolityId },
      'polity:austria' as PolityId
    );
    assert.strictEqual(germanRegions.length, 16);
  });

  it('rejects a malformed selector at the schema boundary', () => {
    assert.strictEqual(regionSelectorSchema.safeParse({ kind: 'query' }).success, false);
    assert.strictEqual(
      regionSelectorSchema.safeParse({ kind: 'query', controller: 'self', limit: 0 }).success,
      false
    );
    assert.strictEqual(
      regionSelectorSchema.safeParse({ kind: 'query', controller: 'self', activity: { kind: 'extraction' } }).success,
      false
    );
    assert.strictEqual(regionSelectorSchema.safeParse({ kind: 'region', regionId: 'nope' }).success, false);
  });

  it('describes itself for previews and rejections', () => {
    assert.strictEqual(
      describeSelector({ kind: 'query', controller: 'self', activity: { kind: 'extraction', resource: 'coal' } }),
      'own coal regions'
    );
    assert.strictEqual(
      describeSelector({ kind: 'query', controller: 'self', activity: { kind: 'processing' }, limit: 3 }),
      'own processing regions (first 3)'
    );
    assert.strictEqual(
      describeSelector({ kind: 'region', regionId: 'region:dev-2x5:A1' as RegionId }),
      'region:dev-2x5:A1'
    );
  });
});
