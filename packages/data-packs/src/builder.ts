import { createHash } from 'node:crypto';
import { ScenarioV2Validator } from './validator.js';
import type { ScenarioBundle, Diagnostic } from './validator.js';

export const BUILDER_CONTRACT_VERSION = '1';

export interface BuildResult {
  success: boolean;
  bundle?: ScenarioBundle;
  inputChecksum: string | null;
  errors: Diagnostic[];
}

export interface WorldProjection {
  scenarioId: string;
  startDate: string;
  polities: Array<{ id: string; name: string; color: string }>;
  regions: Array<{ id: string; owner: string | null }>;
  simulationRules: unknown;
}

/**
 * Deterministic offline Scenario V2 builder. Parses, validates, canonicalizes
 * and checksums a pinned package. Performs no network I/O and no model calls.
 */
export class ScenarioV2Builder {
  private readonly validator = new ScenarioV2Validator();

  build(input: unknown): BuildResult {
    const result = this.validator.validateBundle(input);
    if (!result.valid || !result.bundle) {
      return { success: false, inputChecksum: null, errors: result.errors };
    }
    const inputChecksum = calculateInputChecksum(result.bundle);
    return { success: true, bundle: result.bundle, inputChecksum, errors: [] };
  }

  projections(bundle: ScenarioBundle): WorldProjection {
    return {
      scenarioId: bundle.scenario.id,
      startDate: bundle.scenario.game.startDate,
      polities: Object.values(bundle.scenario.polities).map((p) => ({ id: p.id, name: p.name, color: p.color })),
      regions: bundle.scenario.regions.map((r) => ({
        id: r.id,
        owner: bundle.scenario.regionAssignments?.[r.id] ?? null,
      })),
      simulationRules: bundle.scenario.simulationRules,
    };
  }
}

/**
 * Compute the canonical input checksum for a validated bundle.
 * Includes schema-valid manifest/scenario/source data, the sorted byte hashes
 * of required assets, and the builder contract version. Excludes drafts, local
 * machine data, timestamps, network/LLM output and publication revision IDs.
 */
export function calculateInputChecksum(bundle: ScenarioBundle): string {
  const requiredAssetHashes = bundle.manifest.assets
    .filter((asset) => asset.required && asset.contentAddress)
    .map((asset) => asset.contentAddress as string)
    .sort();

  const canonicalInput = {
    schemaVersion: 2,
    manifest: bundle.manifest,
    scenario: bundle.scenario,
    sources: bundle.sources,
    requiredAssetHashes,
    builderContractVersion: BUILDER_CONTRACT_VERSION,
  };

  const json = canonicalStringify(canonicalInput);
  return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
}

/**
 * RFC 8785/JCS-style canonical serialization: object keys are sorted, arrays
 * preserve order, strings use JSON escaping and numbers use shortest
 * round-trip (integers in practice). Deterministic across runs and machines.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  // Undefined, functions, symbols cannot appear in a validated bundle.
  throw new Error(`cannot canonicalize value of type ${typeof value}`);
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('cannot canonicalize a non-finite number');
  }
  return String(value);
}