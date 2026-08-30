/**
 * Turn persistence: one directory per resolved turn, written atomically
 * (staging dir + rename). The only module allowed to touch the wall clock;
 * `committedAt` lives in the manifest and is excluded from every checksum.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256OfString } from './canonical.js';
import type { EconWorldState } from './state.js';
import type { TurnLedger } from './ledger.js';
import type { EngineEvent } from './tick.js';
import type { TurnCommandsFile } from './commands.js';

export interface TurnBundle {
  turn: number;
  month: string;
  baseRevision: string;
  state: EconWorldState;
  events: EngineEvent[];
  ledger: TurnLedger;
  report: string;
  commands: TurnCommandsFile;
}

export interface TurnManifest {
  schemaVersion: 'open-historia-engine-run/1';
  turn: number;
  month: string;
  baseRevision: string;
  revision: string;
  files: Record<string, string>;
  committedAt: string;
}

export function turnDirName(turn: number): string {
  return `turn-${String(turn).padStart(3, '0')}`;
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Write scenario copy and run marker so a run directory replays standalone. */
export function writeRunHeader(runDir: string, scenarioRaw: unknown): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'scenario.json'), stringify(scenarioRaw), 'utf8');
}

export function writeTurnResult(runDir: string, bundle: TurnBundle): TurnManifest {
  const dirName = turnDirName(bundle.turn);
  const stagingDir = join(runDir, `.staging-${dirName}`);
  const finalDir = join(runDir, dirName);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  const files: Record<string, string> = {};
  const contents: Record<string, string> = {
    'state.json': stringify(bundle.state),
    'events.json': stringify(bundle.events),
    'ledger.json': stringify(bundle.ledger),
    'commands.json': stringify(bundle.commands),
    'report.md': `${bundle.report}\n`,
  };
  for (const [name, content] of Object.entries(contents)) {
    writeFileSync(join(stagingDir, name), content, 'utf8');
    files[name] = sha256OfString(content);
  }

  const manifest: TurnManifest = {
    schemaVersion: 'open-historia-engine-run/1',
    turn: bundle.turn,
    month: bundle.month,
    baseRevision: bundle.baseRevision,
    revision: bundle.state.revision,
    files,
    committedAt: new Date().toISOString(),
  };
  writeFileSync(join(stagingDir, 'manifest.json'), stringify(manifest), 'utf8');

  rmSync(finalDir, { recursive: true, force: true });
  renameSync(stagingDir, finalDir);
  return manifest;
}
