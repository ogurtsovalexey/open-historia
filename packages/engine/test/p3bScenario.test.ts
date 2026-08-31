import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkMapLink, parseMapLink } from '../src/mapLink.js';
import { parseScenario } from '../src/scenario.js';
import { initState } from '../src/state.js';
import { resolveMonth } from '../src/tick.js';
import { FIXTURES_DIR, PACKAGE_ROOT } from './helpers.js';

const FIXTURE_DIR = join(FIXTURES_DIR, 'scenario-dev-map-6c');
const SERVER_DIR = join(PACKAGE_ROOT, '..', '..', 'server', 'data', 'scenarios', 'dev-map-6c');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

describe('P3b six-polity product scenario (canon 11)', () => {
  it('binds all 76 GADM regions to exactly six authored polities', () => {
    const scenario = parseScenario(readJson(join(FIXTURE_DIR, 'scenario.json')));
    const link = parseMapLink(readJson(join(FIXTURE_DIR, 'map-link.json')));
    assert.deepStrictEqual(checkMapLink(scenario, link), []);
    assert.strictEqual(scenario.polities.length, 6);
    assert.strictEqual(scenario.regions.length, 76);
    assert.strictEqual(link.regions.length, 76);
    assert.deepStrictEqual(scenario.polities.map((polity) => polity.id).sort(), [
      'polity:austria', 'polity:czechia', 'polity:france',
      'polity:germany', 'polity:poland', 'polity:slovakia',
    ]);
    const counts = scenario.regions.reduce<Record<string, number>>((result, region) => {
      result[region.controllerId] = (result[region.controllerId] ?? 0) + 1;
      return result;
    }, {});
    assert.deepStrictEqual(counts, {
      'polity:austria': 9,
      'polity:czechia': 14,
      'polity:france': 13,
      'polity:germany': 16,
      'polity:poland': 16,
      'polity:slovakia': 8,
    });
  });

  it('ships the same region ids, owners and names to the map shell', () => {
    const scenario = parseScenario(readJson(join(FIXTURE_DIR, 'scenario.json')));
    const link = parseMapLink(readJson(join(FIXTURE_DIR, 'map-link.json')));
    const geo = readJson(join(SERVER_DIR, 'regions.geojson')) as {
      features: Array<{ properties: { id: string; owner: string; name: string } }>;
    };
    assert.strictEqual(geo.features.length, 76);
    const byId = new Map(geo.features.map((feature) => [feature.properties.id, feature.properties]));
    const controllerByRegion = new Map(scenario.regions.map((region) => [region.regionId, region.controllerId]));
    for (const entry of link.regions) {
      const properties = byId.get(entry.mapRegionId);
      assert.ok(properties, `${entry.mapRegionId} is rendered`);
      assert.strictEqual(properties.name, entry.mapName);
      assert.strictEqual(properties.owner, link.polityOwnerNames[controllerByRegion.get(entry.engineRegionId)!]);
    }
    assert.strictEqual(byId.get('FRA.8_1')?.owner, 'France');
    assert.strictEqual(byId.get('POL.7_1')?.owner, 'Poland');
  });

  it('ticks twelve months deterministically with every polity represented in every ledger', () => {
    const scenario = parseScenario(readJson(join(FIXTURE_DIR, 'scenario.json')));
    const run = () => {
      let state = initState(scenario);
      const ledgers = [];
      for (let index = 0; index < 12; index += 1) {
        const result = resolveMonth(state, { commands: [] });
        ledgers.push(result.ledger);
        state = result.state;
      }
      return { state, ledgers };
    };
    const first = run();
    const second = run();
    assert.strictEqual(first.state.month, '1939-01-01');
    assert.strictEqual(first.state.revision, second.state.revision);
    assert.ok(first.ledgers.every((ledger) => ledger.polities.length === 6));
    assert.deepStrictEqual(first.ledgers, second.ledgers);
  });
});
