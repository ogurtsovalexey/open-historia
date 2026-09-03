import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';

let temp;
const script = path.resolve('scripts/strategic-gate0.mjs');
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], {
  cwd: path.resolve('.'), encoding: 'utf8',
  env: { ...process.env, CAMPAIGN_LAB_RUNS_DIR: temp, OPENAI_API_KEY: '', GEMINI_API_KEY: '' },
}));

before(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-gate0-')); });
after(() => { fs.rmSync(temp, { recursive: true, force: true }); });

test('production Gate 0 mock freezes twelve single-actor V4 packages without model calls', () => {
  const result = run('run', '--mode', 'mock', '--run', 'gate0-mock');
  assert.equal(result.status, 'mock-pass');
  assert.equal(result.completedModelTurns, 0);
  assert.equal(result.probes.length, 12);
  assert.equal(new Set(result.probes.map((entry) => entry.probeId)).size, 12);

  for (const [index, probe] of result.probes.entries()) {
    const directory = path.join(temp, 'gate0-mock', `${String(index + 1).padStart(2, '0')}-${probe.probeId}`);
    const brief = JSON.parse(fs.readFileSync(path.join(directory, 'brief.json'), 'utf8'));
    const schema = JSON.parse(fs.readFileSync(path.join(directory, 'output-schema.json'), 'utf8'));
    const validation = JSON.parse(fs.readFileSync(path.join(directory, 'validation.json'), 'utf8'));
    const prompt = fs.readFileSync(path.join(directory, 'prompt.txt'), 'utf8');
    assert.equal(brief.schemaVersion, 'open-historia-strategic-brief/4');
    assert.equal(brief.promptContract, 'StrategicBriefV4+StrategicDecisionV3');
    assert.equal(brief.actor.id, probe.polityId);
    assert.deepEqual(schema.properties.polityId.enum, [probe.polityId]);
    assert.deepEqual(schema.properties.revision.enum, [brief.revision]);
    assert.ok(brief.inputTokenCount <= 8000);
    assert.match(prompt, /\[CANDIDATE_AUDIT\]/);
    assert.match(prompt, /\[FROZEN_CHOICES\]/);
    assert.equal(validation.resolution.status, 'accepted');
    assert.equal(validation.stateMutated, false);
  }

  const polandThreat = JSON.parse(fs.readFileSync(path.join(temp, 'gate0-mock', '11-poland-real-threat', 'validation.json'), 'utf8'));
  assert.ok(polandThreat.selectedFamilies.some((family) => ['mobilize', 'issue-order', 'negotiate-peace'].includes(family)));
  const mobilization = JSON.parse(fs.readFileSync(path.join(temp, 'gate0-mock', '12-poland-mobilization', 'validation.json'), 'utf8'));
  assert.deepEqual(mobilization.selectedFamilies, ['mobilize']);
});

test('production Gate 0 rejects old manifests and prompt snapshots are reproducible', () => {
  const first = run('run', '--mode', 'mock', '--run', 'gate0-repeat-a');
  const second = run('run', '--mode', 'mock', '--run', 'gate0-repeat-b');
  assert.equal(first.packageChecksum, second.packageChecksum);
  fs.mkdirSync(path.join(temp, 'legacy-v2'));
  fs.writeFileSync(path.join(temp, 'legacy-v2', 'manifest.json'), JSON.stringify({
    schemaVersion: 'open-historia-campaign-lab-run/2', promptContract: 'StrategicDecisionV2',
  }));
  assert.throws(() => run('resume', '--run', 'legacy-v2'), /incompatible strategic run/);
});

test('production Gate 0 can run an explicit unique probe subset without reordering it', () => {
  const result = run('run', '--mode', 'mock', '--run', 'gate0-subset', '--only', 'czech-reject,poland-mobilization');
  assert.deepEqual(result.probes.map((entry) => entry.probeId), ['czech-reject', 'poland-mobilization']);
  assert.throws(() => run('run', '--mode', 'mock', '--run', 'gate0-bad-subset', '--only', 'unknown'), /unknown Gate 0 probe/);
});
