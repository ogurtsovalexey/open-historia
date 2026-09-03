import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ScenarioV2Builder } from '@open-historia/data-packs';
import {
  SNAPSHOT_DATE,
  OHM_POLAND_1935,
  assertPolandAdjacencyControl,
  auditTopology,
  auditRelationGeometry,
  buildCheckpoint,
  buildFranceOwnerRegions,
  buildPlannedPartition,
  classifyLicense,
  deriveLandAdjacency,
  filterFeaturePolygonsToBbox,
  isEffectiveAt,
  loadPolandAdjacencyControl,
  loadCandidateRegionPlan,
  normalizeHistoricCounties,
  normalizeRelationGeometry,
  normalizeInventory,
  overlapRatio,
  normalizeFranceDepartments,
  normalizeFranceMilitaryRegions,
  normalizePolandRegions,
  stitchRings,
} from '../scripts/europe-1935-geography.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'packages/data-packs/fixtures/europe-1935-benchmark');
const readFixture = (relative) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, relative), 'utf8'));
const fileSha256 = (relative) => `sha256:${crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(fixtureRoot, relative))).digest('hex')}`;

test('Europe 1935 owner candidate plan bounds every Supported polity and assigns UK counties once', () => {
  const plan = loadCandidateRegionPlan();
  assert.equal(plan.status, 'candidate-pending-owner-approval');
  assert.deepEqual(Object.fromEntries(Object.entries(plan.supportedPolities)
    .map(([polityId, definition]) => [polityId, definition.regions.length])), {
    'polity:austria': 10,
    'polity:czechoslovakia': 10,
    'polity:germany': 21,
    'polity:italy': 18,
    'polity:united-kingdom': 13,
  });
  assert.deepEqual(plan.baselineMacroRegions['polity:soviet-union'], ['Запад', 'Центр', 'Восток']);
  assert.ok(plan.inertPolities.some(({ polityId }) => polityId === 'polity:saargebiet'));
  assert.ok(plan.inertPolities.some(({ polityId }) => polityId === 'polity:free-city-of-danzig'));
});

test('Europe 1935 geography inventory applies date and license gates deterministically', () => {
  assert.equal(SNAPSHOT_DATE, '1935-01-01');
  assert.equal(isEffectiveAt({ start_date: '1920', end_date: '1935-03-01' }), true);
  assert.equal(isEffectiveAt({ start_date: '1935-02-01' }), false);
  assert.equal(isEffectiveAt({ start_date: '1920', end_date: '1935-01-01' }), false);
  assert.equal(classifyLicense({}).class, 'ohm-default-cc0');
  assert.equal(classifyLicense({ license: 'CC-BY (NLS)' }).allowed, true);
  assert.equal(classifyLicense({ license: 'CC BY-SA 4.0' }).allowed, false);
  assert.equal(classifyLicense({ license: 'ODbL' }).allowed, false);

  const raw = { elements: [
    { id: 2, tags: { name: 'B', admin_level: '4', start_date: '1918' }, center: { lon: 2, lat: 1 } },
    { id: 1, tags: { name: 'A', admin_level: '3', start_date: '1920', end_date: '1939', license: 'CC0' }, center: { lon: 1, lat: 2 } },
  ] };
  assert.deepEqual(normalizeInventory(raw).map((entry) => entry.relationId), [1, 2]);
  assert.deepEqual(buildCheckpoint(raw, 'query', 'sha256:source'), buildCheckpoint(raw, 'query', 'sha256:source'));
});

test('TRF-GIS France 1935 normalization requires 90 unique dated polygons', () => {
  const raw = { type: 'FeatureCollection', features: Array.from({ length: 90 }, (_, index) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[index, 0], [index + 0.5, 0], [index + 0.5, 0.5], [index, 0]]] },
    properties: { dep_id: index + 1, dep_name: `DEPARTEMENT-${index + 1}` },
  })) };
  const normalized = normalizeFranceDepartments(raw);
  assert.equal(normalized.features.length, 90);
  assert.equal(normalized.features[0].properties.nativeId, '01');
  assert.equal(normalized.features[0].properties.effectiveAt, '1935-01-01');
  assert.throws(() => normalizeFranceDepartments({ ...raw, features: raw.features.slice(1) }), /expected 90/);
});

test('TRF-GIS France military layer fits the 10–25 game-region gate', () => {
  const raw = { type: 'FeatureCollection', features: Array.from({ length: 18 }, (_, index) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[index, 0], [index + 0.5, 0], [index + 0.5, 0.5], [index, 0]]] },
    properties: { pmreg: index + 1, pmreg_name: `REGION-${index + 1}` },
  })) };
  const normalized = normalizeFranceMilitaryRegions(raw);
  assert.equal(normalized.features.length, 18);
  assert.equal(normalized.features[0].properties.source.license, 'CC BY 4.0');
  assert.throws(() => normalizeFranceMilitaryRegions({ ...raw, features: raw.features.slice(1) }), /expected 18/);
});

test('OHM Poland 1935 normalization requires the exact dated and licensed voivodeship set', () => {
  const polygon = (offset) => ({ type: 'Polygon', coordinates: [[
    [offset, 0], [offset + 1, 0], [offset + 1, 1], [offset, 1], [offset, 0],
  ]] });
  const features = OHM_POLAND_1935.regionRelationIds.map((relationId, index) => ({
    type: 'Feature', geometry: polygon(index), properties: {
      relationId, nativeName: `Województwo ${index + 1}`, startDate: '1930', endDate: '1939',
      license: { class: 'ohm-default-cc0', value: 'CC0 (OHM default)', allowed: true },
    },
  }));
  const normalized = normalizePolandRegions(features);
  assert.equal(normalized.features.length, 16);
  assert.equal(normalized.features[0].properties.nativeId, `ohm-relation-${OHM_POLAND_1935.regionRelationIds[0]}`);
  assert.equal(normalized.features[0].properties.source.copyright, 'https://www.openhistoricalmap.org/copyright');
  assert.throws(() => normalizePolandRegions(features.slice(1)), /lacks voivodeship relation/);
  const blocked = structuredClone(features);
  blocked[0].properties.license = { class: 'share-alike', value: 'CC BY-SA 4.0', allowed: false };
  assert.throws(() => normalizePolandRegions(blocked), /blocked license/);
});

test('Poland source-derived land adjacency is pinned independently of ignored run artifacts', () => {
  const control = loadPolandAdjacencyControl();
  const neighbors = new Map(OHM_POLAND_1935.regionRelationIds.map((relationId) =>
    [`ohm-relation-${relationId}`, []]));
  const edges = control.edges.map(({ relationIds: [left, right], sharedSegmentCount }) => {
    const fromRegionId = `ohm-relation-${left}`;
    const toRegionId = `ohm-relation-${right}`;
    neighbors.get(fromRegionId).push(toRegionId);
    neighbors.get(toRegionId).push(fromRegionId);
    return { fromRegionId, toRegionId, sharedSegmentCount };
  });
  const adjacency = {
    method: control.method,
    regions: [...neighbors.entries()].map(([regionId, adjacentRegionIds]) => ({
      regionId, adjacentRegionIds: adjacentRegionIds.sort(),
    })),
    edges,
    nonManifoldSegments: [],
  };
  assert.equal(assertPolandAdjacencyControl(adjacency).adjacencyChecksum,
    'sha256:f23783aa4c712a80e4be8c1c3ff4969efeb29aa0a3c2944cd852b31366c4c881');
  assert.equal(control.edges.length, 30);
  const drifted = structuredClone(adjacency);
  drifted.edges[0].sharedSegmentCount += 1;
  assert.throws(() => assertPolandAdjacencyControl(drifted, control), /adjacency drifted/);
});

test('Europe 1935 geography closes relation ways into deterministic polygons', () => {
  const segments = [
    { id: 3, coordinates: [[0, 1], [0, 0]] },
    { id: 1, coordinates: [[0, 0], [1, 0]] },
    { id: 4, coordinates: [[0, 1], [1, 1]] },
    { id: 2, coordinates: [[1, 0], [1, 1]] },
  ];
  assert.deepEqual(stitchRings(segments), [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
  assert.throws(() => stitchRings(segments.slice(0, 3), 'fixture'), /fixture: open boundary/);

  const raw = { elements: [
    { type: 'relation', id: 10, tags: { name: 'Test', start_date: '1930' }, members: [
      { type: 'way', ref: 1, role: 'outer' }, { type: 'way', ref: 2, role: 'outer' },
      { type: 'way', ref: 3, role: 'outer' }, { type: 'way', ref: 4, role: 'outer' },
    ] },
    ...segments.map(({ id, coordinates }) => ({ type: 'way', id, geometry: coordinates.map(([lon, lat]) => ({ lon, lat })) })),
  ] };
  const [feature] = normalizeRelationGeometry(raw, [10]);
  assert.equal(feature.geometry.type, 'Polygon');
  assert.equal(feature.properties.nativeName, 'Test');
  assert.equal(overlapRatio(feature.geometry, feature.geometry), 1);
  assert.equal(overlapRatio(feature.geometry, { type: 'Polygon', coordinates: [[
    [2, 2], [3, 2], [3, 3], [2, 3], [2, 2],
  ]] }), 0);
  assert.deepEqual(auditRelationGeometry([10, 11], raw).issues, [
    { relationId: 11, error: 'OHM response lacks relation 11' },
  ]);
  const scoped = filterFeaturePolygonsToBbox({ ...feature, geometry: { type: 'MultiPolygon', coordinates: [
    feature.geometry.coordinates,
    [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
  ] } }, [-1, -1, 2, 2]);
  assert.equal(scoped.geometry.type, 'Polygon');
  assert.equal(scoped.properties.excludedOuterRings, 1);
});

test('Europe 1935 topology audit exposes source gaps and overlaps without repairing them', () => {
  const feature = (west, east) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
    [west, 0], [east, 0], [east, 1], [west, 1], [west, 0],
  ]] } });
  const boundary = feature(0, 2);
  const exact = auditTopology(boundary, [feature(0, 1), feature(1, 2)]);
  assert.equal(exact.status, 'topology-clean');
  assert.deepEqual(exact, auditTopology(boundary, [feature(1, 2), feature(0, 1)]));
  const gap = auditTopology(boundary, [feature(0, 0.9), feature(1.1, 2)]);
  assert.equal(gap.status, 'topology-review-required');
  assert.ok(gap.gapRatio > 0.09);
  const overlap = auditTopology(boundary, [feature(0, 1.1), feature(0.9, 2)]);
  assert.equal(overlap.status, 'topology-review-required');
  assert.ok(overlap.overlapExcessRatio > 0.09);
  assert.deepEqual(auditTopology(boundary, []), {
    status: 'source-gap', regionCount: 0, coveredRatio: 0, gapRatio: 1,
    outsideRatio: 0, overlapExcessRatio: 0,
  });
});

test('land adjacency requires a shared source segment and is byte-order deterministic', () => {
  const feature = (nativeId, coordinates) => ({
    type: 'Feature', properties: { nativeId }, geometry: { type: 'Polygon', coordinates: [coordinates] },
  });
  const regions = { type: 'FeatureCollection', features: [
    feature('A', [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]),
    feature('B', [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]),
    feature('C', [[2, 1], [3, 1], [3, 2], [2, 2], [2, 1]]),
  ] };
  const adjacency = deriveLandAdjacency(regions);
  assert.deepEqual(adjacency.edges, [{ fromRegionId: 'A', toRegionId: 'B', sharedSegmentCount: 1 }]);
  assert.deepEqual(adjacency.regions, [
    { regionId: 'A', adjacentRegionIds: ['B'] },
    { regionId: 'B', adjacentRegionIds: ['A'] },
    { regionId: 'C', adjacentRegionIds: [] },
  ]);
  assert.deepEqual(adjacency, deriveLandAdjacency({ ...regions, features: regions.features.toReversed() }));
  assert.throws(() => deriveLandAdjacency({ ...regions, features: [...regions.features, regions.features[0]] }), /unique nativeId/);
});

test('owner partition rebuilds precision-normalized source and authored cuts without gaps or overlaps', () => {
  const polygon = (west, east, relationId) => ({
    type: 'Feature', properties: { relationId, startDate: '1930', endDate: '1940',
      license: { class: 'ohm-default-cc0', value: 'CC0 (OHM default)', allowed: true } },
    geometry: { type: 'Polygon', coordinates: [[[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]]] },
  });
  const boundary = polygon(0, 3, 100);
  const first = buildPlannedPartition(boundary, [polygon(0, 1, 1), polygon(2, 3, 3)], {
    remainderRegionId: 'middle',
    regions: [
      { id: 'west', name: 'West', sourceRelationIds: [1] },
      { id: 'east', name: 'East', sourceRelationIds: [3] },
      { id: 'middle', name: 'Middle', sourceRelationIds: [2], method: 'country-remainder-plus-dated-source' },
    ],
  }, 'polity:test', { precision: 7 });
  assert.equal(auditTopology(first.boundary, first.features).status, 'topology-clean');
  assert.deepEqual(deriveLandAdjacency({ type: 'FeatureCollection', features: first.features }).edges
    .map(({ fromRegionId, toRegionId }) => [fromRegionId, toRegionId]), [
    ['east', 'middle'], ['middle', 'west'],
  ]);
  assert.deepEqual(first.features.find(({ properties }) => properties.nativeId === 'middle').properties.sourceObjects, [{
    relationId: 100, startDate: '1930', endDate: '1940',
    license: { class: 'ohm-default-cc0', value: 'CC0 (OHM default)', allowed: true },
  }]);
  assert.deepEqual(first, buildPlannedPartition(boundary, [polygon(0, 1, 1), polygon(2, 3, 3)], {
    remainderRegionId: 'middle',
    regions: [
      { id: 'west', name: 'West', sourceRelationIds: [1] },
      { id: 'east', name: 'East', sourceRelationIds: [3] },
      { id: 'middle', name: 'Middle', sourceRelationIds: [2], method: 'country-remainder-plus-dated-source' },
    ],
  }, 'polity:test', { precision: 7 }));
});

test('Historic Counties Trust input is exact, unique and deterministically ordered', () => {
  const countyCode = (index) => `A${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
  const raw = { type: 'FeatureCollection', features: Array.from({ length: 92 }, (_, index) => ({
    type: 'Feature',
    properties: { HCS_CODE: countyCode(index), NAME: `County ${index}` },
    geometry: { type: 'Polygon', coordinates: [[[index, 0], [index + 1, 0], [index + 1, 1], [index, 0]]] },
  })) };
  const normalized = normalizeHistoricCounties(raw);
  assert.equal(normalized.features.length, 92);
  assert.equal(normalized.features[0].properties.countyCode, 'AAA');
  assert.throws(() => normalizeHistoricCounties({ ...raw, features: raw.features.slice(1) }), /exactly 92/);
  const duplicate = structuredClone(raw);
  duplicate.features[1].properties.HCS_CODE = 'AAA';
  assert.throws(() => normalizeHistoricCounties(duplicate), /invalid or duplicate/);
});

test('France owner geography promotes Corse to an explicit region and remains topology-clean', () => {
  const square = (west, east, south, north) => [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
  const regions = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { nativeId: '15', nativeName: 'MARSEILLE' }, geometry: {
      type: 'MultiPolygon', coordinates: [square(4, 7, 43, 45), square(8.5, 9.5, 41, 43)],
    } },
    { type: 'Feature', properties: { nativeId: '22', nativeName: 'PARIS' }, geometry: {
      type: 'Polygon', coordinates: square(4, 7, 45, 47),
    } },
  ] };
  const partition = buildFranceOwnerRegions(regions, 7);
  assert.deepEqual(partition.features.map(({ properties }) => properties.nativeId), ['marseille', 'corse', 'paris']);
  assert.equal(auditTopology(partition.boundary, partition.features).status, 'topology-clean');
});

test('owner-approved geography is content-addressed and integrated into the runtime projection', () => {
  const manifest = readFixture('manifest.json');
  const scenario = readFixture('scenario.json');
  const engine = readFixture('engine/scenario.json');
  const mapLink = readFixture('engine/map-link.json');
  const runtime = readFixture('geography/runtime-geography-manifest.json');
  const geojson = readFixture('geography/runtime-regions.geojson');
  const adjacency = readFixture('geography/runtime-land-adjacency.json');
  assert.deepEqual(runtime.gate, { status: 'owner-approved-runtime', runtimeIntegrated: true });
  assert.equal(runtime.approvedCheckpoint.collectionChecksum,
    'sha256:8571a3054bd50d557e6c33107b673764aefb9dfa992785c8894f7cd6feea3292');
  assert.equal(runtime.approvedCheckpoint.adjacencyChecksum,
    'sha256:206ffb2c3f8098ef05a276b729b41edfeff946ba2e0ee593ccf1fdafa906040d');
  assert.equal(engine.polities.length, 11);
  assert.equal(engine.regions.length, 115);
  assert.equal(scenario.regions.length, 115);
  assert.equal(mapLink.regions.length, 115);
  assert.equal(geojson.features.length, 109);
  assert.equal(adjacency.polities.length, 9);
  assert.deepEqual(engine.polities.filter((entry) => entry.decisionMode === 'inert').map((entry) => entry.id),
    ['polity:free-city-of-danzig', 'polity:saargebiet']);
  assert.ok(geojson.features.some((entry) => entry.properties.name === 'Corse'));
  assert.ok(geojson.features.some((entry) => entry.properties.name === 'Sicilia'));
  assert.ok(geojson.features.some((entry) => entry.properties.name === 'Sardegna'));
  assert.ok(geojson.features.some((entry) => entry.properties.name === 'Northern Ireland'));
  for (const asset of manifest.assets) assert.equal(fileSha256(asset.path), asset.contentAddress);
  assert.equal(new Set(engine.regions.map((entry) => entry.regionId)).size, 115);
  assert.deepEqual(new Set(mapLink.regions.map((entry) => entry.engineRegionId)),
    new Set(engine.regions.map((entry) => entry.regionId)));
  const built = new ScenarioV2Builder().buildFromDirectory(fixtureRoot);
  assert.equal(built.success, true, JSON.stringify(built.errors));
});
