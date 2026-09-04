#!/usr/bin/env node
import { worldV2 } from '@open-historia/engine';
import { pathToFileURL } from 'node:url';
import {
  CliUsageError,
  EXIT_INVALID,
  EXIT_USAGE,
  parseFlags,
  resolveInputPath,
  resolveSafeOutputPath,
} from './lib/cli.mjs';
import { errorDiagnostic, readJsonFile, writeJsonLine } from './lib/io.mjs';
import { installOfflineGuards } from './lib/offline.mjs';
import { publishCompiledScenario } from './lib/publish.mjs';

export async function main(argv = process.argv.slice(2)) {
  installOfflineGuards();
  try {
    const args = parseFlags(argv, ['input', 'output']);
    const inputPath = resolveInputPath(args.input);
    const outputPath = resolveSafeOutputPath(args.output, inputPath);
    const input = await readJsonFile(inputPath);
    const compiled = worldV2.compileScenarioV3(input);
    const manifest = await publishCompiledScenario(outputPath, compiled);
    writeJsonLine(process.stdout, {
      command: 'compile',
      diagnostics: compiled.diagnostics,
      manifest,
      valid: true,
      writtenFiles: ['initial-state.json', 'manifest.json', 'runtime-projection.json', 'world-seed.json'],
    });
    return 0;
  } catch (error) {
    const usage = error instanceof CliUsageError;
    writeJsonLine(process.stdout, {
      command: 'compile',
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
