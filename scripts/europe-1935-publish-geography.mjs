import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import area from '@turf/area';
import {
  initState,
  parseScenario,
  populationWeightedInfrastructureBp,
  resolveMonth,
} from '@open-historia/engine';
import {
  apportionIntegerTotal,
  buildFirstMonthBaseline,
  buildPolandRegionalProjectionCandidate,
  compareFirstMonthBaseline,
} from './europe-1935-starting-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ROOT = path.join(ROOT, 'packages', 'data-packs', 'fixtures', 'europe-1935-benchmark');
const DEFAULT_CHECKPOINT = path.join(ROOT, 'runs', 'campaign-lab', 'europe-1935-geography-checkpoint');
const CONTROL_PATH = path.join(FIXTURE_ROOT, 'geography', 'runtime-integration-control.json');
const EXPECTED_APPROVED_COLLECTION = 'sha256:8571a3054bd50d557e6c33107b673764aefb9dfa992785c8894f7cd6feea3292';
const EXPECTED_APPROVED_ADJACENCY = 'sha256:206ffb2c3f8098ef05a276b729b41edfeff946ba2e0ee593ccf1fdafa906040d';
const ACTIVE_POLITY_IDS = new Set([
  'polity:austria', 'polity:czechoslovakia', 'polity:france', 'polity:germany',
  'polity:italy', 'polity:poland', 'polity:soviet-union', 'polity:united-kingdom',
  'polity:united-states',
]);
const INERT_POLITIES = Object.freeze([
  { id: 'polity:free-city-of-danzig', name: 'Freie Stadt Danzig', color: '#c9a45c', nativeId: 'freie-stadt-danzig' },
  { id: 'polity:saargebiet', name: 'Saargebiet', color: '#7d8b94', nativeId: 'saargebiet' },
]);
const POLITY_CODE = Object.freeze({
  'polity:austria': 'at', 'polity:czechoslovakia': 'cs', 'polity:france': 'fr',
  'polity:free-city-of-danzig': 'danzig', 'polity:germany': 'de', 'polity:italy': 'it',
  'polity:saargebiet': 'saar', 'polity:united-kingdom': 'gb',
});
const BASELINE_REGIONS = Object.freeze({
  'polity:soviet-union': [
    { nativeId: 'su-zapad', name: 'Запад', weight: 50 },
    { nativeId: 'su-tsentr', name: 'Центр', weight: 30 },
    { nativeId: 'su-vostok', name: 'Восток', weight: 20 },
  ],
  'polity:united-states': [
    { nativeId: 'us-east', name: 'East', weight: 50 },
    { nativeId: 'us-central', name: 'Central', weight: 30 },
    { nativeId: 'us-west', name: 'West', weight: 20 },
  ],
});
const PREFERRED_PROCESSING = Object.freeze({
  'polity:austria': 'wien',
  'polity:czechoslovakia': 'praha',
  'polity:france': 'paris',
  'polity:germany': 'rheinprovinz',
  'polity:italy': 'lombardia',
  'polity:united-kingdom': 'midlands',
  'polity:soviet-union': 'su-tsentr',
  'polity:united-states': 'us-east',
});
const EXTERNAL_LINKS = Object.freeze([
  ['at-niederoesterreich', 'cs-morava', 100000],
  ['at-salzburg', 'de-bayern', 120000],
  ['cs-slezsko', '2741470', 110000],
  ['de-rheinprovinz', 'fr-metz', 140000],
  ['de-pommern', '2741476', 140000],
  ['fr-lille', 'gb-south-east-england', 150000],
  ['fr-marseille', 'it-liguria', 110000],
  ['2696109', 'su-zapad', 120000],
  ['gb-south-west-england', 'us-east', 90000],
]);

const readJson = (target) => JSON.parse(fs.readFileSync(target, 'utf8'));
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const sha256 = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const writeJson = (target, value, compact = false) => fs.writeFileSync(target,
  `${compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
const gcd = (left, right) => right === 0 ? Math.abs(left) : gcd(right, left % right);
const lcm = (left, right) => Math.abs(left * right) / gcd(left, right);
const regionIdFor = (polityId, nativeId) => polityId === 'polity:poland'
  ? `region:ohm-1935:${nativeId.replace('ohm-relation-', '')}`
  : `region:europe-1935:${POLITY_CODE[polityId]}-${nativeId}`;
const mapIdFor = (polityId, nativeId) => `e1935-${POLITY_CODE[polityId]}-${nativeId}`;

function ensureControl(engineScenario, authoring, checkpointManifest) {
  if (fs.existsSync(CONTROL_PATH)) return readJson(CONTROL_PATH);
  const macroRegions = engineScenario.regions.filter((entry) => entry.regionId.startsWith('region:benchmark-1:'));
  if (macroRegions.length !== 9) throw new Error('cannot initialize geography integration control without nine macro regions');
  const control = {
    schemaVersion: 'open-historia-geography-runtime-control/1',
    scenarioId: engineScenario.scenarioId,
    approvedCollectionChecksum: checkpointManifest.collectionChecksum,
    approvedAdjacencyChecksum: checkpointManifest.adjacencyChecksum,
    macroRegions,
    nationalControls: authoring.nationalControls,
  };
  writeJson(CONTROL_PATH, control);
  return control;
}

function populationQuantum(macro) {
  return [
    10000 / gcd(macro.workforceRateBp, 10000),
    120000 / gcd(macro.annualBirthRateBp, 120000),
    120000 / gcd(macro.annualDeathRateBp, 120000),
  ].reduce(lcm, 1);
}

function apportionWithAnchor(descriptors, target, quantum, positive = false) {
  const units = Math.floor(target / quantum);
  const anchor = [...descriptors].sort((left, right) => right.weight - left.weight
    || left.engineRegionId.localeCompare(right.engineRegionId))[0];
  const remainder = target - units * quantum;
  const minimumUnits = new Map(descriptors.map((entry) => [entry.engineRegionId,
    positive && (remainder === 0 || entry.engineRegionId !== anchor.engineRegionId) ? 1 : 0]));
  const reserved = [...minimumUnits.values()].reduce((total, amount) => total + amount, 0);
  if (reserved > units) throw new Error(`target ${target} cannot give ${descriptors.length} regions positive quantum ${quantum}`);
  const rows = apportionIntegerTotal(descriptors.map((entry) => ({ id: entry.engineRegionId, weight: entry.weight })), units - reserved);
  const amounts = new Map(rows.map((entry) => [entry.id, (entry.amount + minimumUnits.get(entry.id)) * quantum]));
  amounts.set(anchor.engineRegionId, amounts.get(anchor.engineRegionId) + remainder);
  return amounts;
}

function capacityQuantum(macro, activity, economy) {
  const resource = activity.kind === 'processing' ? 'goods' : activity.resource;
  const params = economy.resourceParams.find((entry) => entry.resource === resource);
  for (let quantum = 1; quantum <= 10000; quantum += 1) {
    const numerator = quantum * macro.infrastructureBp;
    if (numerator % 10000 !== 0) continue;
    const output = numerator / 10000;
    if ((output * params.accountingValue * params.taxRateBp) % 10000 === 0) return quantum;
  }
  return 10000;
}

function splitMacro(macro, descriptors, economy) {
  const populationById = apportionWithAnchor(descriptors, macro.population, populationQuantum(macro));
  const activities = macro.activities ?? [{ activity: macro.activity, allocationBp: 10000 }];
  if (macro.controllerId === 'polity:united-states') {
    const byNative = new Map(descriptors.map((entry) => [entry.nativeId, entry]));
    const allocations = new Map([
      ['us-east', { activity: activities.find((entry) => entry.activity.kind === 'processing').activity,
        capacity: Math.floor((macro.baseMonthlyCapacity * 2000) / 10000) }],
      ['us-central', { activities: activities.filter((entry) => entry.activity.kind === 'extraction'
        && ['iron', 'oil'].includes(entry.activity.resource)).map((entry) => ({ activity: entry.activity, allocationBp: 5000 })),
        capacity: Math.floor((macro.baseMonthlyCapacity * 4000) / 10000) }],
      ['us-west', { activity: activities.find((entry) => entry.activity.kind === 'extraction'
        && entry.activity.resource === 'food').activity,
        capacity: Math.floor((macro.baseMonthlyCapacity * 4000) / 10000) }],
    ]);
    return [...allocations].map(([nativeId, allocation]) => {
      const descriptor = byNative.get(nativeId);
      return {
        regionId: descriptor.engineRegionId, controllerId: macro.controllerId,
        displayName: { en: descriptor.name, ru: descriptor.name },
        ...(allocation.activities ? { activities: allocation.activities } : { activity: allocation.activity }),
        population: populationById.get(descriptor.engineRegionId),
        annualBirthRateBp: macro.annualBirthRateBp, annualDeathRateBp: macro.annualDeathRateBp,
        workforceRateBp: macro.workforceRateBp, infrastructureBp: macro.infrastructureBp,
        damageBp: macro.damageBp, baseMonthlyCapacity: allocation.capacity,
        outputPerWorker: macro.outputPerWorker,
        capacityCeiling: Math.floor((allocation.capacity * macro.capacityCeiling) / macro.baseMonthlyCapacity),
      };
    }).toSorted((left, right) => left.regionId.localeCompare(right.regionId));
  }
  const processing = activities.find((entry) => entry.activity.kind === 'processing');
  const raw = activities.filter((entry) => entry.activity.kind === 'extraction');
  const processingNativeId = PREFERRED_PROCESSING[macro.controllerId];
  const processingDescriptor = processing
    ? descriptors.find((entry) => entry.nativeId === processingNativeId) ?? descriptors[0]
    : null;
  const assigned = new Map(processingDescriptor ? [[processingDescriptor.engineRegionId, processing]] : []);
  const rawDescriptors = descriptors.filter((entry) => entry.engineRegionId !== processingDescriptor?.engineRegionId)
    .toSorted((left, right) => right.weight - left.weight || left.engineRegionId.localeCompare(right.engineRegionId));
  if (rawDescriptors.length < raw.length) throw new Error(`${macro.controllerId} has fewer regions than authored raw activities`);
  const extraSlots = rawDescriptors.length - raw.length;
  const extras = new Map(apportionIntegerTotal(raw.map((entry) => ({
    id: entry.activity.resource, weight: entry.allocationBp,
  })), extraSlots).map((entry) => [entry.id, entry.amount]));
  const counts = new Map(raw.map((entry) => [entry.activity.resource, 1 + extras.get(entry.activity.resource)]));
  for (const entry of raw) {
    const target = Math.floor((macro.baseMonthlyCapacity * entry.allocationBp) / 10000);
    const quantum = capacityQuantum(macro, entry.activity, economy);
    const maximum = Math.floor(target / quantum) + (target % quantum === 0 ? 0 : 1);
    while (counts.get(entry.activity.resource) > maximum) {
      const recipient = raw.filter((candidate) => candidate !== entry)
        .toSorted((left, right) => right.allocationBp - left.allocationBp
          || left.activity.resource.localeCompare(right.activity.resource))[0];
      counts.set(entry.activity.resource, counts.get(entry.activity.resource) - 1);
      counts.set(recipient.activity.resource, counts.get(recipient.activity.resource) + 1);
    }
  }
  const rawSlots = raw.flatMap((entry) => Array.from({ length: counts.get(entry.activity.resource) }, () => entry));
  rawDescriptors.forEach((entry, index) => assigned.set(entry.engineRegionId, rawSlots[index]));
  const result = [];
  for (const allocated of activities) {
    const group = descriptors.filter((entry) => assigned.get(entry.engineRegionId) === allocated);
    if (group.length === 0) throw new Error(`no runtime region assigned to ${macro.controllerId} activity`);
    const target = Math.floor((macro.baseMonthlyCapacity * allocated.allocationBp) / 10000);
    const capacityById = apportionWithAnchor(group, target, capacityQuantum(macro, allocated.activity, economy), true);
    for (const descriptor of group) {
      const capacity = capacityById.get(descriptor.engineRegionId);
      result.push({
        regionId: descriptor.engineRegionId,
        controllerId: macro.controllerId,
        displayName: { en: descriptor.name, ru: descriptor.name },
        activity: allocated.activity,
        population: populationById.get(descriptor.engineRegionId),
        annualBirthRateBp: macro.annualBirthRateBp,
        annualDeathRateBp: macro.annualDeathRateBp,
        workforceRateBp: macro.workforceRateBp,
        infrastructureBp: macro.infrastructureBp,
        damageBp: macro.damageBp,
        baseMonthlyCapacity: capacity,
        outputPerWorker: macro.outputPerWorker,
        capacityCeiling: Math.max(capacity,
          Math.floor((capacity * (macro.capacityCeiling ?? macro.baseMonthlyCapacity)) / Math.max(1, macro.baseMonthlyCapacity))),
      });
    }
  }
  const capacity = result.reduce((total, entry) => total + entry.baseMonthlyCapacity, 0);
  if (capacity !== macro.baseMonthlyCapacity) throw new Error(`${macro.controllerId} capacity split ${capacity} != ${macro.baseMonthlyCapacity}`);
  return result.toSorted((left, right) => left.regionId.localeCompare(right.regionId));
}

function makeDescriptors(collection, control) {
  const geographic = collection.features.map((feature) => {
    const { polityId, nativeId, nativeName } = feature.properties;
    return {
      polityId,
      nativeId,
      name: nativeName,
      engineRegionId: regionIdFor(polityId, nativeId),
      mapRegionId: mapIdFor(polityId, nativeId),
      weight: Math.max(1, Math.round(area(feature) / 1000)),
      feature,
    };
  });
  const baseline = Object.entries(BASELINE_REGIONS).flatMap(([polityId, rows]) => rows.map((row) => ({
    polityId, ...row, engineRegionId: `region:europe-1935:${row.nativeId}`, mapRegionId: row.nativeId,
  })));
  const all = [...geographic, ...baseline].toSorted((left, right) => left.engineRegionId.localeCompare(right.engineRegionId));
  const knownPolities = new Set(control.macroRegions.map((entry) => entry.controllerId));
  if (all.some((entry) => !knownPolities.has(entry.polityId) && !INERT_POLITIES.some((inert) => inert.id === entry.polityId))) {
    throw new Error('approved geography references an unexpected polity');
  }
  return all;
}

function buildEngineScenario(original, control, descriptors, adjacency) {
  const scenario = structuredClone(original);
  const macroByPolity = new Map(control.macroRegions.map((entry) => [entry.controllerId, entry]));
  const poland = buildPolandRegionalProjectionCandidate({ ...scenario, regions: control.macroRegions,
    military: { ...scenario.military, supplyLinks: [] } }).rows;
  scenario.polities = [
    ...scenario.polities.filter((entry) => ACTIVE_POLITY_IDS.has(entry.id)),
    ...INERT_POLITIES.map((entry) => ({
      id: entry.id, displayName: { en: entry.name, ru: entry.name }, decisionMode: 'inert', treasury: 0,
      stockpile: scenario.activeResources.map((resource) => ({ resource, amount: 0 })),
    })),
  ].toSorted((left, right) => left.id.localeCompare(right.id));
  scenario.regions = [];
  for (const [polityId, polityDescriptors] of Map.groupBy(descriptors, (entry) => entry.polityId)) {
    if (polityId === 'polity:poland') {
      scenario.regions.push(...poland);
    } else if (macroByPolity.has(polityId)) {
      scenario.regions.push(...splitMacro(macroByPolity.get(polityId), polityDescriptors, scenario.economy));
    } else {
      const descriptor = polityDescriptors[0];
      scenario.regions.push({
        regionId: descriptor.engineRegionId, controllerId: polityId,
        displayName: { en: descriptor.name, ru: descriptor.name },
        activity: { kind: 'extraction', resource: 'food' }, population: 0,
        annualBirthRateBp: 0, annualDeathRateBp: 0, workforceRateBp: 0,
        infrastructureBp: 0, damageBp: 0, baseMonthlyCapacity: 0,
        outputPerWorker: 0, capacityCeiling: 0,
      });
    }
  }
  scenario.regions.sort((left, right) => left.regionId.localeCompare(right.regionId));
  scenario.military.polities = [
    ...scenario.military.polities.filter((entry) => ACTIVE_POLITY_IDS.has(entry.polityId)),
    ...INERT_POLITIES.map((entry) => ({ polityId: entry.id, maxMobilizationBp: 100, equipmentReserve: 0 })),
  ].toSorted((left, right) => left.polityId.localeCompare(right.polityId));
  scenario.campaign.legacyBaselines = [
    ...scenario.campaign.legacyBaselines.filter((entry) => ACTIVE_POLITY_IDS.has(entry.polityId)),
    ...INERT_POLITIES.map((entry) => ({ polityId: entry.id, treasuryReference: 1,
      scores: { prosperity: 5000, security: 5000, stability: 5000, diplomacy: 5000, capability: 5000, pluralism: 5000 } })),
  ].toSorted((left, right) => left.polityId.localeCompare(right.polityId));
  const byNative = new Map(descriptors.flatMap((entry) => {
    const nativeId = entry.nativeId.replace('ohm-relation-', '');
    return [[nativeId, entry.engineRegionId], [`${POLITY_CODE[entry.polityId] ?? ''}-${nativeId}`.replace(/^-/, ''), entry.engineRegionId]];
  }));
  const internalLinks = Object.entries(adjacency).flatMap(([polityId, record]) => record.edges.map((edge) => ({
    regions: [
      regionIdFor(polityId, edge.fromRegionId), regionIdFor(polityId, edge.toRegionId),
    ].sort(),
    capacity: 100000,
  })));
  const externalLinks = EXTERNAL_LINKS.map(([left, right, capacity]) => ({
    regions: [byNative.get(left), byNative.get(right)].sort(), capacity,
  }));
  scenario.military.supplyLinks = [...internalLinks, ...externalLinks]
    .toSorted((left, right) => left.regions[0].localeCompare(right.regions[0]) || left.regions[1].localeCompare(right.regions[1]));
  const austriaGoal = scenario.campaign.goals.find((entry) => entry.goalId === 'goal:germany-austria');
  if (austriaGoal) austriaGoal.regionId = byNative.get('wien');
  return parseScenario(scenario);
}

function buildRuntimeAdjacency(approved, descriptors, checkpointManifest) {
  const idByKey = new Map(descriptors.map((entry) => [`${entry.polityId}/${entry.nativeId}`, entry.engineRegionId]));
  const polities = Object.entries(approved).map(([polityId, record]) => ({
    polityId,
    method: record.method,
    regions: record.regions.map((entry) => ({
      regionId: idByKey.get(`${polityId}/${entry.regionId}`),
      adjacentRegionIds: entry.adjacentRegionIds.map((id) => idByKey.get(`${polityId}/${id}`)).sort(),
    })).sort((left, right) => left.regionId.localeCompare(right.regionId)),
    edges: record.edges.map((entry) => ({
      fromRegionId: idByKey.get(`${polityId}/${entry.fromRegionId}`),
      toRegionId: idByKey.get(`${polityId}/${entry.toRegionId}`),
      sharedSegmentCount: entry.sharedSegmentCount,
    })),
  })).sort((left, right) => left.polityId.localeCompare(right.polityId));
  return {
    schemaVersion: 'open-historia-runtime-land-adjacency/1',
    scenarioId: checkpointManifest.scenarioId,
    snapshotDate: checkpointManifest.snapshotDate,
    approvedAdjacencyChecksum: checkpointManifest.adjacencyChecksum,
    polities,
    manualConnections: checkpointManifest.manualConnections,
  };
}

function sourceIdsFor(polityId) {
  if (polityId === 'polity:france') return ['source:europe-1935-benchmark:france-departments-1935', 'source:europe-1935-benchmark:france-military-regions-1935'];
  if (polityId === 'polity:united-kingdom') return ['source:europe-1935-benchmark:historic-counties-trust'];
  if (polityId === 'polity:soviet-union' || polityId === 'polity:united-states') return [];
  return ['source:europe-1935-benchmark:openhistoricalmap'];
}

function updateAuthoring(authoring, control, scenario, descriptors) {
  const nationalById = new Map(control.nationalControls.map((entry) => [entry.polityId, structuredClone(entry)]));
  for (const inert of INERT_POLITIES) nationalById.set(inert.id, {
    polityId: inert.id, population: 0, workforce: 0, maxMobilizationBp: 100,
    treasury: 0, economicPower: 0, stockpile: Object.fromEntries(scenario.activeResources.map((resource) => [resource, 0])),
    industrialCapacity: 0, infrastructureIndexBp: 0,
    sourceRefs: ['source:europe-1935-benchmark:openhistoricalmap'],
    method: 'Inert one-region polity: dated territorial presence is canonical; numeric economy is explicitly zero in the bounded benchmark.',
    confidence: 'low', todo: 'Add sourced local population and economic values if inert-polity economics becomes strategically material.',
  });
  authoring.nationalControls = [...nationalById.values()].toSorted((left, right) => left.polityId.localeCompare(right.polityId));
  const descriptorById = new Map(descriptors.map((entry) => [entry.engineRegionId, entry]));
  const nationalRefs = new Map(authoring.nationalControls.map((entry) => [entry.polityId, entry.sourceRefs]));
  authoring.regionalControls = scenario.regions.map((region) => {
    const descriptor = descriptorById.get(region.regionId);
    const refs = [...new Set([...(nationalRefs.get(region.controllerId) ?? []), ...sourceIdsFor(region.controllerId)])];
    const regionalBasis = region.controllerId === 'polity:poland'
      ? 'GUS 1931 voivodeship population weights plus a deterministic five-person reconciliation; capacity is an explicit national-control-preserving estimate.'
      : BASELINE_REGIONS[region.controllerId]
      ? 'Authored strategic macro-region weights preserve the national control exactly.'
      : INERT_POLITIES.some((entry) => entry.id === region.controllerId)
      ? 'Dated one-region inert polity with explicitly zero bounded-scenario economy.'
      : 'Approved polygon area weights allocate population; activity-group capacity allocation preserves national controls and the aggregate first month exactly.';
    return {
      regionId: region.regionId, population: region.population,
      baseMonthlyCapacity: region.baseMonthlyCapacity, infrastructureBp: region.infrastructureBp,
      sourceRefs: refs, method: regionalBasis, confidence: region.controllerId === 'polity:poland' ? 'medium' : 'low',
      todo: descriptor?.feature?.properties?.todo
        ?? 'Replace strategic allocation weights with table-level regional population, infrastructure and production evidence.',
    };
  }).toSorted((left, right) => left.regionId.localeCompare(right.regionId));
  return authoring;
}

function updateScenarioV2(scenario, engineScenario, descriptors) {
  for (const inert of INERT_POLITIES) scenario.polities[inert.id] = { id: inert.id, name: inert.name, color: inert.color };
  scenario.polities = Object.fromEntries(Object.entries(scenario.polities).sort(([left], [right]) => left.localeCompare(right)));
  scenario.regions = engineScenario.regions.map((region) => {
    const [, dataset, nativeId] = region.regionId.split(':');
    const split = dataset.lastIndexOf('-');
    return { id: region.regionId, dataset: dataset.slice(0, split), datasetVersion: dataset.slice(split + 1), nativeId };
  });
  scenario.regionAssignments = Object.fromEntries(engineScenario.regions.map((region) => [region.regionId, region.controllerId]));
  const descriptorById = new Map(descriptors.map((entry) => [entry.engineRegionId, entry]));
  const supported = Object.entries(scenario.fidelity.polityLevels).filter(([, level]) => level === 'Supported').map(([id]) => id);
  const macroRegions = supported.map((polityId) => ({
    id: `macro-region:europe-1935-benchmark:${POLITY_CODE[polityId]}-aggregation`,
    name: `${scenario.polities[polityId].name} aggregation`,
    members: engineScenario.regions.filter((entry) => entry.controllerId === polityId).map((entry) => entry.regionId),
    purpose: 'aggregation',
    geometryAssetRef: 'asset:europe-1935-benchmark:regions',
  }));
  for (const inert of INERT_POLITIES) macroRegions.push({
    id: `macro-region:europe-1935-benchmark:${POLITY_CODE[inert.id]}-aggregation`, name: inert.name,
    members: engineScenario.regions.filter((entry) => entry.controllerId === inert.id).map((entry) => entry.regionId),
    purpose: 'historical-area', geometryAssetRef: 'asset:europe-1935-benchmark:regions',
  });
  for (const [polityId, rows] of Object.entries(BASELINE_REGIONS)) for (const row of rows) macroRegions.push({
    id: `macro-region:europe-1935-benchmark:${row.nativeId}`,
    name: row.name, members: [descriptorById.get(`region:europe-1935:${row.nativeId}`).engineRegionId], purpose: 'aggregation',
  });
  scenario.macroRegions = macroRegions.toSorted((left, right) => left.id.localeCompare(right.id));
  scenario.fidelity.polityLevels['polity:free-city-of-danzig'] = 'Baseline';
  scenario.fidelity.polityLevels['polity:saargebiet'] = 'Baseline';
  scenario.fidelity.polityLevels = Object.fromEntries(Object.entries(scenario.fidelity.polityLevels).sort(([left], [right]) => left.localeCompare(right)));
  scenario.assumptions[0] = {
    id: 'assumption:europe-1935-benchmark:macro-abstraction',
    statement: 'Approved 1935 geometry is runtime canonical; regional numeric allocations remain national-control-preserving estimates except for Poland census weights.',
    rationale: 'The benchmark requires deterministic regional play before table-level evidence exists for every regional economy.',
    affectedPaths: ['/regions', '/macroRegions', '/fidelity'],
    sourceRefs: ['source:europe-1935-benchmark:league-yearbook', 'source:europe-1935-benchmark:openhistoricalmap'],
    status: 'authored',
  };
  scenario.fidelity.gaps = [{
    path: '/regions', disposition: 'assumption',
    reason: 'Regional population, infrastructure and production allocations remain estimates documented row by row in authoring.json.',
    assumptionRef: 'assumption:europe-1935-benchmark:macro-abstraction',
  }];
  return scenario;
}

function buildMapLink(engineScenario, descriptors) {
  const polityOwnerNames = Object.fromEntries(engineScenario.polities.map((entry) => [entry.id, entry.displayName.en]));
  return {
    schemaVersion: 'open-historia-engine-map-link/2', dataset: 'europe-1935',
    note: 'Owner-approved dated custom geometry; baseline US/USSR macro-regions remain strategic abstractions outside the European asset.',
    polityOwnerNames,
    regions: descriptors.map((entry) => ({ engineRegionId: entry.engineRegionId, mapRegionIds: [entry.mapRegionId], mapName: entry.name })),
  };
}

function runtimeGeoJson(collection, descriptors) {
  const byKey = new Map(descriptors.map((entry) => [`${entry.polityId}/${entry.nativeId}`, entry]));
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      const descriptor = byKey.get(`${feature.properties.polityId}/${feature.properties.nativeId}`);
      return {
        type: 'Feature', geometry: feature.geometry,
        properties: {
          ...feature.properties, id: descriptor.mapRegionId, regionId: descriptor.engineRegionId,
          name: descriptor.name, owner: descriptor.polityId, edited: true,
        },
      };
    }),
  };
}

function ensureGeographySources(sources, checkpoint) {
  const additions = [
    { id: 'source:europe-1935-benchmark:openhistoricalmap', title: 'OpenHistoricalMap dated administrative boundaries', publisher: 'OpenHistoricalMap contributors',
      locator: 'https://www.openhistoricalmap.org/copyright', retrievedAt: '2026-09-03', contentHash: checkpoint.sources[0].candidateResponseChecksum,
      license: { status: 'redistributable', name: 'CC0 for selected default-licensed objects', url: 'https://www.openhistoricalmap.org/copyright' },
      note: 'Only object rows passing the checkpoint license gate are redistributed; exact response checksums and per-object dates/licenses are bound in runtime-geography-manifest.json.' },
    { id: 'source:europe-1935-benchmark:france-departments-1935', title: 'French Departments 1935', publisher: 'TRF-GIS / Harvard Dataverse', publicationDate: '2020',
      locator: 'https://doi.org/10.7910/DVN/ULQYM5', retrievedAt: '2026-09-03', contentHash: checkpoint.sources[1].datasets[0].checksum,
      license: { status: 'redistributable', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } },
    { id: 'source:europe-1935-benchmark:france-military-regions-1935', title: 'French Military Regions 1935', publisher: 'TRF-GIS / Harvard Dataverse', publicationDate: '2020',
      locator: 'https://doi.org/10.7910/DVN/SQPEUW', retrievedAt: '2026-09-03', contentHash: checkpoint.sources[1].datasets[1].checksum,
      license: { status: 'redistributable', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } },
    { id: 'source:europe-1935-benchmark:historic-counties-trust', title: checkpoint.sources[2].dataset, publisher: 'Historic Counties Trust',
      locator: checkpoint.sources[2].termsUrl, retrievedAt: '2026-09-03', contentHash: checkpoint.sources[2].checksum,
      license: { status: 'redistributable', name: checkpoint.sources[2].license, url: checkpoint.sources[2].termsUrl },
      note: 'Definition A county polygons are grouped into owner-approved strategic regions; acknowledgement requested by the publisher.' },
  ];
  const byId = new Map(sources.map((entry) => [entry.id, entry]));
  for (const entry of additions) byId.set(entry.id, entry);
  return [...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

export function publishGeography(checkpointDirectory = DEFAULT_CHECKPOINT) {
  const checkpoint = readJson(path.join(checkpointDirectory, 'owner-geography-manifest.json'));
  if (checkpoint.gate?.status !== 'owner-approval-ready' || checkpoint.collectionChecksum !== EXPECTED_APPROVED_COLLECTION
    || checkpoint.adjacencyChecksum !== EXPECTED_APPROVED_ADJACENCY) throw new Error('geography checkpoint is not the owner-approved immutable candidate');
  const collection = readJson(path.join(checkpointDirectory, 'owner-regions.geojson'));
  const adjacency = readJson(path.join(checkpointDirectory, 'owner-land-adjacency.json'));
  if (sha256(canonical(collection)) !== checkpoint.collectionChecksum || sha256(canonical(adjacency)) !== checkpoint.adjacencyChecksum) {
    throw new Error('owner-approved geography payload checksum mismatch');
  }
  const original = readJson(path.join(FIXTURE_ROOT, 'engine', 'scenario.json'));
  const authoring = readJson(path.join(FIXTURE_ROOT, 'authoring.json'));
  const control = ensureControl(original, authoring, checkpoint);
  const descriptors = makeDescriptors(collection, control);
  const engineScenario = buildEngineScenario(original, control, descriptors, adjacency);
  const expectedBaseline = readJson(path.join(FIXTURE_ROOT, 'engine', 'first-month-baseline.json'));
  const actualBaseline = buildFirstMonthBaseline(resolveMonth(initState(engineScenario), { commands: [] }));
  const comparison = compareFirstMonthBaseline(expectedBaseline, actualBaseline);
  if (!comparison.matches) throw new Error(`runtime geography changes the first month: ${JSON.stringify(comparison)}`);

  const runtimeRegions = runtimeGeoJson(collection, descriptors);
  const runtimeAdjacency = buildRuntimeAdjacency(adjacency, descriptors, checkpoint);
  const regionsPath = path.join(FIXTURE_ROOT, 'geography', 'runtime-regions.geojson');
  const adjacencyPath = path.join(FIXTURE_ROOT, 'geography', 'runtime-land-adjacency.json');
  writeJson(regionsPath, runtimeRegions, true);
  writeJson(adjacencyPath, runtimeAdjacency);
  const runtimeManifest = {
    ...checkpoint,
    schemaVersion: 'open-historia-geography-runtime-manifest/1',
    gate: { status: 'owner-approved-runtime', runtimeIntegrated: true },
    approvedCheckpoint: {
      collectionChecksum: checkpoint.collectionChecksum,
      adjacencyChecksum: checkpoint.adjacencyChecksum,
      candidatePlanChecksum: checkpoint.candidatePlanChecksum,
    },
    runtime: {
      regionCount: engineScenario.regions.length,
      polityCount: engineScenario.polities.length,
      activeStrategicPolities: engineScenario.polities.filter((entry) => entry.decisionMode !== 'inert').length,
      inertPolities: engineScenario.polities.filter((entry) => entry.decisionMode === 'inert').map((entry) => entry.id),
      regionsAssetChecksum: sha256(fs.readFileSync(regionsPath)),
      adjacencyAssetChecksum: sha256(fs.readFileSync(adjacencyPath)),
      firstMonthChecksum: actualBaseline.checksum,
    },
  };
  const runtimeManifestPath = path.join(FIXTURE_ROOT, 'geography', 'runtime-geography-manifest.json');
  writeJson(runtimeManifestPath, runtimeManifest);

  const scenarioV2 = updateScenarioV2(readJson(path.join(FIXTURE_ROOT, 'scenario.json')), engineScenario, descriptors);
  const updatedAuthoring = updateAuthoring(authoring, control, engineScenario, descriptors);
  const mapLink = buildMapLink(engineScenario, descriptors);
  const sources = ensureGeographySources(readJson(path.join(FIXTURE_ROOT, 'sources.json')), checkpoint);
  const manifest = readJson(path.join(FIXTURE_ROOT, 'manifest.json'));
  manifest.assets = [
    { id: 'asset:europe-1935-benchmark:regions', kind: 'regions', path: 'geography/runtime-regions.geojson',
      contentAddress: runtimeManifest.runtime.regionsAssetChecksum, mediaType: 'application/geo+json', required: true },
    { id: 'asset:europe-1935-benchmark:land-adjacency', kind: 'other', path: 'geography/runtime-land-adjacency.json',
      contentAddress: runtimeManifest.runtime.adjacencyAssetChecksum, mediaType: 'application/json', required: true },
    { id: 'asset:europe-1935-benchmark:geography-manifest', kind: 'other', path: 'geography/runtime-geography-manifest.json',
      contentAddress: sha256(fs.readFileSync(runtimeManifestPath)), mediaType: 'application/json', required: true },
  ];
  writeJson(path.join(FIXTURE_ROOT, 'engine', 'scenario.json'), engineScenario);
  writeJson(path.join(FIXTURE_ROOT, 'engine', 'map-link.json'), mapLink);
  writeJson(path.join(FIXTURE_ROOT, 'scenario.json'), scenarioV2);
  writeJson(path.join(FIXTURE_ROOT, 'authoring.json'), updatedAuthoring);
  writeJson(path.join(FIXTURE_ROOT, 'sources.json'), sources);
  writeJson(path.join(FIXTURE_ROOT, 'manifest.json'), manifest);
  return { regionCount: engineScenario.regions.length, polityCount: engineScenario.polities.length,
    firstMonthChecksum: actualBaseline.checksum, geographyChecksum: checkpoint.collectionChecksum };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const inputIndex = process.argv.indexOf('--checkpoint');
  const checkpoint = inputIndex >= 0 ? path.resolve(process.argv[inputIndex + 1]) : DEFAULT_CHECKPOINT;
  try { process.stdout.write(`${JSON.stringify(publishGeography(checkpoint), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
