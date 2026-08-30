import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ScenarioV2Validator } from './validator.js';
import type { ScenarioBundle, Diagnostic } from './validator.js';
import { scenarioManifestSchema } from './schemas.js';

export const BUILDER_CONTRACT_VERSION = '1';

export interface BuildResult {
  success: boolean;
  bundle?: ScenarioBundle;
  inputChecksum: string | null;
  errors: Diagnostic[];
}

export interface BuildOptions {
  /** Locally resolved bytes keyed by manifest asset ID. No network fallback. */
  assets?: Readonly<Record<string, string | Uint8Array>>;
}

export interface BuildDirectoryOptions {
  /** Shared content-addressed assets keyed by `sha256:<hex>`. */
  contentStore?: Readonly<Record<string, string | Uint8Array>>;
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

  build(input: unknown, options: BuildOptions = {}): BuildResult {
    const result = this.validator.validateBundle(input);
    if (!result.valid || !result.bundle) {
      return { success: false, inputChecksum: null, errors: result.errors };
    }
    const assetErrors = validateResolvedAssets(result.bundle, options.assets ?? {});
    if (assetErrors.length > 0) {
      return { success: false, bundle: result.bundle, inputChecksum: null, errors: assetErrors };
    }
    const inputChecksum = calculateInputChecksum(result.bundle);
    return { success: true, bundle: result.bundle, inputChecksum, errors: [] };
  }

  buildFromDirectory(packageDirectory: string, options: BuildDirectoryOptions = {}): BuildResult {
    let root: string;
    try {
      root = realpathSync(packageDirectory);
    } catch {
      return buildFailure('build.missing-package-directory', '', `scenario package directory does not exist: ${packageDirectory}`);
    }

    const manifestRead = readJsonWithin(root, 'manifest.json', '/manifest');
    if ('error' in manifestRead) return manifestRead.error;
    const manifestParsed = scenarioManifestSchema.safeParse(manifestRead.value);
    if (!manifestParsed.success) {
      return this.build({ manifest: manifestRead.value, scenario: undefined, sources: undefined });
    }

    const manifest = manifestParsed.data;
    const scenarioRead = readJsonWithin(root, manifest.scenarioPath, '/scenario');
    if ('error' in scenarioRead) return scenarioRead.error;
    const sourcesRead = readJsonWithin(root, manifest.sourcesPath, '/sources');
    if ('error' in sourcesRead) return sourcesRead.error;

    const assets: Record<string, string | Uint8Array> = {};
    for (let index = 0; index < manifest.assets.length; index += 1) {
      const asset = manifest.assets[index];
      if (asset.path) {
        const read = readBytesWithin(root, asset.path, `/manifest/assets/${index}/path`);
        if ('error' in read) {
          if (asset.required || read.error.errors[0]?.code === 'build.path-escape') return read.error;
        } else {
          assets[asset.id] = read.value;
        }
      } else if (asset.contentAddress && options.contentStore?.[asset.contentAddress] !== undefined) {
        assets[asset.id] = options.contentStore[asset.contentAddress];
      }
    }

    return this.build({ manifest, scenario: scenarioRead.value, sources: sourcesRead.value }, { assets });
  }

  projections(bundle: ScenarioBundle): WorldProjection {
    return {
      scenarioId: bundle.scenario.id,
      startDate: bundle.scenario.game.startDate,
      polities: Object.values(bundle.scenario.polities)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => ({ id: p.id, name: p.name, color: p.color })),
      regions: [...bundle.scenario.regions].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({
        id: r.id,
        owner: bundle.scenario.regionAssignments?.[r.id] ?? null,
      })),
      simulationRules: bundle.scenario.simulationRules,
    };
  }
}

function buildFailure(code: string, pathValue: string, message: string): BuildResult {
  return { success: false, inputChecksum: null, errors: [{ code, path: pathValue, message }] };
}

function resolveWithin(root: string, relativePath: string, diagnosticPath: string): { value: string } | { error: BuildResult } {
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return { error: buildFailure('build.path-escape', diagnosticPath, `package path escapes its root: ${relativePath}`) };
  }
  if (!existsSync(candidate)) {
    return { error: buildFailure('build.missing-document', diagnosticPath, `required package file is missing: ${relativePath}`) };
  }
  const resolved = realpathSync(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return { error: buildFailure('build.path-escape', diagnosticPath, `package symlink escapes its root: ${relativePath}`) };
  }
  return { value: resolved };
}

function readJsonWithin(root: string, relativePath: string, diagnosticPath: string): { value: unknown } | { error: BuildResult } {
  const resolved = resolveWithin(root, relativePath, diagnosticPath);
  if ('error' in resolved) return resolved;
  try {
    return { value: JSON.parse(readFileSync(resolved.value, 'utf8')) as unknown };
  } catch {
    return { error: buildFailure('build.invalid-json', diagnosticPath, `package file is not strict JSON: ${relativePath}`) };
  }
}

function readBytesWithin(root: string, relativePath: string, diagnosticPath: string): { value: Uint8Array } | { error: BuildResult } {
  const resolved = resolveWithin(root, relativePath, diagnosticPath);
  if ('error' in resolved) return resolved;
  return { value: readFileSync(resolved.value) };
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
    manifest: {
      ...bundle.manifest,
      assets: [...bundle.manifest.assets].sort((a, b) => a.id.localeCompare(b.id)),
    },
    scenario: normalizeScenario(bundle.scenario),
    sources: [...bundle.sources].sort((a, b) => a.id.localeCompare(b.id)),
    requiredAssetHashes,
    builderContractVersion: BUILDER_CONTRACT_VERSION,
  };

  const json = canonicalStringify(canonicalInput);
  return `sha256:${createHash('sha256').update(json, 'utf8').digest('hex')}`;
}

function validateResolvedAssets(
  bundle: ScenarioBundle,
  assets: Readonly<Record<string, string | Uint8Array>>,
): Diagnostic[] {
  const errors: Diagnostic[] = [];
  bundle.manifest.assets.forEach((asset, index) => {
    const bytes = assets[asset.id];
    if (asset.required && bytes === undefined) {
      errors.push({
        code: 'build.missing-local-asset',
        path: `/manifest/assets/${index}`,
        message: `required asset "${asset.id}" is absent from the local package/store`,
        refs: [asset.id],
      });
      return;
    }
    if (bytes !== undefined && asset.contentAddress) {
      const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (actual !== asset.contentAddress) {
        errors.push({
          code: 'build.asset-checksum-mismatch',
          path: `/manifest/assets/${index}/contentAddress`,
          message: `asset "${asset.id}" bytes do not match its contentAddress`,
          refs: [asset.id, asset.contentAddress, actual],
        });
      }
    }
  });
  return errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}

function normalizeScenario(scenario: ScenarioBundle['scenario']): unknown {
  return {
    ...scenario,
    regions: [...scenario.regions].sort((a, b) => a.id.localeCompare(b.id)),
    ...(scenario.cities ? { cities: [...scenario.cities].sort((a, b) => a.id.localeCompare(b.id)) } : {}),
    historicalFacts: [...scenario.historicalFacts]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((fact) => ({
        ...fact,
        subjectRefs: [...fact.subjectRefs].sort(),
        sourceRefs: [...fact.sourceRefs].sort(),
        assumptionRefs: [...fact.assumptionRefs].sort(),
        transformation: fact.transformation.map((step) => ({
          ...step,
          inputSourceRefs: [...step.inputSourceRefs].sort(),
        })),
      })),
    assumptions: [...scenario.assumptions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((assumption) => ({
        ...assumption,
        affectedPaths: [...assumption.affectedPaths].sort(),
        sourceRefs: [...assumption.sourceRefs].sort(),
      })),
    macroRegions: [...scenario.macroRegions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((macro) => ({ ...macro, members: [...macro.members].sort() })),
    fidelity: {
      ...scenario.fidelity,
      gaps: [...scenario.fidelity.gaps].sort((a, b) =>
        a.path.localeCompare(b.path) || a.disposition.localeCompare(b.disposition)),
    },
  };
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
