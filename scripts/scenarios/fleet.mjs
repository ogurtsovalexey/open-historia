#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scenarioV3 } from '@open-historia/data-packs';
import { worldV2 } from '@open-historia/engine';
import { deterministicJson, readJsonFile } from './lib/io.mjs';
import { installOfflineGuards } from './lib/offline.mjs';
import { publishCompiledScenario } from './lib/publish.mjs';

const SCENARIO_ROOT = path.resolve('packages/data-packs/scenarios');
const DEFAULT_OUTPUT_ROOT = path.resolve('build/scenarios');

async function scenarioEntries() {
  const entries = [];
  for (const directoryEntry of await fs.readdir(SCENARIO_ROOT, { withFileTypes: true })) {
    if (directoryEntry.name.startsWith('.') || !directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) continue;
    const inputPath = path.join(SCENARIO_ROOT, directoryEntry.name, 'scenario.json');
    try {
      const stat = await fs.lstat(inputPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`scenario entrypoint must be a regular file: ${inputPath}`);
      entries.push({ directoryName: directoryEntry.name, inputPath, input: await readJsonFile(inputPath) });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return entries.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}

async function validateFleet(entries) {
  const scenarios = [];
  const diagnostics = [];
  for (const entry of entries) {
    const validation = scenarioV3.validateScenarioV3(entry.input);
    diagnostics.push(...validation.errors.map((diagnostic) => ({ ...diagnostic, scenarioDirectory: entry.directoryName })));
    if (validation.scenario) {
      const expectedDirectory = validation.scenario.id.slice('scenario:'.length);
      if (expectedDirectory !== entry.directoryName) {
        diagnostics.push({
          code: 'fleet.directory-id-mismatch',
          path: '/id',
          message: `scenario ${validation.scenario.id} must live in directory ${expectedDirectory}`,
          scenarioDirectory: entry.directoryName,
        });
      }
      scenarios.push({ scenarioId: validation.scenario.id, directoryName: entry.directoryName });
    }
  }
  const ids = scenarios.map((entry) => entry.scenarioId);
  for (const id of new Set(ids)) {
    if (ids.filter((candidate) => candidate === id).length > 1) diagnostics.push({
      code: 'fleet.duplicate-id', path: '/id', message: `duplicate scenario id ${id}`, scenarioDirectory: '',
    });
  }
  return { diagnostics, scenarios };
}

async function ensureOutputRoot(outputRoot, expectedNames) {
  await fs.mkdir(outputRoot, { recursive: true });
  const stat = await fs.lstat(outputRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('compiled scenario fleet root must be a non-symlink directory');
  const expected = new Set(expectedNames);
  for (const entry of await fs.readdir(outputRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) throw new Error(`compiled scenario fleet root contains unmanaged entry ${entry.name}`);
    if (!expected.has(entry.name)) throw new Error(`compiled scenario fleet root contains stale or unmanaged pack ${entry.name}`);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`compiled scenario fleet entry must be a non-symlink directory: ${entry.name}`);
  }
}

function parseOutput(argv) {
  if (argv.length === 0) return DEFAULT_OUTPUT_ROOT;
  if (argv.length !== 2 || argv[0] !== '--output' || !path.isAbsolute(argv[1]) || argv[1].split(/[\\/]+/u).includes('..')) {
    throw new Error('usage: fleet.mjs compile [--output /absolute/path]');
  }
  return path.resolve(argv[1]);
}

export async function main(argv = process.argv.slice(2)) {
  installOfflineGuards();
  const [command, ...rest] = argv;
  try {
    if (command !== 'validate' && command !== 'compile') throw new Error('usage: fleet.mjs validate|compile [--output /absolute/path]');
    if (command === 'validate' && rest.length > 0) throw new Error('usage: fleet.mjs validate');
    const entries = await scenarioEntries();
    if (entries.length === 0) throw new Error('scenario fleet is empty');
    const validation = await validateFleet(entries);
    if (validation.diagnostics.length > 0) {
      process.stdout.write(deterministicJson({ command, diagnostics: validation.diagnostics, valid: false }));
      return 1;
    }
    if (command === 'validate') {
      process.stdout.write(deterministicJson({ command, diagnostics: [], scenarios: validation.scenarios, valid: true }));
      return 0;
    }
    const outputRoot = parseOutput(rest);
    await ensureOutputRoot(outputRoot, entries.map((entry) => entry.directoryName));
    const compiled = [];
    for (const entry of entries) {
      const result = worldV2.compileScenarioV3(entry.input);
      const manifest = await publishCompiledScenario(path.join(outputRoot, entry.directoryName), result);
      compiled.push({ directoryName: entry.directoryName, scenarioId: result.seed.id, seedChecksum: manifest.seedChecksum });
    }
    process.stdout.write(deterministicJson({ command, compiled, diagnostics: [], outputRoot, valid: true }));
    return 0;
  } catch (error) {
    process.stdout.write(deterministicJson({
      command: command ?? '', diagnostics: [{ code: 'fleet.failure', path: '', message: error instanceof Error ? error.message : String(error) }], valid: false,
    }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
