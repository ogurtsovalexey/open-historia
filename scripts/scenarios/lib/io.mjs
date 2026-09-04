import fs from 'node:fs/promises';
import { canonicalStringify } from '@open-historia/data-packs';

export async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export function deterministicJson(value) {
  return `${canonicalStringify(value)}\n`;
}

export function writeJsonLine(stream, value) {
  stream.write(deterministicJson(value));
}

export function errorDiagnostic(error) {
  if (error && typeof error === 'object' && Array.isArray(error.diagnostics)) {
    return error.diagnostics;
  }
  const filesystemCode = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : undefined;
  return [{
    code: error instanceof SyntaxError ? 'input.invalid-json' : 'io.failure',
    path: '',
    message: filesystemCode
      ? `filesystem operation failed (${filesystemCode})`
      : error instanceof Error ? error.message : String(error),
  }];
}
