import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { listCompiledScenarioPacks, loadCompiledScenarioPack } from './scenarioPackStore.js';

const ROOT = path.resolve('.');
const FLEET = path.join(ROOT, 'scripts/scenarios/fleet.mjs');
let temporary;

before(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-fleet-')); });
after(() => { fs.rmSync(temporary, { recursive: true, force: true }); });

function run(args) {
  const result = spawnSync(process.execPath, [FLEET, ...args], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.signal, null, result.stderr);
  assert.strictEqual(result.stderr, '');
  return { ...result, json: JSON.parse(result.stdout) };
}

function fleetBytes(root) {
  return Object.fromEntries(fs.readdirSync(root).sort().flatMap((directory) => (
    fs.readdirSync(path.join(root, directory)).sort().map((file) => [
      `${directory}/${file}`,
      fs.readFileSync(path.join(root, directory, file), 'utf8'),
    ])
  )));
}

describe('ScenarioV3 product fleet', () => {
  it('validates exactly the three scenario-neutral product packages', () => {
    const result = run(['validate']);
    assert.strictEqual(result.status, 0, result.stdout);
    assert.strictEqual(result.json.valid, true);
    assert.deepStrictEqual(result.json.scenarios.map((entry) => entry.scenarioId), [
      'scenario:central-mesoamerica-1450',
      'scenario:europe-1935-benchmark',
      'scenario:napoleonic-europe-1805',
    ]);
  });

  it('publishes, loads and republishes the full fleet byte-identically', () => {
    const output = path.join(temporary, 'compiled');
    const first = run(['compile', '--output', output]);
    assert.strictEqual(first.status, 0, first.stdout);
    const before = fleetBytes(output);
    const listed = listCompiledScenarioPacks({ rootDirectory: output });
    assert.deepStrictEqual(listed.map((entry) => entry.scenarioId), [
      'scenario:central-mesoamerica-1450',
      'scenario:europe-1935-benchmark',
      'scenario:napoleonic-europe-1805',
    ]);
    for (const summary of listed) {
      const loaded = loadCompiledScenarioPack(summary.scenarioId, { rootDirectory: output });
      assert.strictEqual(loaded.manifest.seedChecksum, summary.seedChecksum);
      assert.strictEqual(loaded.initialState.scenarioId, summary.scenarioId);
    }
    const repeated = run(['compile', '--output', output]);
    assert.strictEqual(repeated.status, 0, repeated.stdout);
    assert.deepStrictEqual(fleetBytes(output), before);
  });

  it('refuses to mix stale or unmanaged entries into the compiled root', () => {
    const output = path.join(temporary, 'unmanaged');
    fs.mkdirSync(path.join(output, 'stale-scenario'), { recursive: true });
    fs.writeFileSync(path.join(output, 'stale-scenario', 'keep.txt'), 'preserve\n');
    const result = run(['compile', '--output', output]);
    assert.strictEqual(result.status, 1);
    assert.match(result.json.diagnostics[0].message, /stale or unmanaged/i);
    assert.strictEqual(fs.readFileSync(path.join(output, 'stale-scenario', 'keep.txt'), 'utf8'), 'preserve\n');
  });
});
