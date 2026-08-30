/**
 * JSON pointer type for referencing paths in JSON documents
 */
export type JsonPointer = string & { __brand: 'JsonPointer' };

/**
 * Create a JSON pointer from path segments
 */
export function createJsonPointer(...segments: (string | number)[]): JsonPointer {
  const pointer = segments.map(segment =>
    `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`
  ).join('');
  return pointer as JsonPointer;
}

/**
 * Check if a value is a plain object (not array, null, or primitive)
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep clone an object (simple implementation for JSON-serializable values)
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Compare two values for deep equality (for JSON-serializable values)
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Generate a deterministic hash for JSON-serializable values
 */
export function deterministicHash(value: unknown): string {
  const str = JSON.stringify(value, (_, val) => {
    if (isPlainObject(val)) {
      // Sort object keys for deterministic output
      return Object.keys(val).sort().reduce((acc, key) => {
        acc[key] = val[key];
        return acc;
      }, {} as Record<string, unknown>);
    }
    return val;
  });

  // Simple hash function for demonstration
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}
