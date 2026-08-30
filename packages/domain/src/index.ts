// ID schemas and primitives
export * from './ids.js';

// Fact/provenance schemas
export * from './facts.js';

// Scenario V2 schemas
export * from './scenario.js';

// Scenario V2 validator
export * from './validator.js';

// Scenario V2 builder
export * from './builder.js';

// Legacy migration adapter
export * from './migration.js';

// Command and event schemas
export * from './commands.js';

// Authority and protection
export * from './authority.js';

// Utilities
export * from './utils.js';

// Reducer and world state
export * from './reducer.js';

// JSON Schema export utilities
import { z } from 'zod';

/**
 * Export Zod schemas as JSON Schema
 * Note: The authorized dependency set has no independent JSON Schema validator.
 * This exports Zod's internal JSON Schema representation which matches the
 * same constraints/discriminators/required fields that Zod validates.
 * External validation requires a separate JSON Schema validator package.
 */
export function exportJsonSchema(schema: z.ZodType): unknown {
  return schema.toJSONSchema();
}

/**
 * Validate against schema and return detailed diagnostics
 */
export function validateWithDiagnostics<T extends z.ZodType>(
  schema: T,
  value: unknown
): { valid: boolean; data?: z.infer<T>; errors: Array<{ path: string; code: string; message: string }> } {
  const result = schema.safeParse(value);

  if (result.success) {
    return { valid: true, data: result.data, errors: [] };
  }

  const errors = result.error.issues.map(issue => ({
    path: issue.path.join('.'),
    code: `schema.${issue.code}`,
    message: issue.message
  }));

  return { valid: false, errors };
}
