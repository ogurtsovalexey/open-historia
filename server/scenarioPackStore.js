import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalStringify } from '@open-historia/data-packs';
import { scenarioIdSchema } from '@open-historia/domain';
import { worldV2 } from '@open-historia/engine';

export const COMPILED_SCENARIO_SCHEMA_VERSION = 'open-historia-compiled-scenario/1';
const GENERATED_BY = 'open-historia-scenario-v3-cli';
const EXPECTED_ARTIFACTS = Object.freeze({
  initialState: 'initial-state.json',
  runtimeProjection: 'runtime-projection.json',
  seed: 'world-seed.json',
});
const EXPECTED_FILES = Object.freeze([
  'initial-state.json',
  'manifest.json',
  'runtime-projection.json',
  'world-seed.json',
]);
const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function checksum(value) {
  return `sha256:${createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')}`;
}

function requireExactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compare);
  const wanted = [...expected].sort(compare);
  if (actual.join('|') !== wanted.join('|')) throw new Error(`${label} has unexpected or missing fields`);
}

function parseManifest(raw, directory) {
  requireExactKeys(raw, [
    'schemaVersion',
    'generatedBy',
    'scenarioId',
    'bundleChecksum',
    'seedChecksum',
    'initialStateRevision',
    'runtimeProjectionChecksum',
    'artifacts',
  ], `compiled scenario manifest in ${directory}`);
  if (raw.schemaVersion !== COMPILED_SCENARIO_SCHEMA_VERSION || raw.generatedBy !== GENERATED_BY) {
    throw new Error(`unsupported compiled scenario manifest in ${directory}`);
  }
  const scenarioId = scenarioIdSchema.parse(raw.scenarioId);
  for (const field of ['bundleChecksum', 'seedChecksum', 'initialStateRevision', 'runtimeProjectionChecksum']) {
    if (!CHECKSUM_PATTERN.test(raw[field])) throw new Error(`compiled scenario manifest has invalid ${field}`);
  }
  requireExactKeys(raw.artifacts, Object.keys(EXPECTED_ARTIFACTS), 'compiled scenario artifact map');
  for (const [key, filename] of Object.entries(EXPECTED_ARTIFACTS)) {
    if (raw.artifacts[key] !== filename) throw new Error(`compiled scenario artifact ${key} must be ${filename}`);
  }
  return Object.freeze({ ...raw, scenarioId, artifacts: EXPECTED_ARTIFACTS });
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function inspectPackDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`compiled scenario pack must be a non-symlink directory: ${directory}`);
  }
  const names = fs.readdirSync(directory).sort(compare);
  if (names.join('|') !== EXPECTED_FILES.join('|')) {
    throw new Error(`compiled scenario pack must contain exactly four regular artifacts: ${directory}`);
  }
  for (const name of names) {
    const artifact = fs.lstatSync(path.join(directory, name));
    if (!artifact.isFile() || artifact.isSymbolicLink()) {
      throw new Error(`compiled scenario artifact must be a regular non-symlink file: ${path.join(directory, name)}`);
    }
  }
  return parseManifest(readJson(path.join(directory, 'manifest.json'), 'compiled scenario manifest'), directory);
}

function discoverPackDirectories(rootDirectory) {
  const root = path.resolve(rootDirectory);
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('compiled scenario root must be an existing non-symlink directory');
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`compiled scenario root contains a non-pack entry: ${entry.name}`);
      }
      const directory = path.join(root, entry.name);
      return { directory, manifest: inspectPackDirectory(directory) };
    })
    .sort((left, right) => compare(left.manifest.scenarioId, right.manifest.scenarioId));
}

function loadDiscoveredPack({ directory, manifest }) {
  const seed = worldV2.worldSeedV2Schema.parse(readJson(
    path.join(directory, manifest.artifacts.seed),
    `world seed for ${manifest.scenarioId}`,
  ));
  const initialState = worldV2.parseWorldStateV2(readJson(
    path.join(directory, manifest.artifacts.initialState),
    `initial state for ${manifest.scenarioId}`,
  ));
  const runtimeProjection = readJson(
    path.join(directory, manifest.artifacts.runtimeProjection),
    `runtime projection for ${manifest.scenarioId}`,
  );
  if (seed.id !== manifest.scenarioId || initialState.scenarioId !== manifest.scenarioId) {
    throw new Error(`compiled scenario identity mismatch for ${manifest.scenarioId}`);
  }
  if (runtimeProjection?.scenarioId !== manifest.scenarioId) {
    throw new Error(`runtime projection identity mismatch for ${manifest.scenarioId}`);
  }
  if (initialState.revision !== manifest.initialStateRevision) {
    throw new Error(`initial state revision mismatch for ${manifest.scenarioId}`);
  }
  if (checksum(seed) !== manifest.seedChecksum) throw new Error(`seed checksum mismatch for ${manifest.scenarioId}`);
  if (checksum(runtimeProjection) !== manifest.runtimeProjectionChecksum) {
    throw new Error(`runtime projection checksum mismatch for ${manifest.scenarioId}`);
  }
  const { schemaVersion: _seedVersion, sourceSchemaVersion, ...seedContent } = seed;
  void _seedVersion;
  if (checksum({ schemaVersion: sourceSchemaVersion, ...seedContent }) !== manifest.bundleChecksum) {
    throw new Error(`source bundle checksum mismatch for ${manifest.scenarioId}`);
  }
  return Object.freeze({ manifest, seed, initialState, runtimeProjection });
}

/** List only fully verified packs, in stable scenario-ID order. */
export function listCompiledScenarioPacks({ rootDirectory = path.resolve('build/scenarios') } = {}) {
  const seen = new Set();
  return discoverPackDirectories(rootDirectory).map((pack) => {
    if (seen.has(pack.manifest.scenarioId)) {
      throw new Error(`duplicate compiled scenario id ${pack.manifest.scenarioId}`);
    }
    seen.add(pack.manifest.scenarioId);
    const loaded = loadDiscoveredPack(pack);
    return Object.freeze({
      scenarioId: loaded.manifest.scenarioId,
      title: loaded.runtimeProjection.title,
      profile: loaded.runtimeProjection.profile,
      startDate: loaded.runtimeProjection.startDate,
      defaultPlayerPolityId: loaded.runtimeProjection.defaultPlayerPolityId,
      playerEligiblePolityIds: Object.freeze([...loaded.runtimeProjection.playerEligiblePolityIds]),
      bundleChecksum: loaded.manifest.bundleChecksum,
      seedChecksum: loaded.manifest.seedChecksum,
    });
  });
}

/** Resolve by canonical scenario ID, never by a caller-controlled filesystem path. */
export function loadCompiledScenarioPack(scenarioId, { rootDirectory = path.resolve('build/scenarios') } = {}) {
  const parsed = scenarioIdSchema.safeParse(scenarioId);
  if (!parsed.success) throw new Error(`invalid scenario id ${String(scenarioId)}`);
  const matches = discoverPackDirectories(rootDirectory)
    .filter((entry) => entry.manifest.scenarioId === parsed.data);
  if (matches.length === 0) throw new Error(`compiled scenario ${parsed.data} not found`);
  if (matches.length > 1) throw new Error(`duplicate compiled scenario id ${parsed.data}`);
  return loadDiscoveredPack(matches[0]);
}
