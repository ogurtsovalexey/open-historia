#!/usr/bin/env node
import { scenarioV3 } from '@open-historia/data-packs';
import { pathToFileURL } from 'node:url';
import { CliUsageError, EXIT_INVALID, EXIT_USAGE, parseFlags, resolveInputPath } from './lib/cli.mjs';
import { errorDiagnostic, readJsonFile, writeJsonLine } from './lib/io.mjs';
import { installOfflineGuards } from './lib/offline.mjs';

export async function main(argv = process.argv.slice(2)) {
  installOfflineGuards();
  try {
    const args = parseFlags(argv, ['input']);
    const input = await readJsonFile(resolveInputPath(args.input));
    const validation = scenarioV3.validateScenarioV3(input);
    writeJsonLine(process.stdout, { command: 'validate', diagnostics: validation.errors, valid: validation.valid });
    return validation.valid ? 0 : EXIT_INVALID;
  } catch (error) {
    const usage = error instanceof CliUsageError;
    writeJsonLine(process.stdout, {
      command: 'validate',
      diagnostics: usage
        ? [{ code: 'cli.usage', path: '', message: error.message }]
        : errorDiagnostic(error),
      valid: false,
    });
    return usage ? EXIT_USAGE : EXIT_INVALID;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
