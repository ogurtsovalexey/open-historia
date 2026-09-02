import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SNAPSHOT_DATE,
  auditRelationGeometry,
  buildCheckpoint,
  classifyLicense,
  filterFeaturePolygonsToBbox,
  isEffectiveAt,
  normalizeRelationGeometry,
  normalizeInventory,
  overlapRatio,
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
