import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario } from '../src/scenario.js';
import type { EconScenario } from '../src/scenario.js';
import { initState } from '../src/state.js';
import type { EconWorldState } from '../src/state.js';
import { parseTurnCommands } from '../src/commands.js';
import type { TurnCommandsFile } from '../src/commands.js';

/** dist-test/test → package root. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES_DIR = join(PACKAGE_ROOT, 'fixtures');
export const GOLDEN_DIR = join(PACKAGE_ROOT, 'test', 'golden');
export const SCENARIO_PATH = join(FIXTURES_DIR, 'scenario-dev-2x5', 'scenario.json');
export const COMMANDS_DIR = join(FIXTURES_DIR, 'commands');

export function loadScenarioRaw(): unknown {
  return JSON.parse(readFileSync(SCENARIO_PATH, 'utf8'));
}

export function loadScenario(): EconScenario {
  return parseScenario(loadScenarioRaw());
}

export function loadInitialState(): EconWorldState {
  return initState(loadScenario());
}

export function loadCommandsFixture(name: string): TurnCommandsFile {
  return parseTurnCommands(JSON.parse(readFileSync(join(COMMANDS_DIR, name), 'utf8')));
}

export function readGolden(name: string): string {
  return readFileSync(join(GOLDEN_DIR, name), 'utf8');
}
