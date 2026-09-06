import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/prepare-live-playtest-data.mjs');

test('live playtest preparation seeds once and preserves later evidence', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-live-playtest-'));
  try {
    const env = { ...process.env, OH_PLAYTEST_DATA_DIR: target };
    execFileSync(process.execPath, [script], { cwd: path.resolve('.'), env, stdio: 'pipe' });
    assert.equal(fs.existsSync(path.join(target, 'scenarios')), true);
    const evidence = path.join(target, 'games', 'saved-ui-evidence.json');
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, '{"preserved":true}');

    execFileSync(process.execPath, [script], { cwd: path.resolve('.'), env, stdio: 'pipe' });
    assert.equal(fs.readFileSync(evidence, 'utf8'), '{"preserved":true}');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
