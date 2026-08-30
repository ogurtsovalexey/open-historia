/**
 * Canonical serialization and content-addressed checksums for engine state.
 * Reuses the RFC 8785-style canonical JSON from @open-historia/data-packs so
 * scenario bundles and engine revisions share one canonicalization rule.
 */
import { createHash } from 'node:crypto';
import { canonicalStringify } from '@open-historia/data-packs';
import type { EconWorldState } from './state.js';

export function sha256OfString(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function sha256OfBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Canonical string of the world state EXCLUDING the `revision` field.
 * The revision is the hash of exactly this string, so it cannot include itself.
 */
export function canonicalState(state: EconWorldState): string {
  const rest: Record<string, unknown> = { ...state };
  delete rest.revision;
  return canonicalStringify(rest);
}

/** Content-addressed revision id of a world state. */
export function stateChecksum(state: EconWorldState): string {
  return sha256OfString(canonicalState(state));
}

export function canonicalOf(value: unknown): string {
  return canonicalStringify(value);
}
