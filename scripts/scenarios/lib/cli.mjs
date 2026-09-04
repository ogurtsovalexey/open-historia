import path from 'node:path';

export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export function parseFlags(argv, required) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new CliUsageError('arguments must be --name value pairs');
    }
    const name = flag.slice(2);
    if (!required.includes(name)) throw new CliUsageError(`unknown argument --${name}`);
    if (Object.prototype.hasOwnProperty.call(values, name)) throw new CliUsageError(`duplicate argument --${name}`);
    values[name] = value;
  }
  for (const name of required) {
    if (!values[name]) throw new CliUsageError(`missing required argument --${name}`);
  }
  return values;
}

export function resolveInputPath(value) {
  if (value.includes('\0')) throw new CliUsageError('input path contains a null byte');
  return path.resolve(value);
}

export function resolveSafeOutputPath(value, inputPath) {
  if (value.includes('\0')) throw new CliUsageError('output path contains a null byte');
  if (!path.isAbsolute(value)) throw new CliUsageError('output path must be absolute');
  if (value.split(/[\\/]+/u).includes('..')) throw new CliUsageError('output path traversal is forbidden');
  const outputPath = path.resolve(value);
  const root = path.parse(outputPath).root;
  if (outputPath === root || outputPath === path.resolve('.') || outputPath === path.dirname(inputPath)) {
    throw new CliUsageError('output path targets an unsafe broad directory');
  }
  const relativeInput = path.relative(outputPath, inputPath);
  if (relativeInput === '' || (!relativeInput.startsWith('..') && !path.isAbsolute(relativeInput))) {
    throw new CliUsageError('output directory cannot contain the input scenario');
  }
  if (outputPath === inputPath) throw new CliUsageError('output path cannot equal input path');
  return outputPath;
}

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliUsageError';
  }
}
