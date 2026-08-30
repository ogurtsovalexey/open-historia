import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isProtectedPath,
  getPathProtection,
  isMutationAllowed,
  SCENARIO_PROTECTED_PATHS,
  ENGINE_AUTHORITATIVE_PATHS
} from '../src/authority.js';

describe('Authority and Protected Paths', () => {
  describe('isProtectedPath', () => {
    it('identifies protected paths', () => {
      assert.strictEqual(isProtectedPath('/manifest/id'), true);
      assert.strictEqual(isProtectedPath('/scenario/game/startDate'), true);
      assert.strictEqual(isProtectedPath('/scenario/polities/polity:russian-empire/id'), true);
      assert.strictEqual(isProtectedPath('/scenario/regions/region:gadm-4-1:RUS.33_1/id'), true);
      assert.strictEqual(isProtectedPath('/scenario/historicalFacts/0'), true);
      assert.strictEqual(isProtectedPath('/sources/0'), true);
    });

    it('identifies non-protected paths', () => {
      assert.strictEqual(isProtectedPath('/scenario/meta/title'), false);
      assert.strictEqual(isProtectedPath('/scenario/polities/polity:russian-empire/name'), false);
      assert.strictEqual(isProtectedPath('/scenario/regions/region:gadm-4-1:RUS.33_1/name'), false);
      assert.strictEqual(isProtectedPath('/game/currentDate'), false);
      assert.strictEqual(isProtectedPath('/economy/gdp'), false);
      assert.strictEqual(isProtectedPath('/world/polities/polity:test/economy/output'), true);
    });
  });

  describe('getPathProtection', () => {
    it('returns protection rules for protected paths', () => {
      const rules = getPathProtection('/scenario/game/startDate');
      assert.strictEqual(rules.length, 1);
      assert.strictEqual(rules[0].category, 'scenario-game-start');
      assert.strictEqual(rules[0].authority, 'authored-scenario');
    });

    it('returns empty array for non-protected paths', () => {
      const rules = getPathProtection('/scenario/meta/title');
      assert.strictEqual(rules.length, 0);
    });

    it('handles wildcard patterns', () => {
      const rules = getPathProtection('/scenario/polities/polity:test/id');
      assert.strictEqual(rules.length, 1);
      assert.strictEqual(rules[0].category, 'scenario-politics');
    });
  });

  describe('isMutationAllowed', () => {
    it('blocks authored-scenario mutations on protected paths', () => {
      const result = isMutationAllowed(
        '/scenario/game/startDate',
        'authored-scenario',
        '1916-01-01',
        '1917-01-01'
      );
      assert.strictEqual(result.allowed, false);
      assert.match(result.reason!, /authored-scenario/);
    });

    it('blocks any authority on authored-scenario protected paths', () => {
      const result = isMutationAllowed(
        '/scenario/game/startDate',
        'mutable-campaign',
        '1916-01-01',
        '1917-01-01'
      );
      assert.strictEqual(result.allowed, false);
      assert.match(result.reason!, /authored-scenario/);
    });

    it('allows mutable-campaign mutations on non-protected paths', () => {
      const result = isMutationAllowed(
        '/scenario/meta/title',
        'mutable-campaign',
        'Old Title',
        'New Title'
      );
      assert.strictEqual(result.allowed, true);
    });

    it('blocks authoritative-total paths from non-authoritative-total authority', () => {
      const result = isMutationAllowed(
        '/world/polities/polity:test/economy/output',
        'mutable-campaign',
        '1000000',
        '2000000'
      );
      assert.strictEqual(result.allowed, false);
      assert.match(result.reason!, /authoritative-total/);
    });

    it('allows the engine authority to update authoritative totals', () => {
      const result = isMutationAllowed(
        '/world/polities/polity:test/populationTotal',
        'authoritative-total',
        '1000000',
        '1000100'
      );
      assert.strictEqual(result.allowed, true);
    });

    it('rejects authored-scenario authority on non-protected paths', () => {
      const result = isMutationAllowed(
        '/some/random/path',
        'authored-scenario',
        'old',
        'new'
      );
      assert.strictEqual(result.allowed, false);
      assert.match(result.reason!, /Cannot modify non-protected paths/);
    });
  });

  describe('SCENARIO_PROTECTED_PATHS', () => {
    it('contains all required protected paths from specification', () => {
      const expectedCategories = [
        'scenario-manifest',
        'scenario-identity',
        'scenario-game-start',
        'scenario-politics',
        'scenario-regions',
        'scenario-region-assignments',
        'scenario-simulation-rules',
        'scenario-historical-facts',
        'scenario-assumptions',
        'scenario-macro-regions',
        'scenario-sources'
      ] as const;

      const actualCategories = [...new Set(SCENARIO_PROTECTED_PATHS.map(p => p.category))];

      for (const category of expectedCategories) {
        assert(actualCategories.includes(category), `Missing category: ${category}`);
      }
    });

    it('has correct authority levels', () => {
      for (const rule of SCENARIO_PROTECTED_PATHS) {
        assert.strictEqual(rule.authority, 'authored-scenario');
      }
    });
  });

  describe('ENGINE_AUTHORITATIVE_PATHS', () => {
    it('defines engine authority for every representative total', () => {
      assert(ENGINE_AUTHORITATIVE_PATHS.length >= 3);
      for (const rule of ENGINE_AUTHORITATIVE_PATHS) {
        assert.strictEqual(rule.authority, 'authoritative-total');
      }
    });
  });
});
