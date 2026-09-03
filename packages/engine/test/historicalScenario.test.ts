import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  compileHistoricalProjection,
  initState,
  populationWeightedInfrastructureBp,
  startingStateValueChecksum,
} from '../src/index.js';

const root = join(import.meta.dirname, '../../../data-packs/fixtures/europe-1935-benchmark');
const json = (relative: string) => JSON.parse(readFileSync(join(root, relative), 'utf8'));
const input = () => ({
  bundle: { manifest: json('manifest.json'), scenario: json('scenario.json'), sources: json('sources.json') },
  authoring: json('authoring.json'), engineScenario: json('engine/scenario.json'), mapLink: json('engine/map-link.json'),
});

test('Europe 1935 ScenarioV2 compiles deterministically to its checked engine projection', () => {
  const first = compileHistoricalProjection(input());
  const second = compileHistoricalProjection(input());
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.scenario.scenarioId, 'scenario:europe-1935-benchmark');
  assert.equal(first.scenario.polities.length, 11);
  assert.equal(first.scenario.regions.length, 115);
  assert.equal(input().bundle.manifest.contentVersion, '1.0.0');
  assert.equal(first.scenario.startMonth, '1935-01-01');
  assert.equal(first.scenario.campaign?.softHorizonMonth, '1940-07-01');
  assert.deepEqual(first.scenario.diplomacy?.startingAgreements?.map((entry) => entry.agreementId), [
    'agreement:france-czechoslovakia-1924',
    'agreement:france-poland-1921',
  ]);
  assert.equal(first.mapLink?.regions.length, 115);
  assert.deepEqual(first.scenario.polities.filter((entry) => entry.decisionMode === 'inert').map((entry) => entry.id), [
    'polity:free-city-of-danzig',
    'polity:saargebiet',
  ]);
  const state = initState(first.scenario);
  assert.equal(state.label, 'historical-projection');
  assert.equal(state.diplomacy?.agreements.length, 2);
});

test('historical authoring uses a population-weighted infrastructure index and rejects schema v2', () => {
  assert.equal(populationWeightedInfrastructureBp([
    { population: 3, infrastructureBp: 5000 },
    { population: 1, infrastructureBp: 1000 },
  ]), 4000);
  assert.equal(populationWeightedInfrastructureBp([{ population: 0, infrastructureBp: 9000 }]), 0);
  assert.throws(() => populationWeightedInfrastructureBp([{ population: 1, infrastructureBp: 10001 }]), /outside/);
  const legacy = input();
  legacy.authoring.schemaVersion = 'open-historia-historical-authoring/2';
  assert.throws(() => compileHistoricalProjection(legacy), /open-historia-historical-authoring\/3/);
});

test('historical compiler rejects ownership, national-total and unknown-ID drift', () => {
  const ownership = input(); ownership.engineScenario.regions[0].controllerId = 'polity:france';
  assert.throws(() => compileHistoricalProjection(ownership), /ownership mismatch/);
  const total = input(); total.authoring.nationalControls[0].population += 1;
  assert.throws(() => compileHistoricalProjection(total), /national totals mismatch/);
  const unknown = input(); unknown.authoring.regionalControls[0].regionId = 'region:benchmark-1:UNKNOWN';
  assert.throws(() => compileHistoricalProjection(unknown), /region ids do not match/);
});

test('historical compiler binds starting-state provenance to an exact engine value', () => {
  const sourced = input();
  const goal = sourced.engineScenario.campaign.goals[0];
  sourced.authoring.startingStateProvenance = [{
    claimId: 'starting-state-claim:germany-primary-goal',
    scenarioPath: '/campaign/goals/0',
    valueChecksum: startingStateValueChecksum(goal),
    basis: 'source-derived',
    sourceRefs: ['source:europe-1935-benchmark:league-yearbook'],
    method: 'Fixture claim used to prove exact-value binding.',
    confidence: 'low',
    todo: 'Replace the benchmark source with a table-level political source.',
  }];
  assert.doesNotThrow(() => compileHistoricalProjection(sourced));

  const drifted = structuredClone(sourced);
  drifted.engineScenario.campaign.goals[0].initiallyActive = false;
  assert.throws(() => compileHistoricalProjection(drifted), /provenance checksum mismatch/);

  const duplicate = structuredClone(sourced);
  duplicate.authoring.startingStateProvenance.push({
    ...duplicate.authoring.startingStateProvenance[0],
    claimId: 'starting-state-claim:duplicate-path',
  });
  assert.throws(() => compileHistoricalProjection(duplicate), /duplicate starting-state provenance path/);

  const missingSource = structuredClone(sourced);
  missingSource.authoring.startingStateProvenance[0].sourceRefs = [];
  assert.throws(() => compileHistoricalProjection(missingSource), /source-derived starting-state claim requires a source/);
});
