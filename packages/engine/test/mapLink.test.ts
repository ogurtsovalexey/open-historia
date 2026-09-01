import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandId, PolityId, RegionId } from '@open-historia/domain';
import {
  buildOwnershipOverrides,
  checkMapLink,
  engineRegionForMapRegion,
  mapLinkSchema,
  parseMapLink,
} from '../src/mapLink.js';
import { parseScenario } from '../src/scenario.js';
import { initState } from '../src/state.js';
import { resolveMonth } from '../src/tick.js';
import type { EconCommand } from '../src/commands.js';
import { FIXTURES_DIR } from './helpers.js';

const MAP_FIXTURE = join(FIXTURES_DIR, 'scenario-dev-map-4c');
const loadScenarioRaw = () => JSON.parse(readFileSync(join(MAP_FIXTURE, 'scenario.json'), 'utf8'));
const loadLinkRaw = () => JSON.parse(readFileSync(join(MAP_FIXTURE, 'map-link.json'), 'utf8'));

describe('map link (canon 04, "Map linkage")', () => {
  it('the checked-in map fixture and its link parse and agree', () => {
    const scenario = parseScenario(loadScenarioRaw());
    const link = parseMapLink(loadLinkRaw());
    assert.deepStrictEqual(checkMapLink(scenario, link), []);
    assert.strictEqual(scenario.regions.length, 47);
    assert.strictEqual(link.regions.length, 47);
    assert.strictEqual(link.dataset, 'gadm');
  });

  it('engine region ids encode the dataset and the real map region id', () => {
    const link = parseMapLink(loadLinkRaw());
    for (const entry of link.regions) {
      assert.strictEqual(entry.engineRegionId, `region:gadm:${entry.mapRegionIds[0]}`);
    }
    assert.ok(link.regions.some((entry) => entry.mapRegionIds.includes('AUT.3_1')));
    assert.ok(link.regions.some((entry) => entry.mapRegionIds.includes('CZE.11_1')));
    assert.ok(link.regions.some((entry) => entry.mapRegionIds.includes('DEU.3_1')));
  });

  it('rejects a link whose engine id does not match its map id', () => {
    const raw = loadLinkRaw() as { regions: Array<{ engineRegionId: string }> };
    raw.regions[0].engineRegionId = 'region:gadm:XXX.1_1';
    const result = mapLinkSchema.safeParse(raw);
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.issues.some((issue) => issue.message.includes('does not match dataset')));
  });

  it('rejects duplicate map regions and duplicate owner names', () => {
    const dupRegion = loadLinkRaw() as { regions: Array<Record<string, unknown>> };
    dupRegion.regions[1] = { ...dupRegion.regions[0] };
    assert.strictEqual(mapLinkSchema.safeParse(dupRegion).success, false);

    const dupName = loadLinkRaw() as { polityOwnerNames: Record<string, string> };
    const keys = Object.keys(dupName.polityOwnerNames);
    dupName.polityOwnerNames[keys[1]] = dupName.polityOwnerNames[keys[0]];
    assert.strictEqual(mapLinkSchema.safeParse(dupName).success, false);
  });

  it('reports a scenario region that the link forgot', () => {
    const scenario = parseScenario(loadScenarioRaw());
    const raw = loadLinkRaw() as { regions: unknown[] };
    const dropped = (raw.regions as Array<{ engineRegionId: string }>).pop()!;
    const link = parseMapLink(raw);
    assert.deepStrictEqual(checkMapLink(scenario, link), [
      { kind: 'region-not-linked', id: dropped.engineRegionId },
    ]);
  });

  it('builds the ownership projection the app renders', () => {
    const scenario = parseScenario(loadScenarioRaw());
    const link = parseMapLink(loadLinkRaw());
    const overrides = buildOwnershipOverrides(link, initState(scenario).regions);
    assert.strictEqual(Object.keys(overrides).length, 47);
    assert.strictEqual(overrides['AUT.3_1'], 'Austria');
    assert.strictEqual(overrides['CZE.11_1'], 'Czechia');
    // Real region counts per country, so a wrong aggregation shows on the map.
    const counts = Object.values(overrides).reduce<Record<string, number>>((acc, name) => {
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepStrictEqual(counts, { Austria: 9, Czechia: 14, Germany: 16, Slovakia: 8 });
  });

  it('the projection follows a transfer, so the map recolours', () => {
    const scenario = parseScenario(loadScenarioRaw());
    const link = parseMapLink(loadLinkRaw());
    const state = initState(scenario);
    const command: EconCommand = {
      kind: 'territory.transfer-region',
      commandId: '8c3f5c1e-0d2b-4d3a-9a51-000000000001' as CommandId,
      actorPolityId: 'polity:austria' as PolityId,
      targetRegionId: 'region:gadm:AUT.7_1' as RegionId,
      newControllerId: 'polity:czechia' as PolityId,
      effectiveMonth: state.month,
    };
    const result = resolveMonth(state, { commands: [command] });
    assert.deepStrictEqual(result.rejections, []);
    const overrides = buildOwnershipOverrides(link, result.state.regions);
    assert.strictEqual(overrides['AUT.7_1'], 'Czechia');
    const counts = Object.values(overrides).reduce<Record<string, number>>((acc, name) => {
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepStrictEqual(counts, { Austria: 8, Czechia: 15, Germany: 16, Slovakia: 8 });
  });

  it('resolves a map click back to an engine region', () => {
    const link = parseMapLink(loadLinkRaw());
    assert.strictEqual(engineRegionForMapRegion(link, 'CZE.2_1'), 'region:gadm:CZE.2_1');
    assert.strictEqual(engineRegionForMapRegion(link, 'FRA.1_1'), undefined);
  });

  it('v2 projects one engine macro-region onto multiple map polygons', () => {
    const raw = loadLinkRaw() as { schemaVersion: string; regions: Array<{ engineRegionId: string; mapRegionId: string; mapName?: string }> };
    const link = parseMapLink({ ...raw, schemaVersion: 'open-historia-engine-map-link/2', regions: raw.regions.map((entry, index) => ({
      engineRegionId: entry.engineRegionId,
      mapRegionIds: index === 0 ? [entry.mapRegionId, `${entry.mapRegionId}.part-2`] : [entry.mapRegionId],
      ...(entry.mapName ? { mapName: entry.mapName } : {}),
    })) });
    const scenario = parseScenario(loadScenarioRaw());
    const overrides = buildOwnershipOverrides(link, initState(scenario).regions);
    const first = raw.regions[0]!;
    assert.equal(overrides[first.mapRegionId], overrides[`${first.mapRegionId}.part-2`]);
    assert.equal(engineRegionForMapRegion(link, `${first.mapRegionId}.part-2`), first.engineRegionId);
  });

  it('the map scenario runs twelve months deterministically', () => {
    const scenario = parseScenario(loadScenarioRaw());
    let state = initState(scenario);
    const revisions: string[] = [state.revision];
    for (let month = 0; month < 12; month += 1) {
      const result = resolveMonth(state, { commands: [] });
      state = result.state;
      revisions.push(state.revision);
    }
    assert.strictEqual(state.turn, 12);
    assert.strictEqual(state.month, '1939-01-01');
    assert.strictEqual(new Set(revisions).size, revisions.length, 'every month produces a new revision');

    let replay = initState(scenario);
    for (let month = 0; month < 12; month += 1) replay = resolveMonth(replay, { commands: [] }).state;
    assert.strictEqual(replay.revision, state.revision);
  });
});
