import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startingStateValueChecksum } from '@open-historia/engine';
import { fileURLToPath } from 'node:url';
import {
  AUTHORED_COMMITMENT_EXPECTATIONS,
  STARTING_STATE_PROVENANCE_COLLECTIONS,
  auditStartingStateProvenance,
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
  assert(STARTING_STATE_PROVENANCE_COLLECTIONS.includes('/politics/characters'));
  assert.equal(audit.provenance.totalRows > 0, true);
  assert.equal(audit.provenance.coveredRows, 0);
  assert.equal(audit.issues.filter((entry) => entry.code === 'starting-state-provenance-missing').length,
    audit.provenance.totalRows);
  assert.match(renderOwnerTable(audit), /Starting-state provenance: \*\*0\//);
  assert.match(renderOwnerTable(audit), /production-derived diagnostic table/);

  const incompletePolitics = structuredClone(fixture);
  incompletePolitics.engineScenario.politics = {
    polities: [{ polityId: 'polity:france' }], factions: [], characters: [],
  };
  const politicsAudit = buildStartingStateAudit({ ...incompletePolitics, firstMonth: audit.firstMonth });
  assert.equal(politicsAudit.issues.some((entry) => entry.code === 'strategic-authority-incomplete'
    && entry.path === '/polities/polity:france/politics/strategyAuthority'), true);
  assert.equal(politicsAudit.polities.find((entry) => entry.polityId === 'polity:france').government, false);

  const withAgreements = structuredClone(fixture);
  withAgreements.engineScenario.diplomacy.startingAgreements = AUTHORED_COMMITMENT_EXPECTATIONS.map((entry) => ({
    agreementId: `agreement:audit-${entry.commitmentId.split(':').at(-1)}`,
    sourceProposalId: `proposal:audit-${entry.commitmentId.split(':').at(-1)}`,
    acceptedMonth: '1935-01-01',
    terms: {
      kind: 'agreement', agreementType: entry.agreementType,
      fromPolityId: entry.polityIds[0], toPolityId: entry.polityIds[1],
    },
  }));
  const agreementAudit = buildStartingStateAudit({ ...withAgreements, firstMonth: audit.firstMonth });
  assert.equal(agreementAudit.issues.some((entry) => entry.code === 'executable-agreement-missing'), false);

  const oneValue = fixture.engineScenario.campaign.goals[0];
  const oneClaim = structuredClone(fixture.authoring);
  oneClaim.startingStateProvenance = [{
    claimId: 'starting-state-claim:test-goal',
    scenarioPath: '/campaign/goals/0',
    valueChecksum: startingStateValueChecksum(oneValue),
    basis: 'authored-estimate', sourceRefs: [], method: 'test', confidence: 'low', todo: 'replace',
  }];
  const provenance = auditStartingStateProvenance(fixture.engineScenario, oneClaim);
  assert.equal(provenance.coveredRows, 1);
});
