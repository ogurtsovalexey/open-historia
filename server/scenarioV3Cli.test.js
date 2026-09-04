import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { minimalScenarioV3 } from '../packages/data-packs/dist-test/test/scenarioV3Fixtures.js';

const ROOT = path.resolve('.');
const VALIDATE = path.join(ROOT, 'scripts/scenarios/validate.mjs');
const COMPILE = path.join(ROOT, 'scripts/scenarios/compile.mjs');
let temporary;

before(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-scenario-cli-')); });
after(() => { fs.rmSync(temporary, { recursive: true, force: true }); });

function writeScenario(name, value) {
  const file = path.join(temporary, name);
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
  return file;
}

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HTTP_PROXY: 'http://127.0.0.1:1',
      HTTPS_PROXY: 'http://127.0.0.1:1',
      NO_PROXY: '',
    },
  });
  assert.strictEqual(result.signal, null, result.stderr);
  assert.strictEqual(result.stderr, '');
  return { ...result, json: JSON.parse(result.stdout) };
}

function directoryBytes(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((name) => [
    name,
    fs.readFileSync(path.join(directory, name), 'utf8'),
  ]));
}

describe('ScenarioV3 offline CLI', () => {
  it('reports deterministic validation JSON and documented exit codes', () => {
    const validPath = writeScenario('valid.json', minimalScenarioV3());
    const first = run(VALIDATE, ['--input', validPath]);
    const repeated = run(VALIDATE, ['--input', validPath]);
    assert.strictEqual(first.status, 0);
    assert.deepStrictEqual(first.json, { command: 'validate', diagnostics: [], valid: true });
    assert.strictEqual(first.stdout, repeated.stdout);

    const usage = run(VALIDATE, []);
    assert.strictEqual(usage.status, 2);
    assert.strictEqual(usage.json.diagnostics[0].code, 'cli.usage');

    const invalid = minimalScenarioV3();
    invalid.startingState.regions['region:test:A'].legalOwnerPolityId = 'polity:missing';
    const invalidPath = writeScenario('invalid.json', invalid);
    const rejected = run(VALIDATE, ['--input', invalidPath]);
    assert.strictEqual(rejected.status, 1);
    assert.ok(rejected.json.diagnostics.some((entry) => (
      entry.path === '/startingState/regions/region:test:A/legalOwnerPolityId'
    )));
  });

  it('publishes four deterministic artifacts atomically and repeats byte-identically', () => {
    const input = writeScenario('compile-valid.json', minimalScenarioV3());
    const output = path.join(temporary, 'compiled');
    const first = run(COMPILE, ['--input', input, '--output', output]);
    assert.strictEqual(first.status, 0, first.stdout);
    assert.deepStrictEqual(first.json.writtenFiles, [
      'initial-state.json', 'manifest.json', 'runtime-projection.json', 'world-seed.json',
    ]);
    const before = directoryBytes(output);
    assert.deepStrictEqual(Object.keys(before), [
      'initial-state.json', 'manifest.json', 'runtime-projection.json', 'world-seed.json',
    ]);
    const manifest = JSON.parse(before['manifest.json']);
    assert.match(manifest.bundleChecksum, /^sha256:[a-f0-9]{64}$/);
    assert.match(manifest.seedChecksum, /^sha256:[a-f0-9]{64}$/);
    assert.match(manifest.runtimeProjectionChecksum, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(JSON.parse(before['world-seed.json']).schemaVersion, 'open-historia-world-seed/2');

    const second = run(COMPILE, ['--input', input, '--output', output]);
    assert.strictEqual(second.status, 0, second.stdout);
    assert.deepStrictEqual(directoryBytes(output), before);
    assert.strictEqual(second.stdout, first.stdout);
    assert.deepStrictEqual(
      fs.readdirSync(temporary).filter((name) => name.includes('.compiled.tmp-') || name.includes('.compiled.backup-')),
      [],
    );
  });

  it('never overwrites output for invalid input or an unowned existing directory', () => {
    const invalid = minimalScenarioV3();
    invalid.modules.enabled = ['module:missing'];
    const invalidPath = writeScenario('compile-invalid.json', invalid);
    const output = path.join(temporary, 'preserved');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'sentinel.txt'), 'keep-me\n');
    const before = directoryBytes(output);
    const rejected = run(COMPILE, ['--input', invalidPath, '--output', output]);
    assert.strictEqual(rejected.status, 1);
    assert.deepStrictEqual(directoryBytes(output), before);

    const validPath = writeScenario('compile-valid-unowned.json', minimalScenarioV3());
    const unowned = run(COMPILE, ['--input', validPath, '--output', output]);
    assert.strictEqual(unowned.status, 1);
    assert.match(unowned.json.diagnostics[0].message, /refusing to replace/i);
    assert.deepStrictEqual(directoryBytes(output), before);
  });

  it('rejects forged ownership markers, extra files and symlink artifacts', () => {
    const input = writeScenario('compile-forged.json', minimalScenarioV3());
    const marker = {
      schemaVersion: 'open-historia-compiled-scenario/1',
      generatedBy: 'open-historia-scenario-v3-cli',
      artifacts: {
        initialState: 'initial-state.json',
        runtimeProjection: 'runtime-projection.json',
        seed: 'world-seed.json',
      },
    };
    const forged = path.join(temporary, 'forged');
    fs.mkdirSync(forged);
    for (const name of ['initial-state.json', 'runtime-projection.json', 'world-seed.json']) {
      fs.writeFileSync(path.join(forged, name), '{}\n');
    }
    fs.writeFileSync(path.join(forged, 'manifest.json'), JSON.stringify(marker));
    fs.writeFileSync(path.join(forged, 'sentinel.txt'), 'keep-me\n');
    const forgedBefore = directoryBytes(forged);
    const forgedResult = run(COMPILE, ['--input', input, '--output', forged]);
    assert.strictEqual(forgedResult.status, 1);
    assert.deepStrictEqual(directoryBytes(forged), forgedBefore);

    const linked = path.join(temporary, 'linked');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, 'initial-state.json'), '{}\n');
    fs.writeFileSync(path.join(linked, 'runtime-projection.json'), '{}\n');
    fs.writeFileSync(path.join(linked, 'manifest.json'), JSON.stringify(marker));
    fs.symlinkSync(input, path.join(linked, 'world-seed.json'));
    const linkedResult = run(COMPILE, ['--input', input, '--output', linked]);
    assert.strictEqual(linkedResult.status, 1);
    assert.strictEqual(fs.lstatSync(path.join(linked, 'world-seed.json')).isSymbolicLink(), true);
    assert.strictEqual(fs.readlinkSync(path.join(linked, 'world-seed.json')), input);
  });

  it('rejects relative and traversing output paths before writing', () => {
    const input = writeScenario('unsafe-path.json', minimalScenarioV3());
    const relative = run(COMPILE, ['--input', input, '--output', 'build/scenario-output']);
    assert.strictEqual(relative.status, 2);
    assert.match(relative.json.diagnostics[0].message, /must be absolute/i);

    const traversing = `${temporary}/safe/../escaped`;
    const traversal = run(COMPILE, ['--input', input, '--output', traversing]);
    assert.strictEqual(traversal.status, 2);
    assert.match(traversal.json.diagnostics[0].message, /traversal/i);
    assert.strictEqual(fs.existsSync(path.join(temporary, 'escaped')), false);
  });
});
