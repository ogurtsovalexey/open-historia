import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { startingStateValueChecksum } from '@open-historia/engine';
import { fileURLToPath } from 'node:url';
import { OHM_POLAND_1935 } from '../scripts/europe-1935-geography.mjs';
import {
  buildCompleteStartingState,
  verifyCompleteStartingState,
} from '../scripts/europe-1935-complete-starting-state.mjs';
import {
  AUTHORED_COMMITMENT_EXPECTATIONS,
  POLAND_1931_CENSUS,
  STARTING_STATE_PROVENANCE_COLLECTIONS,
  apportionIntegerTotal,
  auditStartingStateProvenance,
  buildFirstMonthBaseline,
  buildPoliticsCandidateAudit,
  buildPolandPopulationAllocation,
  buildPolandRegionalProjectionCandidate,
  buildStartingStateAudit,
  calculateCheckpoint,
  compareFirstMonthBaseline,
  loadFixture,
  renderOwnerTable,
} from '../scripts/europe-1935-starting-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root,
  'packages/data-packs/fixtures/europe-1935-benchmark/engine/first-month-baseline.json'), 'utf8'));

test('integer apportionment is exact, input-order independent and rejects ambiguous inputs', () => {
  const rows = [{ id: 'b', weight: 1 }, { id: 'a', weight: 1 }, { id: 'c', weight: 1 }];
  const expected = [
    { id: 'a', weight: 1, amount: 2 },
    { id: 'b', weight: 1, amount: 2 },
    { id: 'c', weight: 1, amount: 1 },
  ];
  assert.deepEqual(apportionIntegerTotal(rows, 5), expected);
  assert.deepEqual(apportionIntegerTotal(rows.toReversed(), 5), expected);
  assert.throws(() => apportionIntegerTotal([], 1), /at least one row/);
  assert.throws(() => apportionIntegerTotal([{ id: 'a', weight: 1 }, { id: 'a', weight: 2 }], 1), /duplicate/);
  assert.throws(() => apportionIntegerTotal([{ id: 'a', weight: 0 }], 1), /positive safe integer/);
  assert.throws(() => apportionIntegerTotal([{ id: 'a', weight: Number.MAX_SAFE_INTEGER }], 2), /product/);
});

test('Poland population research reconciles the GUS table and preserves the national control', () => {
  const allocation = buildPolandPopulationAllocation();
  assert.equal(allocation.rows.length, 16);
  assert.deepEqual(allocation.rows.map((row) => row.relationId).toSorted((left, right) => left - right),
    [...OHM_POLAND_1935.regionRelationIds].toSorted((left, right) => left - right));
  assert.equal(allocation.sourcePopulationTotal, 31_915_779);
  assert.equal(allocation.sourcePopulationTotal + allocation.barrackedMilitaryExcludedFromRows,
    allocation.publishedNationalPopulation);
  assert.equal(allocation.rows.reduce((total, row) => total + row.population, 0), 34_000_000);
  assert.equal(allocation.rows.find((row) => row.relationId === 2_741_469).sourcePopulation,
    2_529_228 + 1_171_898);
  assert.equal(allocation.sourceContentHash, POLAND_1931_CENSUS.sourceContentHash);
  assert.equal(allocation.checksum, 'sha256:fb3c9c75910e877eeca881afcf81e0e1335d333853af70b0ace7a723e05acce5');
});

test('Poland regional economy candidate preserves national controls and the complete first month', () => {
  const fixture = loadFixture();
  const first = buildPolandRegionalProjectionCandidate(fixture.engineScenario);
  const second = buildPolandRegionalProjectionCandidate(fixture.engineScenario);
  assert.deepEqual(first, second);
  assert.equal(first.checksum, 'sha256:00946a14b3ecbbf05138614b5b47a09c28739045934aaab29081a866f7d1c910');
  assert.equal(first.status, 'owner-approved-runtime');
  assert.equal(first.rows.length, 16);
  assert.deepEqual(first.nationalControls, {
    population: 34_000_000,
    workforce: 13_600_000,
    industrialCapacity: 88_000,
    infrastructureIndexBp: 3900,
  });
  assert.deepEqual(first.activityCapacity, { food: 44_000, coal: 26_400, goods: 17_600 });
  assert.equal(first.processingRegionCount, 1);
  assert.equal(first.rows.find((row) => row.activity.kind === 'processing').regionId,
    'region:ohm-1935:2741475');
  assert.equal(first.firstMonth.checksum, baseline.checksum);
  assert.equal(first.landAdjacency.edgeCount, 30);
  assert.equal(first.landAdjacency.checksum,
    'sha256:f23783aa4c712a80e4be8c1c3ff4969efeb29aa0a3c2944cd852b31366c4c881');
  assert.equal(first.externalSupplyLinks.length, 3);
});

test('Poland politics candidate separates offices from actual decision authority inside the atomic bundle', () => {
  const fixture = loadFixture();
  const first = buildPoliticsCandidateAudit(fixture.engineScenario, fixture.sources);
  const second = buildPoliticsCandidateAudit(fixture.engineScenario, fixture.sources);
  assert.deepEqual(first, second);
  assert.equal(first.checksum, 'sha256:44e174c641022dcc7bb61e180528856f6cfb40be174101764eae2d2bcc522955');
  assert.deepEqual(first.headOfState, { characterId: 'character:poland-moscicki', name: 'Ignacy Mościcki' });
  assert.deepEqual(first.headOfGovernment, { characterId: 'character:poland-kozlowski', name: 'Leon Kozłowski' });
  assert.deepEqual(first.decisionAuthority, { characterId: 'character:poland-pilsudski', name: 'Józef Piłsudski' });
  assert.equal(first.rulingFaction.factionId, 'faction:poland-sanacja');
  assert.equal(first.factionCount, 4);
  assert.equal(first.characterCount, 5);
  assert.equal(first.status, 'complete-bundle-pending-owner-review');
  assert.equal(fixture.engineScenario.modules.politics, true);
  assert.equal(fixture.engineScenario.politics.polities.length, 11);
  assert.throws(() => buildPoliticsCandidateAudit(fixture.engineScenario,
    fixture.sources.filter((source) => source.id !== 'source:europe-1935-benchmark:pilsudski-museum-marshal')), /unknown sources/);
});

test('Europe 1935 preserves the pinned aggregate first month after regional replacement', () => {
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

test('Europe 1935 complete starting-state gate is deterministic and ready for owner review', () => {
  const fixture = loadFixture();
  const { audit } = calculateCheckpoint(fixture, baseline);
  const again = buildStartingStateAudit({ ...fixture, firstMonth: audit.firstMonth });
  assert.deepEqual(audit, again);
  assert.equal(audit.gate.status, 'ready-for-owner-review');
  assert.equal(audit.gate.blockingIssues, 0);
  assert.equal(audit.gate.supportedPolities, 7);
  assert.equal(audit.gate.baselinePolities, 4);
  assert.equal(audit.generatedFrom.manifestContentVersion, '1.0.0');
  assert.equal(audit.issues.some((entry) => entry.code === 'major-content-version-pending'), false);
  assert.equal(audit.firstMonth.matches, true);
  assert.equal(audit.polities.filter((entry) => entry.fidelity === 'Supported').every((entry) => entry.controls.matches), true);
  assert.equal(audit.polities.filter((entry) => entry.fidelity === 'Supported')
    .every((entry) => entry.regionCount >= 10 && entry.regionCount <= 25), true);
  assert.equal(audit.inertPolities.every((entry) => entry.present), true);
  assert.equal(audit.issues.filter((entry) => entry.code === 'formation-missing').length, 0);
  assert.equal(audit.issues.filter((entry) => entry.code === 'commander-missing').length, 0);
  assert.equal(audit.issues.filter((entry) => entry.code === 'goal-conflicts-with-existing-commitment').length, 0);
  assert.equal(audit.issues.filter((entry) => entry.code === 'executable-agreement-missing').length, 0);
  assert(STARTING_STATE_PROVENANCE_COLLECTIONS.includes('/politics/characters'));
  assert.equal(audit.provenance.totalRows > 0, true);
  assert.equal(audit.provenance.totalRows, 571);
  assert.equal(audit.provenance.coveredRows, audit.provenance.totalRows);
  assert.equal(audit.provenance.missingRows, 0);
  assert.equal(audit.provenance.checksumMismatches, 0);
  assert.equal(audit.regionalResearch.population[0].rows.length, 16);
  assert.equal(audit.regionalResearch.population[0].targetPopulation, 34_000_000);
  assert.equal(audit.regionalResearch.projectionCandidates[0].firstMonthComparison.matches, true);
  assert.equal(audit.politicsCandidates[0].decisionAuthority.characterId, 'character:poland-pilsudski');
  assert.equal(audit.issues.filter((entry) => entry.code === 'starting-state-provenance-missing').length,
    audit.provenance.missingRows);
  assert.match(renderOwnerTable(audit), /Starting-state provenance: \*\*571\/571\*\*/);
  assert.match(renderOwnerTable(audit), /31,915,779 source persons apportioned to exact target 34,000,000/);
  assert.match(renderOwnerTable(audit), /economy candidate: 16 regions, 1 processing region/);
  assert.match(renderOwnerTable(audit), /decision authority Józef Piłsudski; 4 factions/);
  assert.match(renderOwnerTable(audit), /checksum-bound owner checkpoint/);
  assert.match(renderOwnerTable(audit), /decision authority \*\*Józef Piłsudski\*\*/);

  const incompletePolitics = structuredClone(fixture);
  incompletePolitics.engineScenario.modules.politics = false;
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

test('complete starting-state publication is atomic, idempotent and includes a supplied German threat', () => {
  const fixture = loadFixture();
  const first = buildCompleteStartingState(fixture);
  const second = buildCompleteStartingState({ ...fixture, engineScenario: first.scenario, authoring: first.authoring, sources: first.sources });
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first.scenario.modules).sort(), [
    'armedForces', 'budget', 'campaign', 'combat', 'diplomacy', 'finance', 'intelligence',
    'politics', 'projects', 'shortages', 'societyAndIdentity', 'technology', 'trade', 'unrest',
  ]);
  assert.equal(Object.values(first.scenario.modules).every(Boolean), true);
  assert.equal(first.scenario.politics.polities.length, 11);
  assert.equal(first.scenario.statecraft.finance.length, 11);
  assert.equal(first.scenario.identity.regions.length, 116);
  assert.equal(first.scenario.identity.polities.length, 11);
  for (const polity of first.scenario.identity.polities) {
    const accepted = new Set([polity.officialCultureId, ...polity.acceptedCultureIds]);
    const controlled = new Set(first.scenario.regions.filter((entry) => entry.controllerId === polity.polityId)
      .map((entry) => entry.regionId));
    for (const region of first.scenario.identity.regions.filter((entry) => controlled.has(entry.regionId))) {
      assert(accepted.has(region.culture.primaryId));
      assert.equal(region.culture.minorities.every((entry) => accepted.has(entry.identityId)), true);
    }
  }
  assert.equal(first.scenario.identity.regions.find((entry) => entry.regionId === 'region:europe-1935:cs-slovensko')
    .culture.primaryId, 'culture:slovak');
  const sudety = first.scenario.identity.regions.find((entry) => entry.regionId === 'region:europe-1935:cs-sudety');
  assert.equal(sudety.culture.primaryId, 'culture:german');
  assert.deepEqual(sudety.culture.minorities, [{ identityId: 'culture:czech', shareBp: 1800 }]);
  assert.equal(first.scenario.identity.regions.find((entry) => entry.regionId === 'region:europe-1935:gb-northern-ireland')
    .culture.primaryId, 'culture:irish');
  assert.equal(first.scenario.military.formations.length, 7);
  assert.equal(first.scenario.campaign.goals.length, 14);
  const germanFormation = first.scenario.military.formations.find((entry) => entry.polityId === 'polity:germany');
  assert.equal(germanFormation.locationRegionId, 'region:europe-1935:de-pommern');
  assert(first.scenario.military.supplyLinks.some((entry) => entry.regions.includes(germanFormation.locationRegionId)
    && entry.regions.includes('region:ohm-1935:2741476')));
  assert.deepEqual(first.scenario.polities.filter((entry) => entry.decisionMode === 'inert').map((entry) => entry.id), [
    'polity:free-city-of-danzig', 'polity:saargebiet',
  ]);
  const verified = verifyCompleteStartingState({
    manifest: fixture.manifest,
    scenarioV2: fixture.scenario,
    mapLink: fixture.mapLink,
    expectedBaseline: baseline,
    engineScenario: fixture.engineScenario,
    authoring: fixture.authoring,
    sources: fixture.sources,
  });
  assert.equal(verified.firstMonth.checksum, baseline.checksum);
});
