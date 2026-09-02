import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import area from '@turf/area';
import simplify from '@turf/simplify';
import { geoIdentity, geoPath } from 'd3-geo';
import polygonClipping from 'polygon-clipping';
import { parseZip } from 'shpjs';

export const SNAPSHOT_DATE = '1935-01-01';
export const OHM_ENDPOINT = 'https://overpass-api.openhistoricalmap.org/api/interpreter';
export const EUROPE_BBOX = '35,-12,72,32';
export const SUPPORTED_BOUNDARIES = Object.freeze([
  { polityId: 'polity:austria', relationId: 2858751, candidateAdminLevels: ['4'], overlayAdminLevels: ['4'], candidateBbox: [9.4, 46.2, 17.2, 49.2] },
  { polityId: 'polity:czechoslovakia', relationId: 2692233, candidateAdminLevels: ['4', '5'], overlayAdminLevels: ['5'], candidateBbox: [12, 47.5, 27, 51.2] },
  { polityId: 'polity:france', relationId: 2696299, candidateAdminLevels: ['4', '5'], overlayAdminLevels: ['4', '5'], candidateBbox: [-5.5, 41, 10, 51.5] },
  { polityId: 'polity:germany', relationId: 2696515, candidateAdminLevels: ['4'], overlayAdminLevels: ['4'], candidateBbox: [5.8, 47.2, 23, 55.5] },
  { polityId: 'polity:italy', relationId: 2851104, candidateAdminLevels: ['4'], overlayAdminLevels: ['4'], candidateBbox: [6.5, 35, 19, 47.2] },
  { polityId: 'polity:poland', relationId: 2692205, candidateAdminLevels: ['4'], overlayAdminLevels: ['4'], candidateBbox: [13.5, 47.8, 28.5, 56] },
  { polityId: 'polity:united-kingdom', relationId: 2693292, candidateAdminLevels: ['4', '5'], overlayAdminLevels: ['5'], candidateBbox: [-8.8, 49.5, 2.2, 61] },
]);
const POLITY_COLORS = Object.freeze({
  'polity:austria': '#d94848', 'polity:czechoslovakia': '#4f78c4', 'polity:france': '#4169a8',
  'polity:germany': '#555555', 'polity:italy': '#4f9960', 'polity:poland': '#d8d8d8',
  'polity:united-kingdom': '#b44747',
});
export const TRF_GIS_FRANCE_1935 = Object.freeze({
  datasetDoi: 'doi:10.7910/DVN/ULQYM5',
  dataFileId: 4083159,
  filename: 'DEPARTEMENTS_1935.zip',
  downloadUrl: 'https://dataverse.harvard.edu/api/access/datafile/4083159',
  license: 'CC BY 4.0',
  expectedSha256: 'sha256:17a4b0a13e08c9344c71f5c1e733f97e8e9f0262d6ed8105e89493d499cce2ef',
});
export const TRF_GIS_FRANCE_MILITARY_1935 = Object.freeze({
  datasetDoi: 'doi:10.7910/DVN/SQPEUW',
  dataFileId: 4087371,
  filename: 'MIL_REGIONS_1935.zip',
  downloadUrl: 'https://dataverse.harvard.edu/api/access/datafile/4087371',
  license: 'CC BY 4.0',
  expectedSha256: 'sha256:26dfb0a8bc6fd9cabcb175e7ced71b12ec76a4d5fc80bfde7c678a3a79078573',
});
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'runs', 'campaign-lab', 'europe-1935-geography-checkpoint');

const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const groupBy = (rows, selector) => rows.reduce((groups, row) => {
  const key = selector(row);
  (groups[key] ??= []).push(row);
  return groups;
}, {});
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};

export function isEffectiveAt(tags, date = SNAPSHOT_DATE) {
  const start = String(tags?.start_date ?? '');
  const end = String(tags?.end_date ?? '');
  return Boolean(start) && start <= date && (!end || end > date);
}

export function classifyLicense(tags) {
  const value = String(tags?.license ?? '').trim();
  if (!value) return { class: 'ohm-default-cc0', value: 'CC0 (OHM default)', allowed: true };
  if (/^(?:cc0(?:-1\.0)?|public domain)$/i.test(value)) return { class: 'public-domain', value, allowed: true };
  if (/share.?alike|cc[- ]?by[- ]?sa|odbl/i.test(value)) return { class: 'share-alike', value, allowed: false };
  if (/cc[- ]?by/i.test(value)) return { class: 'attribution', value, allowed: true };
  return { class: 'unknown', value, allowed: false };
}

export function normalizeInventory(raw) {
  const elements = Array.isArray(raw?.elements) ? raw.elements : [];
  return elements.map((element) => {
    const tags = element.tags ?? {};
    return {
      relationId: element.id,
      nativeName: tags['name:local'] || tags.name || '',
      adminLevel: tags.admin_level || '',
      startDate: tags.start_date || '', endDate: tags.end_date || null,
      license: classifyLicense(tags), source: tags.source || null,
      center: element.center ? [element.center.lon, element.center.lat] : null,
      effective: isEffectiveAt(tags),
    };
  }).sort((left, right) => left.adminLevel.localeCompare(right.adminLevel)
    || left.nativeName.localeCompare(right.nativeName) || left.relationId - right.relationId);
}

const inventoryQuery = () => `[out:json][timeout:120];relation["boundary"="administrative"]["admin_level"~"^(2|3|4|5|6)$"]["start_date"](${EUROPE_BBOX})(if:t["start_date"] <= "${SNAPSHOT_DATE}" && (!is_tag("end_date") || t["end_date"] > "${SNAPSHOT_DATE}"));out tags center;`;
const relationGeometryQuery = (relationIds) => `[out:json][timeout:180];relation(id:${[...new Set(relationIds)]
  .sort((left, right) => left - right).join(',')});out body;way(r);out geom;`;

const coordinateKey = ([longitude, latitude]) => `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
const sameCoordinate = (left, right) => coordinateKey(left) === coordinateKey(right);

export function stitchRings(segments, label = 'relation') {
  const unused = segments.map((segment) => ({
    id: segment.id,
    coordinates: segment.coordinates.map((coordinate) => [...coordinate]),
  })).sort((left, right) => left.id - right.id);
  const rings = [];
  while (unused.length) {
    const seed = unused.shift();
    const ring = seed.coordinates;
    while (!sameCoordinate(ring[0], ring.at(-1))) {
      const endpoint = ring.at(-1);
      const matchIndex = unused.findIndex((segment) => sameCoordinate(segment.coordinates[0], endpoint)
        || sameCoordinate(segment.coordinates.at(-1), endpoint));
      if (matchIndex < 0) throw new Error(`${label}: open boundary at ${coordinateKey(endpoint)}`);
      const [match] = unused.splice(matchIndex, 1);
      const oriented = sameCoordinate(match.coordinates[0], endpoint) ? match.coordinates : match.coordinates.toReversed();
      ring.push(...oriented.slice(1));
    }
    if (ring.length < 4) throw new Error(`${label}: ring has fewer than four coordinates`);
    rings.push(ring);
  }
  return rings;
}

const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [xi, yi] = ring[current];
    const [xj, yj] = ring[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export function relationToFeature(relation, waysById) {
  const members = (relation.members ?? []).filter((member) => member.type === 'way'
    && (member.role === 'outer' || member.role === 'inner'));
  const missing = members.filter((member) => !waysById.has(member.ref));
  if (missing.length) throw new Error(`relation ${relation.id}: ${missing.length} member ways lack geometry`);
  const segmentsFor = (role) => members.filter((member) => member.role === role).map((member) => ({
    id: member.ref,
    coordinates: waysById.get(member.ref).geometry.map(({ lon, lat }) => [lon, lat]),
  }));
  const outerRings = stitchRings(segmentsFor('outer'), `relation ${relation.id} outer`);
  if (!outerRings.length) throw new Error(`relation ${relation.id}: no outer rings`);
  const polygons = outerRings.map((ring) => [ring]);
  for (const inner of stitchRings(segmentsFor('inner'), `relation ${relation.id} inner`)) {
    const outerIndex = outerRings.findIndex((outer) => pointInRing(inner[0], outer));
    if (outerIndex < 0) throw new Error(`relation ${relation.id}: inner ring has no containing outer ring`);
    polygons[outerIndex].push(inner);
  }
  return {
    type: 'Feature',
    geometry: polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons },
    properties: {
      relationId: relation.id,
      nativeName: relation.tags?.['name:local'] || relation.tags?.name || '',
      startDate: relation.tags?.start_date || null,
      endDate: relation.tags?.end_date || null,
      license: classifyLicense(relation.tags),
    },
  };
}

export function normalizeRelationGeometry(raw, expectedRelationIds) {
  const relations = new Map(raw.elements.filter((element) => element.type === 'relation')
    .map((relation) => [relation.id, relation]));
  const ways = new Map(raw.elements.filter((element) => element.type === 'way')
    .map((way) => [way.id, way]));
  const { features, issues } = auditRelationGeometry(expectedRelationIds, relations, ways);
  if (issues.length) throw new Error(issues[0].error);
  return features;
}

export function filterFeaturePolygonsToBbox(feature, bbox) {
  const [west, south, east, north] = bbox;
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const retained = polygons.filter(([outer]) => {
    const bounds = outer.reduce((result, [longitude, latitude]) => ({
      west: Math.min(result.west, longitude), south: Math.min(result.south, latitude),
      east: Math.max(result.east, longitude), north: Math.max(result.north, latitude),
    }), { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity });
    return bounds.east >= west && bounds.west <= east && bounds.north >= south && bounds.south <= north;
  });
  if (!retained.length) throw new Error(`relation ${feature.properties.relationId}: no polygons in scenario scope`);
  return {
    ...feature,
    geometry: retained.length === 1
      ? { type: 'Polygon', coordinates: retained[0] }
      : { type: 'MultiPolygon', coordinates: retained },
    properties: { ...feature.properties, scenarioScopeBbox: bbox, excludedOuterRings: polygons.length - retained.length },
  };
}

export function auditRelationGeometry(expectedRelationIds, relationsOrRaw, waysOverride) {
  const relations = relationsOrRaw instanceof Map ? relationsOrRaw : new Map(relationsOrRaw.elements
    .filter((element) => element.type === 'relation').map((relation) => [relation.id, relation]));
  const ways = waysOverride ?? new Map(relationsOrRaw.elements.filter((element) => element.type === 'way')
    .map((way) => [way.id, way]));
  const features = [];
  const issues = [];
  for (const relationId of expectedRelationIds) {
    try {
      const relation = relations.get(relationId);
      if (!relation) throw new Error(`OHM response lacks relation ${relationId}`);
      if (!isEffectiveAt(relation.tags)) throw new Error(`relation ${relationId} is not effective at ${SNAPSHOT_DATE}`);
      const license = classifyLicense(relation.tags);
      if (!license.allowed) throw new Error(`relation ${relationId} has blocked license ${license.value}`);
      features.push(relationToFeature(relation, ways));
    } catch (error) {
      issues.push({ relationId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { features, issues };
}

export async function fetchRelationGeometry(relationIds, fetchImpl = fetch) {
  const query = relationGeometryQuery(relationIds);
  const response = await fetchImpl(OHM_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(210_000) });
  if (!response.ok) throw new Error(`OHM geometry failed: ${response.status} ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { query, bytes, raw: JSON.parse(bytes.toString('utf8')) };
}

const asMultiPolygonCoordinates = (geometry) => geometry.type === 'Polygon'
  ? [geometry.coordinates]
  : geometry.coordinates;

const ringsOfGeometry = (geometry) => asMultiPolygonCoordinates(geometry).flatMap((polygon) => polygon);

/** Land adjacency is derived only from shared source linework. A point touch,
 * strait, sea route or external macro-power link never becomes a land edge. */
export function deriveLandAdjacency(featureCollection) {
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new Error('Land adjacency requires a FeatureCollection');
  }
  const segmentOwners = new Map();
  const ids = new Set();
  for (const feature of [...featureCollection.features]
    .sort((left, right) => left.properties.nativeId.localeCompare(right.properties.nativeId))) {
    const regionId = String(feature.properties?.nativeId ?? '');
    if (!regionId || ids.has(regionId)) throw new Error(`Land adjacency requires unique nativeId values: ${regionId || '<missing>'}`);
    ids.add(regionId);
    for (const ring of ringsOfGeometry(feature.geometry)) {
      for (let index = 1; index < ring.length; index += 1) {
        const left = coordinateKey(ring[index - 1]);
        const right = coordinateKey(ring[index]);
        if (left === right) continue;
        const key = left < right ? `${left}|${right}` : `${right}|${left}`;
        const owners = segmentOwners.get(key) ?? new Set();
        owners.add(regionId);
        segmentOwners.set(key, owners);
      }
    }
  }
  const edgeCounts = new Map();
  const nonManifoldSegments = [];
  for (const [segment, owners] of [...segmentOwners.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const sorted = [...owners].sort();
    if (sorted.length > 2) nonManifoldSegments.push({ segment, regionIds: sorted });
    for (let left = 0; left < sorted.length; left += 1) {
      for (let right = left + 1; right < sorted.length; right += 1) {
        const key = `${sorted[left]}|${sorted[right]}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const edges = [...edgeCounts.entries()].map(([key, sharedSegmentCount]) => {
    const [fromRegionId, toRegionId] = key.split('|');
    return { fromRegionId, toRegionId, sharedSegmentCount };
  }).sort((left, right) => left.fromRegionId.localeCompare(right.fromRegionId)
    || left.toRegionId.localeCompare(right.toRegionId));
  const neighbors = new Map([...ids].sort().map((regionId) => [regionId, []]));
  for (const edge of edges) {
    neighbors.get(edge.fromRegionId).push(edge.toRegionId);
    neighbors.get(edge.toRegionId).push(edge.fromRegionId);
  }
  return {
    method: 'exact-shared-source-segments-7dp',
    regions: [...neighbors.entries()].map(([regionId, adjacentRegionIds]) => ({
      regionId, adjacentRegionIds: adjacentRegionIds.sort(),
    })),
    edges,
    nonManifoldSegments,
  };
}

export function overlapRatio(candidateGeometry, boundaryGeometry) {
  const candidateFeature = { type: 'Feature', properties: {}, geometry: candidateGeometry };
  const candidateArea = area(candidateFeature);
  if (!Number.isFinite(candidateArea) || candidateArea <= 0) throw new Error('Candidate geometry has no positive area');
  const clipped = polygonClipping.intersection(
    asMultiPolygonCoordinates(candidateGeometry),
    asMultiPolygonCoordinates(boundaryGeometry),
  );
  if (!clipped.length) return 0;
  const intersectionArea = area({
    type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: clipped },
  });
  return Math.max(0, Math.min(1, intersectionArea / candidateArea));
}

const areaOfMultiPolygon = (coordinates) => coordinates.length === 0 ? 0 : area({
  type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates },
});

/**
 * Measures a selected polygon set against one country boundary. This is a
 * diagnostic on source geometry, before shared-line simplification. It never
 * repairs gaps or overlaps and therefore cannot silently turn an incomplete
 * source into an approvable map.
 */
export function auditTopology(boundaryFeature, regionFeatures) {
  const boundaryCoordinates = asMultiPolygonCoordinates(boundaryFeature.geometry);
  const boundaryArea = areaOfMultiPolygon(boundaryCoordinates);
  if (!Number.isFinite(boundaryArea) || boundaryArea <= 0) throw new Error('Boundary geometry has no positive area');
  if (regionFeatures.length === 0) {
    return {
      status: 'source-gap', regionCount: 0, coveredRatio: 0, gapRatio: 1,
      outsideRatio: 0, overlapExcessRatio: 0,
    };
  }
  try {
    const regionCoordinates = regionFeatures.map((feature) => asMultiPolygonCoordinates(feature.geometry));
    const unionCoordinates = polygonClipping.union(...regionCoordinates);
    const coveredCoordinates = polygonClipping.intersection(boundaryCoordinates, unionCoordinates);
    const coveredArea = areaOfMultiPolygon(coveredCoordinates);
    const unionArea = areaOfMultiPolygon(unionCoordinates);
    const summedInsideArea = regionCoordinates.reduce((total, coordinates) => total
      + areaOfMultiPolygon(polygonClipping.intersection(boundaryCoordinates, coordinates)), 0);
    const coveredRatio = Math.max(0, Math.min(1, coveredArea / boundaryArea));
    const gapRatio = Math.max(0, 1 - coveredRatio);
    const outsideRatio = Math.max(0, (unionArea - coveredArea) / boundaryArea);
    const overlapExcessRatio = Math.max(0, (summedInsideArea - coveredArea) / boundaryArea);
    const rounded = (value) => Number(value.toFixed(9));
    return {
      status: gapRatio <= 1e-6 && outsideRatio <= 1e-6 && overlapExcessRatio <= 1e-6
        ? 'topology-clean' : 'topology-review-required',
      regionCount: regionFeatures.length,
      coveredRatio: rounded(coveredRatio),
      gapRatio: rounded(gapRatio),
      outsideRatio: rounded(outsideRatio),
      overlapExcessRatio: rounded(overlapExcessRatio),
    };
  } catch (error) {
    return {
      status: 'source-geometry-error',
      regionCount: regionFeatures.length,
      coveredRatio: null,
      gapRatio: null,
      outsideRatio: null,
      overlapExcessRatio: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const pointInBbox = ([longitude, latitude], [west, south, east, north]) => longitude >= west
  && longitude <= east && latitude >= south && latitude <= north;

export function buildCoverageMatrix(inventory, boundaryFeatures) {
  const boundariesByRelation = new Map(boundaryFeatures.map((feature) => [feature.properties.relationId, feature]));
  return SUPPORTED_BOUNDARIES.map((definition) => {
    const boundary = boundariesByRelation.get(definition.relationId);
    if (!boundary) throw new Error(`Missing boundary feature ${definition.relationId}`);
    const candidates = inventory.filter((entry) => entry.effective && entry.license.allowed && entry.center
      && entry.relationId !== definition.relationId
      && definition.candidateAdminLevels.includes(entry.adminLevel)
      && pointInBbox(entry.center, definition.candidateBbox));
    return {
      polityId: definition.polityId,
      boundaryRelationId: definition.relationId,
      candidateAdminLevels: definition.candidateAdminLevels,
      candidateCount: candidates.length,
      status: 'geometry-membership-pending',
      candidates: candidates.map(({ relationId, nativeName, adminLevel, startDate, endDate, license, source, center }) => ({
        relationId, nativeName, adminLevel, startDate, endDate, license, source, center,
      })),
    };
  });
}

export function refineCoverageMatrix(coverage, boundaryFeatures, candidateFeatures, geometryIssues = []) {
  const boundariesByRelation = new Map(boundaryFeatures.map((feature) => [feature.properties.relationId, feature]));
  const candidatesByRelation = new Map(candidateFeatures.map((feature) => [feature.properties.relationId, feature]));
  const issuesByRelation = new Map(geometryIssues.map((issue) => [issue.relationId, issue]));
  const definitionByPolity = new Map(SUPPORTED_BOUNDARIES.map((definition) => [definition.polityId, definition]));
  return coverage.map((entry) => {
    const boundary = boundariesByRelation.get(entry.boundaryRelationId);
    const accepted = [];
    const conflicts = [];
    const excluded = [];
    const invalid = [];
    for (const candidate of entry.candidates) {
      const feature = candidatesByRelation.get(candidate.relationId);
      if (!feature) {
        invalid.push({ ...candidate, error: issuesByRelation.get(candidate.relationId)?.error ?? 'candidate geometry missing' });
        continue;
      }
      const ratio = overlapRatio(feature.geometry, boundary.geometry);
      const result = { ...candidate, overlapRatio: Number(ratio.toFixed(6)) };
      if (ratio >= 0.98) accepted.push(result);
      else if (ratio > 0.02) conflicts.push(result);
      else excluded.push(result);
    }
    const count = accepted.length;
    const topologyRelationIds = new Set(accepted.filter((candidate) => definitionByPolity.get(entry.polityId)
      .overlayAdminLevels.includes(candidate.adminLevel)).map((candidate) => candidate.relationId));
    const topology = auditTopology(boundary, candidateFeatures.filter((feature) => topologyRelationIds
      .has(feature.properties.relationId)));
    return {
      ...entry,
      candidateCount: count,
      status: count < 10 ? 'source-gap' : count > 25 ? 'candidate-aggregation-required' : 'candidate-selection-ready',
      candidates: accepted,
      boundaryConflicts: conflicts,
      bboxExclusions: excluded,
      geometryExclusions: invalid,
      topology,
    };
  });
}

const xmlEscape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function buildCandidateOverlay(boundaryFeatures, candidateFeatures, coverage) {
  const definitionByPolity = new Map(SUPPORTED_BOUNDARIES.map((definition) => [definition.polityId, definition]));
  const ownerByRelation = new Map(coverage.flatMap((entry) => entry.candidates
    .filter((candidate) => definitionByPolity.get(entry.polityId).overlayAdminLevels.includes(candidate.adminLevel))
    .map((candidate) => [candidate.relationId, entry.polityId])));
  const visibleRegions = candidateFeatures.filter((feature) => ownerByRelation.has(feature.properties.relationId))
    .map((feature) => simplify({ ...feature, properties: {
      ...feature.properties, polityId: ownerByRelation.get(feature.properties.relationId),
    } }, { tolerance: 0.02, highQuality: false, mutate: false }));
  const visibleBoundaries = boundaryFeatures.map((feature) => simplify(feature,
    { tolerance: 0.02, highQuality: false, mutate: false }));
  const collection = { type: 'FeatureCollection', features: visibleBoundaries };
  const projection = geoIdentity().reflectY(true).fitExtent([[24, 70], [1176, 790]], collection);
  const renderPath = geoPath(projection);
  const regionPaths = visibleRegions.map((feature) => `<path d="${renderPath(feature)}" fill="${POLITY_COLORS[feature.properties.polityId]}" fill-opacity="0.34" stroke="#20242a" stroke-width="0.45"><title>${xmlEscape(`${feature.properties.polityId}: ${feature.properties.nativeName}`)}</title></path>`).join('');
  const boundaryPaths = visibleBoundaries.map((feature) => `<path d="${renderPath(feature)}" fill="none" stroke="#090b0e" stroke-width="1.4"/>`).join('');
  const legend = coverage.map((entry, index) => `<g transform="translate(${24 + (index % 4) * 290} ${826 + Math.floor(index / 4) * 28})"><rect width="14" height="14" fill="${POLITY_COLORS[entry.polityId]}"/><text x="21" y="12">${xmlEscape(`${entry.polityId.replace('polity:', '')}: ${entry.candidateCount} · ${entry.status.replace('candidate-', '')}`)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" role="img" aria-labelledby="title desc"><title id="title">Europe 1935 candidate source overlay</title><desc id="desc">Diagnostic source coverage. Not an owner approval overlay.</desc><rect width="1200" height="900" fill="#f5f0e6"/><text x="24" y="30" font-family="system-ui" font-size="22" font-weight="700">Europe 1935 — candidate source coverage</text><text x="24" y="53" font-family="system-ui" font-size="13">Diagnostic only · overlaps/gaps unresolved · NOT FOR OWNER APPROVAL</text><g>${regionPaths}${boundaryPaths}</g><g font-family="system-ui" font-size="11">${legend}</g></svg>\n`;
}

export function buildRegionalOverlay(featureCollection, title, color) {
  const simplified = { type: 'FeatureCollection', features: featureCollection.features.map((feature) => simplify(feature,
    { tolerance: 0.015, highQuality: false, mutate: false })) };
  const projection = geoIdentity().reflectY(true).fitExtent([[24, 70], [876, 720]], simplified);
  const renderPath = geoPath(projection);
  const paths = simplified.features.map((feature) => `<path d="${renderPath(feature)}" fill="${color}" fill-opacity="0.38" stroke="#20242a" stroke-width="0.7"><title>${xmlEscape(feature.properties.nativeName)}</title></path>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 780" role="img" aria-labelledby="title desc"><title id="title">${xmlEscape(title)}</title><desc id="desc">Diagnostic source coverage. Not an owner approval overlay.</desc><rect width="900" height="780" fill="#f5f0e6"/><text x="24" y="30" font-family="system-ui" font-size="22" font-weight="700">${xmlEscape(title)}</text><text x="24" y="53" font-family="system-ui" font-size="13">${simplified.features.length} dated source regions · NOT FOR OWNER APPROVAL</text><g>${paths}</g></svg>\n`;
}

export function normalizeFranceDepartments(featureCollection) {
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new Error('TRF-GIS 1935 departments must be a FeatureCollection');
  }
  if (featureCollection.features.length !== 90) {
    throw new Error(`TRF-GIS 1935 departments: expected 90 features, received ${featureCollection.features.length}`);
  }
  const seen = new Set();
  return {
    type: 'FeatureCollection',
    features: featureCollection.features.map((feature) => {
      const nativeId = String(feature.properties?.dep_id ?? '').padStart(2, '0');
      const nativeName = String(feature.properties?.dep_name ?? '').trim();
      if (!nativeId || !nativeName) throw new Error('TRF-GIS 1935 department lacks id or name');
      if (seen.has(nativeId)) throw new Error(`TRF-GIS 1935 duplicate department ${nativeId}`);
      seen.add(nativeId);
      if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error(`TRF-GIS 1935 department ${nativeId} lacks polygon geometry`);
      }
      return {
        type: 'Feature', geometry: feature.geometry, properties: {
          nativeId, nativeName, polityId: 'polity:france', effectiveAt: SNAPSHOT_DATE,
          source: { datasetDoi: TRF_GIS_FRANCE_1935.datasetDoi, dataFileId: TRF_GIS_FRANCE_1935.dataFileId,
            license: TRF_GIS_FRANCE_1935.license },
        },
      };
    }).sort((left, right) => left.properties.nativeId.localeCompare(right.properties.nativeId)),
  };
}

export function normalizeFranceMilitaryRegions(featureCollection) {
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new Error('TRF-GIS 1935 military regions must be a FeatureCollection');
  }
  if (featureCollection.features.length !== 18) {
    throw new Error(`TRF-GIS 1935 military regions: expected 18 features, received ${featureCollection.features.length}`);
  }
  const seen = new Set();
  return {
    type: 'FeatureCollection',
    features: featureCollection.features.map((feature) => {
      const nativeId = String(feature.properties?.pmreg ?? '').padStart(2, '0');
      const nativeName = String(feature.properties?.pmreg_name ?? '').trim();
      if (!nativeId || !nativeName) throw new Error('TRF-GIS 1935 military region lacks id or name');
      if (seen.has(nativeId)) throw new Error(`TRF-GIS 1935 duplicate military region ${nativeId}`);
      seen.add(nativeId);
      if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error(`TRF-GIS 1935 military region ${nativeId} lacks polygon geometry`);
      }
      return {
        type: 'Feature', geometry: feature.geometry, properties: {
          nativeId, nativeName, polityId: 'polity:france', effectiveAt: SNAPSHOT_DATE,
          source: { datasetDoi: TRF_GIS_FRANCE_MILITARY_1935.datasetDoi,
            dataFileId: TRF_GIS_FRANCE_MILITARY_1935.dataFileId,
            license: TRF_GIS_FRANCE_MILITARY_1935.license },
        },
      };
    }).sort((left, right) => left.properties.nativeId.localeCompare(right.properties.nativeId)),
  };
}

export async function fetchPinnedSource(source, fetchImpl = fetch) {
  const response = await fetchImpl(source.downloadUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${source.filename} download failed: ${response.status} ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const checksum = sha256(bytes);
  if (checksum !== source.expectedSha256) {
    throw new Error(`${source.filename} checksum mismatch: expected ${source.expectedSha256}, received ${checksum}`);
  }
  return { bytes, checksum };
}

export async function fetchInventory(fetchImpl = fetch) {
  const query = inventoryQuery();
  const response = await fetchImpl(OHM_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(150_000) });
  if (!response.ok) throw new Error(`OHM inventory failed: ${response.status} ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { query, bytes, raw: JSON.parse(bytes.toString('utf8')) };
}

export function buildCheckpoint(raw, query, sourceChecksum) {
  const inventory = normalizeInventory(raw);
  const licensed = groupBy(inventory, (entry) => entry.license.class);
  const adminLevels = groupBy(inventory, (entry) => entry.adminLevel);
  return {
    schemaVersion: 'open-historia-geography-checkpoint/1', scenarioId: 'scenario:europe-1935-benchmark',
    snapshotDate: SNAPSHOT_DATE, source: { provider: 'OpenHistoricalMap', endpoint: OHM_ENDPOINT,
      copyright: 'https://www.openhistoricalmap.org/copyright', query, sourceChecksum },
    counts: { total: inventory.length, byAdminLevel: Object.fromEntries(Object.entries(adminLevels).map(([key, rows]) => [key, rows.length])),
      byLicense: Object.fromEntries(Object.entries(licensed).map(([key, rows]) => [key, rows.length])) },
    policy: { allowed: ['ohm-default-cc0', 'public-domain', 'attribution'], blockedWithoutOwnerDecision: ['share-alike', 'unknown'] },
    blockedRelations: inventory.filter((entry) => !entry.license.allowed), inventory,
  };
}

export async function runInventory(outputDirectory = DEFAULT_OUTPUT) {
  const fetched = await fetchInventory();
  const checkpoint = buildCheckpoint(fetched.raw, fetched.query, sha256(fetched.bytes));
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'ohm-inventory.raw.json'), fetched.bytes);
  fs.writeFileSync(path.join(outputDirectory, 'inventory.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify({ schemaVersion: checkpoint.schemaVersion,
    scenarioId: checkpoint.scenarioId, snapshotDate: checkpoint.snapshotDate, inventoryChecksum: sha256(canonical(checkpoint)),
    sourceChecksum: checkpoint.source.sourceChecksum, status: checkpoint.blockedRelations.length ? 'inventory-ready-with-license-exclusions' : 'inventory-ready' }, null, 2)}\n`);
  return checkpoint;
}

const readCachedResult = (outputDirectory, filename, query) => {
  const bytes = fs.readFileSync(path.join(outputDirectory, filename));
  return { query, bytes, raw: JSON.parse(bytes.toString('utf8')) };
};

export async function runBoundaryCoverage(outputDirectory = DEFAULT_OUTPUT, options = {}) {
  const inventoryResult = options.cached
    ? readCachedResult(outputDirectory, 'ohm-inventory.raw.json', inventoryQuery())
    : await fetchInventory();
  const inventoryCheckpoint = buildCheckpoint(inventoryResult.raw, inventoryResult.query, sha256(inventoryResult.bytes));
  const relationIds = SUPPORTED_BOUNDARIES.map(({ relationId }) => relationId);
  const boundaryResult = options.cached
    ? readCachedResult(outputDirectory, 'ohm-boundaries.raw.json', relationGeometryQuery(relationIds))
    : await fetchRelationGeometry(relationIds);
  const boundaryFeatures = normalizeRelationGeometry(boundaryResult.raw, relationIds).map((feature) => {
    const definition = SUPPORTED_BOUNDARIES.find(({ relationId }) => relationId === feature.properties.relationId);
    return filterFeaturePolygonsToBbox(feature, definition.candidateBbox);
  });
  const preliminaryCoverage = buildCoverageMatrix(inventoryCheckpoint.inventory, boundaryFeatures);
  const candidateIds = preliminaryCoverage.flatMap(({ candidates }) => candidates.map(({ relationId }) => relationId));
  const candidateResult = options.cached
    ? readCachedResult(outputDirectory, 'ohm-candidates.raw.json', relationGeometryQuery(candidateIds))
    : await fetchRelationGeometry(candidateIds);
  const candidateAudit = auditRelationGeometry([...new Set(candidateIds)].sort((left, right) => left - right), candidateResult.raw);
  const candidateFeatures = candidateAudit.features;
  const coverage = refineCoverageMatrix(preliminaryCoverage, boundaryFeatures, candidateFeatures, candidateAudit.issues);
  const checkpoint = {
    schemaVersion: 'open-historia-geography-coverage/1',
    scenarioId: 'scenario:europe-1935-benchmark',
    snapshotDate: SNAPSHOT_DATE,
    sources: [
      { kind: 'inventory', query: inventoryResult.query, checksum: sha256(inventoryResult.bytes) },
      { kind: 'boundary-geometry', query: boundaryResult.query, checksum: sha256(boundaryResult.bytes) },
      { kind: 'candidate-geometry', query: candidateResult.query, checksum: sha256(candidateResult.bytes) },
    ],
    gate: {
      status: coverage.every((entry) => entry.status !== 'source-gap') ? 'candidate-coverage-ready' : 'blocked-by-source-gaps',
      note: 'Candidate centroids are diagnostic only; selected region polygons, topology and owner approval remain required.',
    },
    coverage,
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'ohm-inventory.raw.json'), inventoryResult.bytes);
  fs.writeFileSync(path.join(outputDirectory, 'ohm-boundaries.raw.json'), boundaryResult.bytes);
  fs.writeFileSync(path.join(outputDirectory, 'ohm-candidates.raw.json'), candidateResult.bytes);
  fs.writeFileSync(path.join(outputDirectory, 'country-boundaries.geojson'), `${JSON.stringify({
    type: 'FeatureCollection', features: boundaryFeatures,
  })}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'coverage-matrix.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'candidate-regions.geojson'), `${JSON.stringify({
    type: 'FeatureCollection', features: candidateFeatures.filter((feature) => coverage.some((entry) => entry.candidates
      .some((candidate) => candidate.relationId === feature.properties.relationId))),
  })}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'candidate-source-overlay.svg'), buildCandidateOverlay(
    boundaryFeatures, candidateFeatures, coverage,
  ));
  fs.writeFileSync(path.join(outputDirectory, 'coverage-manifest.json'), `${JSON.stringify({
    schemaVersion: checkpoint.schemaVersion,
    scenarioId: checkpoint.scenarioId,
    snapshotDate: checkpoint.snapshotDate,
    status: checkpoint.gate.status,
    checkpointChecksum: sha256(canonical(checkpoint)),
    sourceChecksums: checkpoint.sources.map(({ checksum }) => checksum),
  }, null, 2)}\n`);
  return checkpoint;
}

export async function runFranceCoverage(outputDirectory = DEFAULT_OUTPUT, options = {}) {
  const sources = [TRF_GIS_FRANCE_1935, TRF_GIS_FRANCE_MILITARY_1935];
  const fetched = [];
  for (const source of sources) {
    const cachedPath = path.join(outputDirectory, source.filename);
    const result = options.cached ? { bytes: fs.readFileSync(cachedPath) } : await fetchPinnedSource(source);
    const checksum = sha256(result.bytes);
    if (checksum !== source.expectedSha256) {
      throw new Error(`${source.filename} checksum mismatch: expected ${source.expectedSha256}, received ${checksum}`);
    }
    fetched.push({ source, bytes: result.bytes, checksum, cachedPath });
  }
  const parsedDepartments = await parseZip(fetched[0].bytes);
  const departments = normalizeFranceDepartments(Array.isArray(parsedDepartments) ? parsedDepartments[0] : parsedDepartments);
  const parsedRegions = await parseZip(fetched[1].bytes);
  const regions = normalizeFranceMilitaryRegions(Array.isArray(parsedRegions) ? parsedRegions[0] : parsedRegions);
  const departmentUnion = polygonClipping.union(...departments.features
    .map((feature) => asMultiPolygonCoordinates(feature.geometry)));
  const militaryRegionTopology = auditTopology({
    type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: departmentUnion },
  }, regions.features);
  const adjacency = deriveLandAdjacency(regions);
  const regionsWithAdjacency = {
    ...regions,
    features: regions.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        adjacentNativeIds: adjacency.regions.find((entry) => entry.regionId === feature.properties.nativeId).adjacentRegionIds,
      },
    })),
  };
  const checkpoint = {
    schemaVersion: 'open-historia-geography-external-source/1',
    scenarioId: 'scenario:europe-1935-benchmark',
    snapshotDate: SNAPSHOT_DATE,
    polityId: 'polity:france',
    sources: fetched.map(({ source, checksum }) => ({ ...source, checksum })),
    gate: { status: militaryRegionTopology.status === 'topology-clean'
      ? 'source-topology-ready' : 'topology-review-required', candidateCount: regions.features.length,
      departmentControlCount: departments.features.length,
      note: 'The 18 dated military regions are within the 10–25 game-region limit; departments remain a topology control.' },
    topology: {
      militaryRegions: militaryRegionTopology,
      adjacency: {
        method: adjacency.method,
        edgeCount: adjacency.edges.length,
        isolatedRegionIds: adjacency.regions.filter((entry) => entry.adjacentRegionIds.length === 0).map((entry) => entry.regionId),
        nonManifoldSegmentCount: adjacency.nonManifoldSegments.length,
        checksum: sha256(canonical(adjacency)),
      },
    },
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const result of fetched) fs.writeFileSync(result.cachedPath, result.bytes);
  fs.writeFileSync(path.join(outputDirectory, 'france-departments-1935.geojson'), `${JSON.stringify(departments)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'france-regions-1935.geojson'), `${JSON.stringify(regionsWithAdjacency)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'france-land-adjacency.json'), `${JSON.stringify(adjacency, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, 'france-source-overlay.svg'), buildRegionalOverlay(
    regions, 'France 1935 — régions militaires source layer', POLITY_COLORS['polity:france'],
  ));
  fs.writeFileSync(path.join(outputDirectory, 'france-source-manifest.json'), `${JSON.stringify({
    ...checkpoint, departmentGeojsonChecksum: sha256(canonical(departments)),
    regionGeojsonChecksum: sha256(canonical(regionsWithAdjacency)),
  }, null, 2)}\n`);
  return checkpoint;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const outputFlag = process.argv.indexOf('--output');
  const output = outputFlag >= 0 && process.argv[outputFlag + 1] ? path.resolve(process.argv[outputFlag + 1]) : DEFAULT_OUTPUT;
  const operation = process.argv.includes('--france') ? runFranceCoverage
    : process.argv.includes('--boundaries') ? runBoundaryCoverage : runInventory;
  operation(output, { cached: process.argv.includes('--cached') }).then((checkpoint) => process.stdout.write(`${JSON.stringify(checkpoint.counts
    ? { output, counts: checkpoint.counts, blockedRelations: checkpoint.blockedRelations.length }
    : { output, status: checkpoint.gate.status, ...(checkpoint.coverage
      ? { coverage: Object.fromEntries(checkpoint.coverage.map(({ polityId, candidateCount }) => [polityId, candidateCount])) }
      : { polityId: checkpoint.polityId, candidateCount: checkpoint.gate.candidateCount }) }, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
}
