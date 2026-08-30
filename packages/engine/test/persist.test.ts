import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryCommandsProvider, replayRun, runCampaign } from '../src/pipeline.js';
import { parseWorldState } from '../src/state.js';
import { COMMANDS_DIR, loadScenarioRaw } from './helpers.js';

describe('persist + replay', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'oh-engine-test-'));
  after(() => rmSync(workDir, { recursive: true, force: true }));

  it('persists a 3-turn run and replays it byte-identically', () => {
    const runDir = join(workDir, 'run-a');
    const campaign = runCampaign({
      scenarioRaw: loadScenarioRaw(),
      turns: 3,
      commandsFor: directoryCommandsProvider(COMMANDS_DIR),
      outDir: runDir,
    });

    // Turn directories with the full artifact set.
    for (const turn of [1, 2, 3]) {
      const dir = join(runDir, `turn-00${turn}`);
      for (const name of ['state.json', 'events.json', 'ledger.json', 'commands.json', 'report.md', 'manifest.json']) {
        assert.ok(existsSync(join(dir, name)), `${dir}/${name} exists`);
      }
      assert.ok(!existsSync(join(runDir, `.staging-turn-00${turn}`)), 'no staging leftovers');
    }

    // Persisted state parses and its recorded revision matches its content.
    const persisted = parseWorldState(JSON.parse(readFileSync(join(runDir, 'turn-003', 'state.json'), 'utf8')));
    assert.strictEqual(persisted.revision, campaign.finalState.revision);

    // Manifest chain links base revisions.
    const manifest2 = JSON.parse(readFileSync(join(runDir, 'turn-002', 'manifest.json'), 'utf8'));
    assert.strictEqual(manifest2.baseRevision, campaign.revisions[1]);
    assert.strictEqual(manifest2.revision, campaign.revisions[2]);
    assert.ok(typeof manifest2.committedAt === 'string');

    // Standalone replay from the run directory reproduces every revision.
    const replay = replayRun(runDir);
    assert.deepStrictEqual(replay.mismatches, []);
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.turnsReplayed, 3);
  });

  it('two runs with the same inputs produce identical revision chains', () => {
    const a = runCampaign({ scenarioRaw: loadScenarioRaw(), turns: 4, commandsFor: directoryCommandsProvider(COMMANDS_DIR) });
    const b = runCampaign({ scenarioRaw: loadScenarioRaw(), turns: 4, commandsFor: directoryCommandsProvider(COMMANDS_DIR) });
    assert.deepStrictEqual(a.revisions, b.revisions);
  });
});
