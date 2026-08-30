import { describe, it } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import { exportJsonSchema, validateWithDiagnostics } from '../src/index.js';
import { scenarioIdSchema, polityIdSchema, gameDateSchema } from '../src/ids.js';
import { commandSchema } from '../src/commands.js';

describe('JSON Schema Export', () => {
  it('exports simple schema to JSON Schema', () => {
    const schema = z.object({
      id: scenarioIdSchema,
      name: z.string(),
      date: gameDateSchema
    });

    const jsonSchema = exportJsonSchema(schema) as {
      type: string;
      properties: Record<string, unknown>;
    };

    assert(jsonSchema);
    assert.strictEqual(typeof jsonSchema, 'object');
    assert.strictEqual(jsonSchema.type, 'object');
    assert(jsonSchema.properties);
    assert(jsonSchema.properties.id);
    assert(jsonSchema.properties.date);
  });

  it('exports discriminated union schema', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('quantity'),
        amount: z.string(),
        unit: z.string()
      }),
      z.object({
        kind: z.literal('text'),
        value: z.string()
      })
    ]);

    const jsonSchema = exportJsonSchema(schema) as {
      oneOf: unknown[];
    };

    assert(jsonSchema);
    assert.strictEqual(jsonSchema.oneOf.length, 2);
  });

  it('keeps the provider command schema aligned with strict Zod parsing', () => {
    const jsonSchema = exportJsonSchema(commandSchema) as {
      oneOf: Array<{
        additionalProperties: boolean;
        required: string[];
        properties: Record<string, { const?: string; pattern?: string }>;
      }>;
    };
    const transferSchema = jsonSchema.oneOf.find(
      option => option.properties.type.const === 'request-region-transfer'
    );
    assert(transferSchema);
    assert.strictEqual(transferSchema.additionalProperties, false);
    assert(transferSchema.required.includes('regionId'));
    assert(transferSchema.properties.regionId.pattern);
    assert(transferSchema.properties.issuedAt.pattern);

    const fixture = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      type: 'request-region-transfer',
      issuedAt: '1916-01-01',
      issuedBy: 'polity:russia',
      targetRevision: 'rev-1',
      regionId: 'region:gadm-4-1:RUS.33_1',
      fromPolityId: 'polity:russia',
      toPolityId: 'polity:germany',
      reason: 'Fixture'
    };
    assert.strictEqual(commandSchema.safeParse(fixture).success, true);
    assert.strictEqual(commandSchema.safeParse({ ...fixture, extra: true }).success, false);
    assert.strictEqual(commandSchema.safeParse({ ...fixture, regionId: 'invalid' }).success, false);
  });
});

describe('validateWithDiagnostics', () => {
  it('validates correct data', () => {
    const schema = z.object({
      id: polityIdSchema,
      name: z.string(),
      date: gameDateSchema
    });

    const data = {
      id: 'polity:russian-empire',
      name: 'Russian Empire',
      date: '1916-01-01'
    };

    const result = validateWithDiagnostics(schema, data);

    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.data, data);
    assert.strictEqual(result.errors.length, 0);
  });

  it('returns detailed errors for invalid data', () => {
    const schema = z.object({
      id: polityIdSchema,
      name: z.string(),
      date: gameDateSchema
    });

    const data = {
      id: 'invalid-id',
      name: 'Test',
      date: 'invalid-date'
    };

    const result = validateWithDiagnostics(schema, data);

    assert.strictEqual(result.valid, false);
    assert(result.errors.length >= 2);

    const errorMessages = result.errors.map(e => e.message).join(', ');
    assert.match(errorMessages, /Invalid polity ID/);
    assert.match(errorMessages, /Date must be a valid YYYY-MM-DD/);
  });

  it('returns path information for nested errors', () => {
    const schema = z.object({
      polities: z.record(polityIdSchema, z.object({
        name: z.string(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
      }))
    });

    const data = {
      polities: {
        'polity:russian-empire': {
          name: 'Russia',
          color: 'invalid' // Should be #rrggbb
        }
      }
    };

    const result = validateWithDiagnostics(schema, data);

    assert.strictEqual(result.valid, false);
    assert(result.errors.length >= 1);
    assert.match(result.errors[0].path, /polities\.polity:russian-empire\.color/);
  });
});

describe('Unknown Field Rejection', () => {
  it('rejects unknown fields in strict objects', () => {
    const schema = z.object({
      id: polityIdSchema,
      name: z.string()
    }).strict();

    const data = {
      id: 'polity:russian-empire',
      name: 'Russia',
      extraField: 'not allowed'
    };

    const result = validateWithDiagnostics(schema, data);

    assert.strictEqual(result.valid, false);
    assert(result.errors.length >= 1);
    assert.match(result.errors[0].message, /Unrecognized key/);
  });

  it('accepts data without unknown fields', () => {
    const schema = z.object({
      id: polityIdSchema,
      name: z.string()
    }).strict();

    const data = {
      id: 'polity:russian-empire',
      name: 'Russia'
    };

    const result = validateWithDiagnostics(schema, data);

    assert.strictEqual(result.valid, true);
  });
});

describe('Reference Validation', () => {
  it('validates ID references', () => {
    const schema = z.object({
      polityId: polityIdSchema,
      referencedPolityIds: polityIdSchema.array()
    });

    const validData = {
      polityId: 'polity:russian-empire',
      referencedPolityIds: ['polity:german-empire', 'polity:france']
    };

    const invalidData = {
      polityId: 'invalid-format',
      referencedPolityIds: ['polity:valid', 'invalid']
    };

    const validResult = validateWithDiagnostics(schema, validData);
    const invalidResult = validateWithDiagnostics(schema, invalidData);

    assert.strictEqual(validResult.valid, true);
    assert.strictEqual(invalidResult.valid, false);
    assert(invalidResult.errors.length >= 2);
  });
});
