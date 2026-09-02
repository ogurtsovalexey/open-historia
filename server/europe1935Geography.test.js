import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SNAPSHOT_DATE,
  OHM_POLAND_1935,
  auditTopology,
  auditRelationGeometry,
  buildCheckpoint,
  classifyLicense,
  deriveLandAdjacency,
  filterFeaturePolygonsToBbox,
  isEffectiveAt,
  normalizeRelationGeometry,
  normalizeInventory,
  overlapRatio,
  normalizeFranceDepartments,
  normalizeFranceMilitaryRegions,
  normalizePolandRegions,
  stitchRings,
} from '../scripts/europe-1935-geography.mjs';

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
