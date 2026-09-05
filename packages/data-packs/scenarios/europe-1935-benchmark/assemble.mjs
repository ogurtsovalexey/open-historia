import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(packageDir, '../../fixtures/europe-1935-benchmark');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const compareIds = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sortRecord = (record) => Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareIds(left, right)));
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareIds(left, right)).map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
};
const canonicalStringify = (value) => JSON.stringify(canonicalize(value));
const checksum = (value) => `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalStringify(value), 'utf8').digest('hex')}`;
const evidenceChecksum = (value) => {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize).sort((left, right) => compareIds(canonicalStringify(left), canonicalStringify(right)));
    if (entry !== null && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([key, nested]) => [key, normalize(nested)]));
    return entry;
  };
  return checksum(normalize(value));
};
const pointerToken = (value) => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const atPointer = (root, pointer) => pointer.slice(1).split('/').reduce((current, token) => current[token.replace(/~1/g, '/').replace(/~0/g, '~')], root);
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const uniqueSorted = (values) => [...new Set(values)].sort(compareIds);
const playerEligiblePolityIds = [
  'polity:austria',
  'polity:czechoslovakia',
  'polity:france',
  'polity:germany',
  'polity:italy',
  'polity:poland',
  'polity:united-kingdom',
];
const playerEligiblePolityIdSet = new Set(playerEligiblePolityIds);

const [legacyScenario, v2Scenario, sources, authoring, mapLink, adjacency, geographyManifest, geojson] = await Promise.all([
  readJson(resolve(fixtureDir, 'engine/scenario.json')),
  readJson(resolve(fixtureDir, 'scenario.json')),
  readJson(resolve(fixtureDir, 'sources.json')),
  readJson(resolve(fixtureDir, 'authoring.json')),
  readJson(resolve(fixtureDir, 'engine/map-link.json')),
  readJson(resolve(fixtureDir, 'geography/runtime-land-adjacency.json')),
  readJson(resolve(fixtureDir, 'geography/runtime-geography-manifest.json')),
  readJson(resolve(fixtureDir, 'geography/runtime-regions.geojson')),
]);

const sourceRecords = Object.fromEntries(sources.map((source) => [source.id, {
  id: source.id,
  title: source.title,
  locator: source.locator,
  checksum: source.contentHash ?? checksum(source),
}]));
const fallbackSourceIds = ['source:europe-1935-benchmark:league-yearbook'];
const nationalByPolity = new Map(authoring.nationalControls.map((entry) => [entry.polityId, entry]));
const regionalByRegion = new Map(authoring.regionalControls.map((entry) => [entry.regionId, entry]));
const claimByPath = new Map(authoring.startingStateProvenance.map((entry) => [entry.scenarioPath, entry]));
const sourceBasis = (entry, defaultMethod) => ({
  kind: 'historical',
  sourceIds: uniqueSorted(entry?.sourceRefs?.filter((id) => sourceRecords[id]) ?? fallbackSourceIds),
  observationDate: '1935-01-01',
  method: entry?.method ?? defaultMethod,
  confidence: entry?.confidence ?? 'low',
  ...((entry?.confidence ?? 'low') === 'low' ? { todo: entry?.todo ?? 'Retain the existing reviewed estimate until a more specific source is approved.' } : {}),
});

const correctedFeatureId = (id) => id.replace('e1935-undefined-ohm-relation-', 'e1935-ohm-relation-');
const correctedGeojson = {
  ...geojson,
  features: geojson.features.map((feature) => ({
    ...feature,
    properties: { ...feature.properties, id: correctedFeatureId(feature.properties.id) },
  })),
};
const geographyPath = resolve(packageDir, 'geography/runtime-regions.geojson');
await mkdir(dirname(geographyPath), { recursive: true });
const geographyText = `${JSON.stringify(correctedGeojson)}\n`;
await writeFile(geographyPath, geographyText, 'utf8');

const colors = new Map(Object.values(v2Scenario.polities).map((polity) => [polity.id, polity.color]));
const legacyRegions = [...legacyScenario.regions].sort((left, right) => compareIds(left.regionId, right.regionId));
const regionsByPolity = new Map();
for (const region of legacyRegions) {
  const rows = regionsByPolity.get(region.controllerId) ?? [];
  rows.push(region);
  regionsByPolity.set(region.controllerId, rows);
}
const adjacencyByRegion = new Map();
for (const polity of adjacency.polities) for (const region of polity.regions) adjacencyByRegion.set(region.regionId, new Set(region.adjacentRegionIds));
const resolveManualEndpoint = (endpoint) => {
  const separator = endpoint.indexOf('/');
  const polityId = endpoint.slice(0, separator);
  const localId = endpoint.slice(separator + 1);
  return (regionsByPolity.get(polityId) ?? []).find((region) => region.regionId.endsWith(`:${localId}`) || region.regionId.endsWith(`-${localId}`))?.regionId;
};
for (const connection of adjacency.manualConnections) {
  const from = resolveManualEndpoint(connection.from);
  const to = resolveManualEndpoint(connection.to);
  if (!from || !to) throw new Error(`Cannot resolve authored manual connection ${connection.from} -> ${connection.to}`);
  (adjacencyByRegion.get(from) ?? new Set()).add(to);
  (adjacencyByRegion.get(to) ?? new Set()).add(from);
  if (!adjacencyByRegion.has(from)) adjacencyByRegion.set(from, new Set([to]));
  if (!adjacencyByRegion.has(to)) adjacencyByRegion.set(to, new Set([from]));
}
const mapLinkByRegion = new Map(mapLink.regions.map((entry) => [entry.engineRegionId, entry]));
const renderedFeatureIds = new Set(correctedGeojson.features.map((feature) => feature.properties.id));

const evidence = {};
const addEvidence = (id, path, basis, visibility = 'public', visibleToPolityIds) => {
  evidence[id] = {
    id,
    binding: { path, valueChecksum: `sha256:${'0'.repeat(64)}` },
    basis,
    visibility,
    ...(visibleToPolityIds ? { visibleToPolityIds } : {}),
  };
  return id;
};

const polities = {};
for (const polity of [...legacyScenario.polities].sort((left, right) => compareIds(left.id, right.id))) {
  const evidenceId = `evidence:e1935-polity-${slug(polity.id.slice('polity:'.length))}`;
  polities[polity.id] = {
    id: polity.id,
    displayName: polity.displayName,
    color: colors.get(polity.id),
    decisionMode: polity.decisionMode ?? (playerEligiblePolityIdSet.has(polity.id) ? 'active' : 'supported'),
    treasury: polity.treasury,
    stockpiles: Object.fromEntries(polity.stockpile.map((entry) => [`commodity:${entry.resource}`, entry.amount]).sort(([left], [right]) => compareIds(left, right))),
    evidenceIds: [evidenceId],
  };
  addEvidence(evidenceId, `/startingState/polities/${pointerToken(polity.id)}`, sourceBasis(nationalByPolity.get(polity.id), 'Direct deterministic migration of the approved national control row.'));
}

const regions = {};
const cohorts = {};
for (const region of legacyRegions) {
  const suffix = slug(region.regionId.replace(/^region:/, ''));
  const regionEvidenceId = `evidence:e1935-region-${suffix}`;
  const cohortId = `cohort:e1935-${suffix}`;
  const cohortEvidenceId = `evidence:e1935-cohort-${suffix}`;
  const regionalControl = regionalByRegion.get(region.regionId);
  const regionalResources = region.activity?.kind === 'extraction'
    ? { [`commodity:${region.activity.resource}`]: region.baseMonthlyCapacity }
    : {};
  regions[region.regionId] = {
    id: region.regionId,
    displayName: region.displayName,
    legalOwnerPolityId: region.controllerId,
    actualControllerPolityId: region.controllerId,
    controlProfileId: 'control-profile:sovereign',
    fiscalBase: region.baseMonthlyCapacity,
    productiveCapacity: region.baseMonthlyCapacity,
    supplyCapacity: region.capacityCeiling,
    resources: regionalResources,
    evidenceIds: [regionEvidenceId],
  };
  cohorts[cohortId] = {
    id: cohortId,
    regionId: region.regionId,
    population: region.population,
    workforceParticipationBp: region.workforceRateBp,
    recruitmentEligibilityBp: nationalByPolity.get(region.controllerId).maxMobilizationBp,
    evidenceIds: [cohortEvidenceId],
  };
  const basis = sourceBasis(regionalControl, 'Direct deterministic migration of the approved regional control row.');
  addEvidence(regionEvidenceId, `/startingState/regions/${pointerToken(region.regionId)}`, basis);
  addEvidence(cohortEvidenceId, `/startingState/populationCohorts/${pointerToken(cohortId)}`, basis);
}

const largestRemainder = (total, polityRegions) => {
  const population = polityRegions.reduce((sum, region) => sum + BigInt(region.population), 0n);
  const rows = polityRegions.map((region) => {
    const numerator = BigInt(total) * BigInt(region.population);
    return { regionId: region.regionId, personnel: Number(numerator / population), remainder: numerator % population };
  });
  let unassigned = total - rows.reduce((sum, row) => sum + row.personnel, 0);
  for (const row of [...rows].sort((left, right) => left.remainder === right.remainder ? compareIds(left.regionId, right.regionId) : left.remainder > right.remainder ? -1 : 1)) {
    if (unassigned-- <= 0) break;
    row.personnel += 1;
  }
  return Object.fromEntries(rows.filter((row) => row.personnel > 0).sort((left, right) => compareIds(left.regionId, right.regionId)).map((row) => [row.regionId, row.personnel]));
};
const formations = {};
for (const [index, formation] of legacyScenario.military.formations.entries()) {
  const evidenceId = `evidence:e1935-${slug(formation.formationId)}`;
  formations[formation.formationId] = {
    id: formation.formationId,
    polityId: formation.polityId,
    archetypeId: 'formation-archetype:home-theatre',
    personnelOrigins: largestRemainder(formation.manpower, regionsByPolity.get(formation.polityId)),
    equipment: { 'equipment-class:general-equipment': formation.equipment },
    evidenceIds: [evidenceId],
  };
  const claim = claimByPath.get(`/military/formations/${index}`);
  const regionalSources = (regionsByPolity.get(formation.polityId) ?? []).flatMap((region) => regionalByRegion.get(region.regionId)?.sourceRefs ?? []);
  addEvidence(evidenceId, `/startingState/formations/${pointerToken(formation.formationId)}`, sourceBasis({
    ...claim,
    sourceRefs: uniqueSorted([...(claim?.sourceRefs ?? []), ...regionalSources]),
    method: `${claim?.method ?? 'Directly migrate the aggregate formation.'} Personnel origins use deterministic largest-remainder allocation over the approved regional population controls for the formation polity; no personnel are added or removed.`,
  }, 'Deterministic formation migration with conserved regional personnel origins.'));
}

const institutions = {};
for (const [index, polityPolitics] of legacyScenario.politics.polities.entries()) {
  const institutionId = `institution:e1935-government-${slug(polityPolitics.polityId.slice('polity:'.length))}`;
  const evidenceId = `evidence:e1935-${slug(institutionId)}`;
  institutions[institutionId] = {
    id: institutionId,
    typeId: 'institution-type:government',
    polityId: polityPolitics.polityId,
    evidenceIds: [evidenceId],
  };
  addEvidence(evidenceId, `/startingState/institutions/${pointerToken(institutionId)}`, sourceBasis(claimByPath.get(`/politics/polities/${index}`), 'Project the approved polity political authority as a scenario-owned government institution.'));
}

const relationships = {};
for (const [index, relation] of legacyScenario.diplomacy.relations.entries()) {
  const id = `relationship:e1935-strategic-${index.toString().padStart(2, '0')}`;
  const evidenceId = `evidence:e1935-${slug(id)}`;
  relationships[id] = { id, typeId: 'relationship-type:strategic-relation', participantPolityIds: uniqueSorted(relation.polities), evidenceIds: [evidenceId] };
  addEvidence(evidenceId, `/startingState/relationships/${pointerToken(id)}`, sourceBasis(claimByPath.get(`/diplomacy/relations/${index}`), 'Project the approved bilateral relation participants without inventing unsupported numeric semantics.'));
}
for (const [index, agreement] of legacyScenario.diplomacy.startingAgreements.entries()) {
  const id = `relationship:e1935-${slug(agreement.agreementId)}`;
  const evidenceId = `evidence:e1935-${slug(id)}`;
  relationships[id] = {
    id,
    typeId: `relationship-type:${slug(agreement.terms.agreementType)}`,
    participantPolityIds: uniqueSorted([agreement.terms.fromPolityId, agreement.terms.toPolityId]),
    evidenceIds: [evidenceId],
  };
  addEvidence(evidenceId, `/startingState/relationships/${pointerToken(id)}`, sourceBasis(claimByPath.get(`/diplomacy/startingAgreements/${index}`), 'Direct deterministic migration of the approved in-force agreement participants and type.'));
}

const conceptTypes = {
  'capability:administrative-coordination': 'institution',
  'capability:industrial-planning': 'economic-practice',
  'capability:staff-planning': 'doctrine',
};
const concepts = {};
for (const [index, capability] of legacyScenario.capabilities.catalog.entries()) {
  const conceptId = capability.capabilityId.replace('capability:', 'concept:');
  const evidenceId = `evidence:e1935-${slug(conceptId)}`;
  concepts[conceptId] = {
    id: conceptId,
    type: conceptTypes[capability.capabilityId],
    semanticKey: slug(capability.capabilityId.slice('capability:'.length)),
    displayName: capability.displayName,
    description: {
      en: `Scenario-authored starting capability: ${capability.displayName.en}.`,
      ...(capability.displayName.ru ? { ru: `Авторская стартовая возможность сценария: ${capability.displayName.ru}.` } : {}),
    },
    origin: { originEntityRefs: Object.keys(polities).sort(compareIds), originMonth: '1935-01-01' },
    parentConceptIds: capability.prerequisiteIds.map((id) => id.replace('capability:', 'concept:')).sort(compareIds),
    supportingEvidenceIds: [evidenceId],
    domains: [`domain:${slug(capability.domain)}`],
    status: 'proposed',
    maturityBp: 0,
    diffusion: {},
    adoption: { polities: {}, regions: {} },
    sourceEvidenceId: evidenceId,
    evidenceIds: [evidenceId],
  };
  addEvidence(evidenceId, `/startingState/concepts/${pointerToken(conceptId)}`, sourceBasis(claimByPath.get(`/capabilities/catalog/${index}`), 'Losslessly translate the approved capability definition into a non-adopted starting concept; no polity adoption or effect is invented.'));
}

const geographicRegions = {};
for (const region of legacyRegions) {
  const mapEntry = mapLinkByRegion.get(region.regionId);
  if (!mapEntry) throw new Error(`Missing authored map link for ${region.regionId}`);
  const featureId = correctedFeatureId(mapEntry.mapRegionIds[0]);
  geographicRegions[region.regionId] = {
    id: region.regionId,
    link: renderedFeatureIds.has(featureId)
      ? { kind: 'scenario-asset', assetId: 'asset:europe-1935:regions', featureId }
      : { kind: 'off-map', reason: mapLink.note },
    adjacentRegionIds: uniqueSorted([...(adjacencyByRegion.get(region.regionId) ?? [])]),
  };
}

const modules = Object.fromEntries(Object.entries(legacyScenario.modules).filter(([, enabled]) => enabled).map(([id]) => {
  const moduleId = `module:${kebab(id)}`;
  return [moduleId, { id: moduleId, kind: kebab(id) }];
}).sort(([left], [right]) => compareIds(left, right)));
const commodities = Object.fromEntries([...legacyScenario.activeResources].sort(compareIds).map((id) => [`commodity:${id}`, { id: `commodity:${id}`, unitId: 'unit:quantity', usage: 'both' }]));
const activities = Object.fromEntries([
  ...legacyScenario.activeResources.filter((id) => id !== 'goods').map((id) => [`activity:extract-${id}`, { id: `activity:extract-${id}`, inputCommodityIds: [], outputCommodityIds: [`commodity:${id}`] }]),
  ['activity:basic-goods', { id: 'activity:basic-goods', inputCommodityIds: ['commodity:coal', 'commodity:iron'], outputCommodityIds: ['commodity:goods'] }],
].sort(([left], [right]) => compareIds(left, right)));

const scenario = {
  schemaVersion: 'open-historia-scenario/3',
  id: legacyScenario.scenarioId,
  profile: 'historical',
  metadata: {
    title: { en: v2Scenario.meta.locales.en.title, ru: v2Scenario.meta.locales.ru.title },
    description: { en: v2Scenario.meta.locales.en.description, ru: v2Scenario.meta.locales.ru.description },
  },
  game: {
    startDate: v2Scenario.game.startDate,
    defaultPlayerPolityId: v2Scenario.game.defaultPlayer,
    playerEligiblePolityIds,
  },
  worldRules: {
    physicalModel: 'world-model:physical-historical-earth',
    knowledgeBaseline: Object.keys(concepts).sort(compareIds),
    communicationModel: 'world-model:communication-radio-rail',
    governmentModel: 'world-model:government-interwar',
    militaryModel: 'world-model:military-theatre-aggregate',
    hardProhibitions: ['No automatic historical events', 'No tactical naval simulation'],
    plausibilityContext: [v2Scenario.simulationRules.eraNarrative, ...v2Scenario.simulationRules.technologyLevel.notable],
  },
  modules: { enabled: Object.keys(modules).sort(compareIds) },
  catalogs: {
    modules,
    worldModels: {
      'world-model:physical-historical-earth': { id: 'world-model:physical-historical-earth', kind: 'physical' },
      'world-model:communication-radio-rail': { id: 'world-model:communication-radio-rail', kind: 'communication' },
      'world-model:government-interwar': { id: 'world-model:government-interwar', kind: 'government' },
      'world-model:military-theatre-aggregate': { id: 'world-model:military-theatre-aggregate', kind: 'military' },
    },
    commodities,
    activities,
    recipes: { 'recipe:basic-goods': { id: 'recipe:basic-goods', inputs: { 'commodity:coal': 1, 'commodity:iron': 1 }, outputs: { 'commodity:goods': 1 } } },
    institutionTypes: { 'institution-type:government': { id: 'institution-type:government' } },
    officeTypes: {
      'office-type:head-of-state': { id: 'office-type:head-of-state' },
      'office-type:head-of-government': { id: 'office-type:head-of-government' },
      'office-type:decision-authority': { id: 'office-type:decision-authority' },
      'office-type:military-commander': { id: 'office-type:military-commander' },
    },
    formationArchetypes: { 'formation-archetype:home-theatre': { id: 'formation-archetype:home-theatre', equipmentClassIds: ['equipment-class:general-equipment'] } },
    equipmentClasses: { 'equipment-class:general-equipment': { id: 'equipment-class:general-equipment' } },
    financeProfiles: { 'finance-profile:state-budget-credit': { id: 'finance-profile:state-budget-credit', revenueChannelIds: ['revenue-channel:taxation'], instrumentIds: ['finance-instrument:public-debt'] } },
    revenueChannels: { 'revenue-channel:taxation': { id: 'revenue-channel:taxation' } },
    financeInstruments: { 'finance-instrument:public-debt': { id: 'finance-instrument:public-debt' } },
    controlProfiles: { 'control-profile:sovereign': { id: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000, extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000 } },
    relationshipTypes: {
      'relationship-type:strategic-relation': { id: 'relationship-type:strategic-relation' },
      'relationship-type:defensive-alliance': { id: 'relationship-type:defensive-alliance' },
    },
    routeClasses: { 'route-class:inter-polity-trade': { id: 'route-class:inter-polity-trade' } },
    terminology: {
      'term:formation': { en: 'theatre formation', ru: 'театральное формирование' },
      'term:treasury': { en: 'state treasury', ru: 'государственная казна' },
    },
  },
  geography: {
    assets: {
      'asset:europe-1935:regions': {
        id: 'asset:europe-1935:regions',
        mediaType: 'application/geo+json',
        checksum: checksum(geographyText),
        license: uniqueSorted(geographyManifest.objects.flatMap((entry) => entry.license ?? [])).join('; '),
        effectiveDate: '1935-01-01',
      },
    },
    regions: sortRecord(geographicRegions),
  },
  startingState: {
    polities: sortRecord(polities),
    regions: sortRecord(regions),
    populationCohorts: sortRecord(cohorts),
    formations: sortRecord(formations),
    institutions: sortRecord(institutions),
    relationships: sortRecord(relationships),
    diplomaticProposals: {},
    routes: {},
    concepts: sortRecord(concepts),
    knowledge: {},
  },
  provenance: { sources: sortRecord(sourceRecords), evidence },
};

addEvidence('evidence:e1935-world-rules', '/worldRules', sourceBasis(undefined, 'Directly migrate the approved 1935 scenario constraints and plausibility context.'));
addEvidence('evidence:e1935-catalogs', '/catalogs', sourceBasis(undefined, 'Deterministically translate the approved engine vocabulary into scenario-owned declarative catalogs.'));
addEvidence('evidence:e1935-geography', '/geography', sourceBasis({
  sourceRefs: ['source:europe-1935-benchmark:openhistoricalmap'],
  method: 'Use the owner-approved 1935 runtime geography; remove the literal undefined token from sixteen OHM relation feature IDs and declare the six baseline macro-regions off-map.',
  confidence: 'high',
}, 'Deterministic geography migration.'));

scenario.provenance.evidence = sortRecord(evidence);
for (const record of Object.values(scenario.provenance.evidence)) record.binding.valueChecksum = evidenceChecksum(atPointer(scenario, record.binding.path));
const canonicalScenario = canonicalize(scenario);
await writeFile(resolve(packageDir, 'scenario.json'), `${JSON.stringify(canonicalScenario, null, 2)}\n`, 'utf8');

const manifest = {
  schemaVersion: 'open-historia-scenario-package/3',
  scenarioId: scenario.id,
  scenarioPath: 'scenario.json',
  geographyAssets: [{ path: 'geography/runtime-regions.geojson', checksum: scenario.geography.assets['asset:europe-1935:regions'].checksum }],
  deterministicInputs: [
    '../../fixtures/europe-1935-benchmark/engine/scenario.json',
    '../../fixtures/europe-1935-benchmark/scenario.json',
    '../../fixtures/europe-1935-benchmark/sources.json',
    '../../fixtures/europe-1935-benchmark/authoring.json',
    '../../fixtures/europe-1935-benchmark/engine/map-link.json',
    '../../fixtures/europe-1935-benchmark/geography/runtime-land-adjacency.json',
    '../../fixtures/europe-1935-benchmark/geography/runtime-geography-manifest.json',
    '../../fixtures/europe-1935-benchmark/geography/runtime-regions.geojson',
  ],
  scenarioChecksum: checksum(canonicalScenario),
};
await writeFile(resolve(packageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
