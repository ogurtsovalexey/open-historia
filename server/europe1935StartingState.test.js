import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUTHORED_COMMITMENT_EXPECTATIONS,
  buildFirstMonthBaseline,
  buildStartingStateAudit,
  calculateCheckpoint,
  compareFirstMonthBaseline,
  loadFixture,
  renderOwnerTable,
} from '../scripts/europe-1935-starting-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root,
  'packages/data-packs/fixtures/europe-1935-benchmark/engine/first-month-baseline.json'), 'utf8'));

test('Europe 1935 pins its existing first aggregate month before regional replacement', () => {
  const fixture = loadFixture();
  const first = calculateCheckpoint(fixture, baseline);
  const second = calculateCheckpoint(fixture, baseline);
  assert.deepEqual(first.actualBaseline, second.actualBaseline);
  assert.equal(first.actualBaseline.checksum, 'sha256:209d64e8a4e25fac211aa5343f276f4da1f3fa7fb4c19e5f1fad6cff9b09d9a1');
  assert.deepEqual(compareFirstMonthBaseline(baseline, first.actualBaseline), {
    matches: true,
    expectedChecksum: baseline.checksum,
    actualChecksum: baseline.checksum,
  });
  const changed = structuredClone(first.actualBaseline);
  changed.polities[0].taxTotal += 1;
  assert.equal(compareFirstMonthBaseline(baseline, changed).matches, false);
  assert.equal(buildFirstMonthBaseline({ state: { scenarioId: 'scenario:test', month: '1935-02-01' }, ledger: {
    month: '1935-01-01', turn: 1, polities: [],
  } }).scenarioId, 'scenario:test');
});

test('Europe 1935 starting-state gate reports every known foundation gap deterministically', () => {
  const fixture = loadFixture();
  const { audit } = calculateCheckpoint(fixture, baseline);
  const again = buildStartingStateAudit({ ...fixture, firstMonth: audit.firstMonth });
  assert.deepEqual(audit, again);
  assert.equal(audit.gate.status, 'blocked');
  assert.equal(audit.gate.supportedPolities, 7);
  assert.equal(audit.gate.baselinePolities, 2);
  assert.equal(audit.firstMonth.matches, true);
  assert.equal(audit.polities.filter((entry) => entry.fidelity === 'Supported').every((entry) => entry.controls.matches), true);
  assert.equal(audit.polities.filter((entry) => entry.fidelity === 'Supported').every((entry) => entry.regionCount === 1), true);
  assert.equal(audit.issues.filter((entry) => entry.code === 'formation-missing').length, 7);
  assert.equal(audit.issues.filter((entry) => entry.code === 'commander-missing').length, 7);
  assert.equal(audit.issues.filter((entry) => entry.code === 'goal-conflicts-with-existing-commitment').length, 2);
  assert.equal(audit.issues.filter((entry) => entry.code === 'executable-agreement-missing').length,
    AUTHORED_COMMITMENT_EXPECTATIONS.length);
  assert.match(renderOwnerTable(audit), /production-derived diagnostic table/);
});
