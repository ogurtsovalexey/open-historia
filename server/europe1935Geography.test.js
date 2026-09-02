import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SNAPSHOT_DATE,
  buildCheckpoint,
  classifyLicense,
  isEffectiveAt,
  normalizeInventory,
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
