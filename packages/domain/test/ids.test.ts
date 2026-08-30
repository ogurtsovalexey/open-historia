import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  scenarioIdSchema,
  polityIdSchema,
  sourceIdSchema,
  factIdSchema,
  assumptionIdSchema,
  macroRegionIdSchema,
  regionIdSchema,
  gameDateSchema,
  decimalQuantitySchema,
  unitSchema,
  confidenceSchema,
  entityIdSchema
} from '../src/ids.js';

describe('ID Schemas', () => {
  describe('scenarioIdSchema', () => {
    it('accepts valid scenario IDs', () => {
      assert.doesNotThrow(() => scenarioIdSchema.parse('scenario:world-1916'));
      assert.doesNotThrow(() => scenarioIdSchema.parse('scenario:test-fixture'));
    });

    it('rejects invalid scenario IDs', () => {
      assert.throws(() => scenarioIdSchema.parse('scenario:'));
      assert.throws(() => scenarioIdSchema.parse('scenario:Invalid_Case'));
      assert.throws(() => scenarioIdSchema.parse('scenario:contains spaces'));
      assert.throws(() => scenarioIdSchema.parse('polity:world-1916')); // wrong prefix
    });
  });

  describe('polityIdSchema', () => {
    it('accepts valid polity IDs', () => {
      assert.doesNotThrow(() => polityIdSchema.parse('polity:russian-empire'));
      assert.doesNotThrow(() => polityIdSchema.parse('polity:german-empire'));
    });

    it('rejects invalid polity IDs', () => {
      assert.throws(() => polityIdSchema.parse('polity:'));
      assert.throws(() => polityIdSchema.parse('polity:Invalid@Chars'));
    });
  });

  describe('regionIdSchema', () => {
    it('accepts valid region IDs with case-sensitive native IDs', () => {
      assert.doesNotThrow(() => regionIdSchema.parse('region:gadm-4-1:RUS.33_1'));
      assert.doesNotThrow(() => regionIdSchema.parse('region:gadm-4-1:DEU.1_1'));
      assert.doesNotThrow(() => regionIdSchema.parse('region:custom-dataset-1-0:Region-Name_123'));
    });

    it('preserves case in native ID', () => {
      const result = regionIdSchema.parse('region:gadm-4-1:RUS.33_1');
      assert.strictEqual(result, 'region:gadm-4-1:RUS.33_1');
    });

    it('rejects invalid region IDs', () => {
      assert.throws(() => regionIdSchema.parse('region:gadm-4-1:')); // empty native ID
      assert.throws(() => regionIdSchema.parse('region:invalid@chars:RUS.33_1'));
      assert.throws(() => regionIdSchema.parse('region:gadm-4-1:RUS 33_1'));
    });
  });

  describe('scenario-qualified IDs', () => {
    it('accepts the canonical three-segment grammar', () => {
      assert.doesNotThrow(() => sourceIdSchema.parse('source:world-1916:russia-yearbook'));
      assert.doesNotThrow(() => factIdSchema.parse('fact:world-1916:population-001'));
      assert.doesNotThrow(() => assumptionIdSchema.parse('assumption:world-1916:territorial-basis'));
      assert.doesNotThrow(() => macroRegionIdSchema.parse('macro-region:world-1916:eastern-front'));
    });

    it('rejects missing, extra and malformed slug segments', () => {
      assert.throws(() => sourceIdSchema.parse('source:yearbook'));
      assert.throws(() => factIdSchema.parse('fact:world-1916:population:extra'));
      assert.throws(() => assumptionIdSchema.parse('assumption:World-1916:basis'));
    });
  });

  describe('entityIdSchema', () => {
    it('accepts valid entity IDs', () => {
      assert.doesNotThrow(() => entityIdSchema.parse('polity:russian-empire'));
      assert.doesNotThrow(() => entityIdSchema.parse('region:gadm-4-1:RUS.33_1'));
      assert.doesNotThrow(() => entityIdSchema.parse('macro-region:world-1916:eastern-front'));
    });

    it('rejects non-entity IDs', () => {
      assert.throws(() => entityIdSchema.parse('scenario:world-1916'));
      assert.throws(() => entityIdSchema.parse('fact:world-1916:observation-001'));
    });
  });
});

describe('Primitive Schemas', () => {
  describe('gameDateSchema', () => {
    it('accepts valid dates', () => {
      assert.doesNotThrow(() => gameDateSchema.parse('1916-01-01'));
      assert.doesNotThrow(() => gameDateSchema.parse('1797-12-31'));
      assert.doesNotThrow(() => gameDateSchema.parse('2024-02-29')); // leap year
      assert.doesNotThrow(() => gameDateSchema.parse('0000-02-29')); // proleptic Gregorian
    });

    it('rejects invalid dates', () => {
      assert.throws(() => gameDateSchema.parse('1916-13-01'));
      assert.throws(() => gameDateSchema.parse('1916-01-32'));
      assert.throws(() => gameDateSchema.parse('1916/01/01'));
      assert.throws(() => gameDateSchema.parse('1916-1-1'));
    });
  });

  describe('decimalQuantitySchema', () => {
    it('accepts valid decimal quantities', () => {
      assert.doesNotThrow(() => decimalQuantitySchema.parse('1000000'));
      assert.doesNotThrow(() => decimalQuantitySchema.parse('3.14159'));
      assert.doesNotThrow(() => decimalQuantitySchema.parse('-42.5'));
    });

    it('rejects invalid quantities', () => {
      assert.throws(() => decimalQuantitySchema.parse('1,000,000'));
      assert.throws(() => decimalQuantitySchema.parse('1e6'));
      assert.throws(() => decimalQuantitySchema.parse('infinity'));
    });
  });

  describe('unitSchema', () => {
    it('accepts valid units', () => {
      assert.doesNotThrow(() => unitSchema.parse('RUB-1913'));
      assert.doesNotThrow(() => unitSchema.parse('person'));
      assert.doesNotThrow(() => unitSchema.parse('metric-ton'));
    });

    it('rejects empty units', () => {
      assert.throws(() => unitSchema.parse(''));
    });
  });

  describe('confidenceSchema', () => {
    it('accepts valid confidence levels', () => {
      assert.doesNotThrow(() => confidenceSchema.parse('high'));
      assert.doesNotThrow(() => confidenceSchema.parse('medium'));
      assert.doesNotThrow(() => confidenceSchema.parse('low'));
      assert.doesNotThrow(() => confidenceSchema.parse('assumption'));
    });

    it('rejects invalid confidence', () => {
      assert.throws(() => confidenceSchema.parse('unknown'));
      assert.throws(() => confidenceSchema.parse('HIGH')); // wrong case
    });
  });
});
