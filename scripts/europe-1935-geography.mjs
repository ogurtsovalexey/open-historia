import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT_DATE = '1935-01-01';
export const OHM_ENDPOINT = 'https://overpass-api.openhistoricalmap.org/api/interpreter';
export const EUROPE_BBOX = '35,-12,72,32';
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

export async function fetchInventory(fetchImpl = fetch) {
  const query = `[out:json][timeout:120];relation["boundary"="administrative"]["admin_level"~"^(2|3|4|5|6)$"]["start_date"](${EUROPE_BBOX})(if:t["start_date"] <= "${SNAPSHOT_DATE}" && (!is_tag("end_date") || t["end_date"] > "${SNAPSHOT_DATE}"));out tags center;`;
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

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const outputFlag = process.argv.indexOf('--output');
  const output = outputFlag >= 0 && process.argv[outputFlag + 1] ? path.resolve(process.argv[outputFlag + 1]) : DEFAULT_OUTPUT;
  runInventory(output).then((checkpoint) => process.stdout.write(`${JSON.stringify({ output,
    counts: checkpoint.counts, blockedRelations: checkpoint.blockedRelations.length }, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
}
