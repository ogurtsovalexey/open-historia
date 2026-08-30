/**
 * Campaign orchestration: scenario → N monthly turns → persisted run directory,
 * plus standalone replay verification (same inputs must reproduce every
 * revision byte-identically).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_TURN_COMMANDS, parseTurnCommands } from './commands.js';
import type { TurnCommandsFile } from './commands.js';
import { parseScenario } from './scenario.js';
import { initState } from './state.js';
import type { EconWorldState } from './state.js';
import { resolveMonth } from './tick.js';
import type { TurnResult } from './tick.js';
import { renderReport } from './report.js';
import { turnDirName, writeRunHeader, writeTurnResult } from './persist.js';

export interface CompletedTurn {
  result: TurnResult;
  report: string;
  baseRevision: string;
}

export type CommandsProvider = (turn: number) => TurnCommandsFile;

/** Reads fixtures/commands/turn-NNN.json; a missing file means an empty turn. */
export function directoryCommandsProvider(dir: string | undefined): CommandsProvider {
  return (turn: number) => {
    if (!dir) return EMPTY_TURN_COMMANDS;
    const file = join(dir, `${turnDirName(turn)}.json`);
    if (!existsSync(file)) return EMPTY_TURN_COMMANDS;
    return parseTurnCommands(JSON.parse(readFileSync(file, 'utf8')));
  };
}

export function runTurn(state: EconWorldState, commands: TurnCommandsFile): CompletedTurn {
  const result = resolveMonth(state, commands);
  const report = renderReport(state, result.state, result.ledger, result.events, result.rejections);
  return { result, report, baseRevision: state.revision };
}

export interface CampaignOptions {
  scenarioRaw: unknown;
  turns: number;
  commandsFor: CommandsProvider;
  /** When set, every turn is persisted into this run directory. */
  outDir?: string;
  onTurn?: (turn: CompletedTurn) => void;
}

export interface CampaignResult {
  initialState: EconWorldState;
  finalState: EconWorldState;
  turns: CompletedTurn[];
  /** Revision chain: initial revision followed by one revision per turn. */
  revisions: string[];
}

export function runCampaign(options: CampaignOptions): CampaignResult {
  const scenario = parseScenario(options.scenarioRaw);
  const initialState = initState(scenario);
  if (options.outDir) writeRunHeader(options.outDir, options.scenarioRaw);

  let state = initialState;
  const turns: CompletedTurn[] = [];
  const revisions: string[] = [initialState.revision];
  for (let turn = 1; turn <= options.turns; turn += 1) {
    const commands = options.commandsFor(turn);
    const completed = runTurn(state, commands);
    turns.push(completed);
    revisions.push(completed.result.state.revision);
    if (options.outDir) {
      writeTurnResult(options.outDir, {
        turn: completed.result.state.turn,
        month: completed.result.ledger.month,
        baseRevision: completed.baseRevision,
        state: completed.result.state,
        events: completed.result.events,
        ledger: completed.result.ledger,
        report: completed.report,
        commands,
      });
    }
    options.onTurn?.(completed);
    state = completed.result.state;
  }
  return { initialState, finalState: state, turns, revisions };
}

export interface ReplayMismatch {
  turn: number;
  field: string;
  recorded: string;
  recomputed: string;
}

export interface ReplayResult {
  ok: boolean;
  turnsReplayed: number;
  mismatches: ReplayMismatch[];
}

/** Re-run a persisted run directory from its own scenario + recorded commands. */
export function replayRun(runDir: string): ReplayResult {
  const scenarioRaw = JSON.parse(readFileSync(join(runDir, 'scenario.json'), 'utf8'));
  const turnDirs = readdirSync(runDir)
    .filter((name) => /^turn-\d{3}$/.test(name))
    .sort();
  const mismatches: ReplayMismatch[] = [];

  const commandsFor: CommandsProvider = (turn) => {
    const file = join(runDir, turnDirName(turn), 'commands.json');
    if (!existsSync(file)) return EMPTY_TURN_COMMANDS;
    return parseTurnCommands(JSON.parse(readFileSync(file, 'utf8')));
  };

  const campaign = runCampaign({ scenarioRaw, turns: turnDirs.length, commandsFor });
  for (const [index, dirName] of turnDirs.entries()) {
    const manifest = JSON.parse(readFileSync(join(runDir, dirName, 'manifest.json'), 'utf8')) as {
      revision: string;
      baseRevision: string;
    };
    const completed = campaign.turns[index];
    if (manifest.revision !== completed.result.state.revision) {
      mismatches.push({
        turn: index + 1,
        field: 'revision',
        recorded: manifest.revision,
        recomputed: completed.result.state.revision,
      });
    }
    if (manifest.baseRevision !== completed.baseRevision) {
      mismatches.push({
        turn: index + 1,
        field: 'baseRevision',
        recorded: manifest.baseRevision,
        recomputed: completed.baseRevision,
      });
    }
  }
  return { ok: mismatches.length === 0, turnsReplayed: turnDirs.length, mismatches };
}
