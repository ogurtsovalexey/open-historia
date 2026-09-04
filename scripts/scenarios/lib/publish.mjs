import fs from 'node:fs/promises';
import path from 'node:path';
import { deterministicJson } from './io.mjs';

export const COMPILED_SCENARIO_MANIFEST_VERSION = 'open-historia-compiled-scenario/1';
const GENERATED_BY = 'open-historia-scenario-v3-cli';
const EXPECTED_ARTIFACTS = {
  initialState: 'initial-state.json',
  runtimeProjection: 'runtime-projection.json',
  seed: 'world-seed.json',
};
const EXPECTED_FILES = ['initial-state.json', 'manifest.json', 'runtime-projection.json', 'world-seed.json'];

function hasExactArtifacts(manifest) {
  const actual = manifest?.artifacts;
  return actual !== null
    && typeof actual === 'object'
    && Object.keys(actual).sort().join('|') === Object.keys(EXPECTED_ARTIFACTS).sort().join('|')
    && Object.entries(EXPECTED_ARTIFACTS).every(([key, value]) => actual[key] === value);
}

async function existingOutputIsReplaceable(outputPath) {
  let stat;
  try {
    stat = await fs.lstat(outputPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    return false;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(outputPath, 'manifest.json'), 'utf8'));
    if (
      manifest?.schemaVersion !== COMPILED_SCENARIO_MANIFEST_VERSION
      || manifest?.generatedBy !== GENERATED_BY
      || !hasExactArtifacts(manifest)
    ) return false;
    const names = (await fs.readdir(outputPath)).sort();
    if (names.join('|') !== EXPECTED_FILES.join('|')) return false;
    for (const name of names) {
      const artifactStat = await fs.lstat(path.join(outputPath, name));
      if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function writeArtifacts(directory, compiled) {
  const manifest = {
    schemaVersion: COMPILED_SCENARIO_MANIFEST_VERSION,
    generatedBy: GENERATED_BY,
    scenarioId: compiled.seed.id,
    bundleChecksum: compiled.bundleChecksum,
    seedChecksum: compiled.seedChecksum,
    initialStateRevision: compiled.initialState.revision,
    runtimeProjectionChecksum: compiled.runtimeProjectionChecksum,
    artifacts: EXPECTED_ARTIFACTS,
  };
  const files = [
    ['initial-state.json', compiled.initialState],
    ['runtime-projection.json', compiled.runtimeProjection],
    ['world-seed.json', compiled.seed],
    ['manifest.json', manifest],
  ];
  for (const [name, value] of files) {
    await fs.writeFile(path.join(directory, name), deterministicJson(value), { encoding: 'utf8', flag: 'wx' });
  }
  return manifest;
}

export async function publishCompiledScenario(outputPath, compiled) {
  const parent = path.dirname(outputPath);
  const base = path.basename(outputPath);
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('output parent must be an existing non-symlink directory');
  }
  if (!await existingOutputIsReplaceable(outputPath)) {
    throw new Error('refusing to replace an output path not owned by the ScenarioV3 compiler');
  }

  const temporary = await fs.mkdtemp(path.join(parent, `.${base}.tmp-`));
  let backup;
  try {
    const manifest = await writeArtifacts(temporary, compiled);
    try {
      await fs.lstat(outputPath);
      backup = await fs.mkdtemp(path.join(parent, `.${base}.backup-`));
      await fs.rmdir(backup);
      await fs.rename(outputPath, backup);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(temporary, outputPath);
    } catch (error) {
      if (backup) await fs.rename(backup, outputPath);
      throw error;
    }
    if (backup) await fs.rm(backup, { recursive: true, force: true });
    return manifest;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
