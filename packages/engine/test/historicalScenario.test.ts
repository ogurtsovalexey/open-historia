import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { compileHistoricalProjection, initState } from '../src/index.js';

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
  assert.equal(first.scenario.polities.length, 9);
  assert.equal(first.scenario.startMonth, '1935-01-01');
  assert.equal(first.scenario.campaign?.softHorizonMonth, '1940-07-01');
  assert.equal(first.mapLink?.regions.find((entry) => entry.engineRegionId === 'region:benchmark-1:DE')?.mapRegionIds.length, 3);
  assert.equal(initState(first.scenario).label, 'historical-projection');
});

test('historical compiler rejects ownership, national-total and unknown-ID drift', () => {
  const ownership = input(); ownership.engineScenario.regions[0].controllerId = 'polity:france';
  assert.throws(() => compileHistoricalProjection(ownership), /ownership mismatch/);
  const total = input(); total.authoring.nationalControls[0].population += 1;
  assert.throws(() => compileHistoricalProjection(total), /national totals mismatch/);
  const unknown = input(); unknown.authoring.regionalControls[0].regionId = 'region:benchmark-1:UNKNOWN';
  assert.throws(() => compileHistoricalProjection(unknown), /region ids do not match/);
});
