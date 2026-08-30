/**
 * Headless playtest CLI.
 *
 *   node dist/cli.js run --scenario <scenario.json> [--commands <dir>]
 *                        --turns <n> [--out <run-dir>] [--write-golden <dir>]
 *   node dist/cli.js replay --run <run-dir>
 *
 * `--write-golden` regenerates the checked-in golden fixtures; it is a
 * deliberate human action and must never run in CI.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { canonicalState } from './canonical.js';
import { directoryCommandsProvider, replayRun, runCampaign } from './pipeline.js';

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`invalid arguments near '${key ?? ''}'`);
    }
    args.set(key.slice(2), value);
  }
  return args;
}

function commandRun(args: Map<string, string>): number {
  const scenarioPath = args.get('scenario');
  const turnsText = args.get('turns');
  if (!scenarioPath || !turnsText) {
    process.stderr.write('run requires --scenario <file> and --turns <n>\n');
    return 2;
  }
  const turns = Number(turnsText);
  if (!Number.isInteger(turns) || turns < 1) {
    process.stderr.write(`--turns must be a positive integer, got ${turnsText}\n`);
    return 2;
  }
  const scenarioRaw = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  const campaign = runCampaign({
    scenarioRaw,
    turns,
    commandsFor: directoryCommandsProvider(args.get('commands')),
    outDir: args.get('out'),
    onTurn: (completed) => {
      const { state, rejections } = completed.result;
      process.stdout.write(
        `turn ${state.turn} (${completed.result.ledger.month}): revision ${state.revision.slice(0, 19)}… rejected ${rejections.length}\n`
      );
    },
  });
  process.stdout.write(`initial revision: ${campaign.initialState.revision}\n`);
  process.stdout.write(`final revision:   ${campaign.finalState.revision}\n`);
  if (args.get('out')) process.stdout.write(`run directory:    ${args.get('out')}\n`);

  const goldenDir = args.get('write-golden');
  if (goldenDir) {
    mkdirSync(goldenDir, { recursive: true });
    const firstTurn = campaign.turns[0];
    writeFileSync(join(goldenDir, 'turn-001.state.canonical.json'), `${canonicalState(firstTurn.result.state)}\n`, 'utf8');
    writeFileSync(join(goldenDir, 'turn-001.report.md'), `${firstTurn.report}\n`, 'utf8');
    const chain = campaign.revisions.map((revision, index) => ({ turn: index, revision }));
    writeFileSync(
      join(goldenDir, `campaign-${String(turns).padStart(3, '0')}.checksums.json`),
      `${JSON.stringify(chain, null, 2)}\n`,
      'utf8'
    );
    process.stdout.write(`golden fixtures written to ${goldenDir}\n`);
  }
  return 0;
}

function commandReplay(args: Map<string, string>): number {
  const runDir = args.get('run');
  if (!runDir) {
    process.stderr.write('replay requires --run <run-dir>\n');
    return 2;
  }
  const result = replayRun(runDir);
  if (result.ok) {
    process.stdout.write(`replay OK: ${result.turnsReplayed} turns reproduced byte-identically\n`);
    return 0;
  }
  process.stderr.write(`replay FAILED: ${result.mismatches.length} mismatches\n`);
  for (const mismatch of result.mismatches) {
    process.stderr.write(
      `  turn ${mismatch.turn} ${mismatch.field}: recorded ${mismatch.recorded} != recomputed ${mismatch.recomputed}\n`
    );
  }
  return 1;
}

function main(): number {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'run') return commandRun(parseArgs(rest));
    if (command === 'replay') return commandReplay(parseArgs(rest));
    process.stderr.write('usage: cli.js run|replay …\n');
    return 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = main();
