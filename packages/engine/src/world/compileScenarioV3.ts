import { createHash } from 'node:crypto';
import { canonicalStringify, scenarioV3 } from '@open-historia/data-packs';
import {
  WORLD_SEED_V2_SCHEMA_VERSION,
  ScenarioV3CompilationError,
  worldSeedV2Schema,
  type CompiledScenarioV3,
  type RuntimeScenarioProjectionV2,
  type ScenarioV3CompilationDiagnostic,
  type ValidatedScenarioV3,
  type WorldSeedV2,
} from './seed.js';
import {
  worldStateV2ContentSchema,
  type RegionalControl,
  type WorldStateV2Input,
} from './schema.js';
import { stampWorldStateRevision } from './revision.js';

const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function checksum(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')}`;
}

/** Clone JSON while giving every record deterministic key insertion order. */
function canonicalJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => canonicalJson(entry)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareIds(left, right))
      .map(([key, entry]) => [key, canonicalJson(entry)])) as T;
  }
  return value;
}

function sortedValues<T extends { id: string }>(record: Record<string, T>): T[] {
  return Object.values(record).map((entry) => canonicalJson(entry)).sort((a, b) => compareIds(a.id, b.id));
}

function unsupportedLiveDiagnostics(scenario: ValidatedScenarioV3): ScenarioV3CompilationDiagnostic[] {
  const diagnostics: ScenarioV3CompilationDiagnostic[] = [];
  for (const formation of sortedValues(scenario.startingState.formations)) {
    const equipmentIds = Object.keys(formation.equipment).sort(compareIds);
    if (equipmentIds.length > 0) diagnostics.push({
      code: 'unsupported-live-projection',
      path: `/startingState/formations/${formation.id}/equipment`,
      message: `formation equipment is material live state not yet represented by WorldStateV2: ${equipmentIds.join(', ')}`,
      refs: equipmentIds,
    });
  }
  for (const route of sortedValues(scenario.startingState.routes)) diagnostics.push({
    code: 'unsupported-live-projection',
    path: `/startingState/routes/${route.id}`,
    message: 'routes are material live state not yet represented by WorldStateV2',
    refs: [route.id],
  });
  return diagnostics.sort((a, b) => compareIds(a.path, b.path) || compareIds(a.code, b.code));
}

function buildSeed(scenario: ValidatedScenarioV3): WorldSeedV2 {
  const canonicalScenario = canonicalJson(scenario);
  const { schemaVersion: sourceSchemaVersion, ...content } = canonicalScenario;
  return worldSeedV2Schema.parse(canonicalJson({
    schemaVersion: WORLD_SEED_V2_SCHEMA_VERSION,
    sourceSchemaVersion,
    ...content,
  }));
}

function buildRuntimeProjection(
  scenario: ValidatedScenarioV3,
  controlByRegionId: ReadonlyMap<string, RegionalControl>,
): RuntimeScenarioProjectionV2 {
  const eligible = new Set<string>(scenario.game.playerEligiblePolityIds);
  return canonicalJson({
    scenarioId: scenario.id,
    profile: scenario.profile,
    title: scenario.metadata.title,
    ...(scenario.metadata.description ? { description: scenario.metadata.description } : {}),
    startDate: scenario.game.startDate,
    defaultPlayerPolityId: scenario.game.defaultPlayerPolityId,
    playerEligiblePolityIds: [...scenario.game.playerEligiblePolityIds].sort(compareIds),
    polities: sortedValues(scenario.startingState.polities).map((polity) => ({
      polityId: polity.id,
      displayName: polity.displayName,
      color: polity.color,
      playerEligible: eligible.has(polity.id),
    })),
    regions: sortedValues(scenario.startingState.regions).map((region) => ({
      regionId: region.id,
      displayName: region.displayName,
      control: controlByRegionId.get(region.id)!,
      geography: canonicalJson(scenario.geography.regions[region.id]!.link),
      adjacentRegionIds: [...scenario.geography.regions[region.id]!.adjacentRegionIds].sort(compareIds),
    })),
    assets: sortedValues(scenario.geography.assets),
  });
}

function buildInitialState(
  scenario: ValidatedScenarioV3,
  seedChecksum: `sha256:${string}`,
): { input: WorldStateV2Input; controlByRegionId: Map<string, RegionalControl> } {
  const polities = sortedValues(scenario.startingState.polities).map((polity) => ({
    id: polity.id,
    displayName: polity.displayName,
    treasury: polity.treasury,
    stockpiles: Object.entries(polity.stockpiles)
      .map(([commodityId, quantity]) => ({ commodityId, quantity }))
      .sort((a, b) => compareIds(a.commodityId, b.commodityId)),
    evidenceIds: [...polity.evidenceIds].sort(compareIds),
  }));
  const regions = sortedValues(scenario.startingState.regions).map((region) => {
    const profile = scenario.catalogs.controlProfiles[region.controlProfileId]!;
    return {
      regionId: region.id,
      displayName: region.displayName,
      control: {
        legalOwnerPolityId: region.legalOwnerPolityId,
        actualControllerPolityId: region.actualControllerPolityId,
        kind: profile.kind,
        controlProfileId: profile.id,
        administrationAccessBp: profile.administrationAccessBp,
        extractionAccessBp: profile.extractionAccessBp,
        recruitmentAccessBp: profile.recruitmentAccessBp,
        integrationBp: profile.integrationBp,
      },
      fiscalBase: region.fiscalBase,
      productiveCapacity: region.productiveCapacity,
      supplyCapacity: region.supplyCapacity,
      resourceDeposits: Object.entries(region.resources)
        .map(([resourceId, amount]) => ({ resourceId, amount }))
        .sort((a, b) => compareIds(a.resourceId, b.resourceId)),
      evidenceIds: [...region.evidenceIds].sort(compareIds),
    };
  });
  const populationCohorts = sortedValues(scenario.startingState.populationCohorts).map((cohort) => ({
    cohortId: cohort.id,
    regionId: cohort.regionId,
    population: cohort.population,
    workforceParticipationBp: cohort.workforceParticipationBp,
    recruitmentEligibilityBp: cohort.recruitmentEligibilityBp,
    evidenceIds: [...cohort.evidenceIds].sort(compareIds),
  }));
  const formations = sortedValues(scenario.startingState.formations).map((formation) => {
    const personnelOrigins = Object.entries(formation.personnelOrigins)
      .map(([regionId, personnel]) => ({ regionId, personnel }))
      .sort((a, b) => compareIds(a.regionId, b.regionId));
    return {
      formationId: formation.id,
      polityId: formation.polityId,
      manpower: personnelOrigins.reduce((sum, origin) => sum + origin.personnel, 0),
      personnelOrigins,
      evidenceIds: [...formation.evidenceIds].sort(compareIds),
    };
  });
  const institutions = sortedValues(scenario.startingState.institutions).map((institution) => ({
    institutionId: institution.id,
    kind: institution.typeId,
    ...(institution.polityId ? { polityId: institution.polityId } : {}),
    ...(institution.regionId ? { regionId: institution.regionId } : {}),
    evidenceIds: [...institution.evidenceIds].sort(compareIds),
  }));
  const concepts = sortedValues(scenario.startingState.concepts).map((concept) => ({
    conceptId: concept.id,
    kind: concept.kind,
    evidenceIds: [...concept.evidenceIds].sort(compareIds),
  }));
  const relationships = sortedValues(scenario.startingState.relationships).map((relationship) => ({
    relationshipId: relationship.id,
    kind: relationship.typeId,
    participantPolityIds: [...relationship.participantPolityIds].sort(compareIds),
    evidenceIds: [...relationship.evidenceIds].sort(compareIds),
  }));
  const knowledgeRecords = sortedValues(scenario.startingState.knowledge).map((knowledge) => ({
    polityId: knowledge.polityId,
    conceptId: knowledge.conceptId,
    evidenceIds: [...knowledge.evidenceIds].sort(compareIds),
  })).sort((a, b) => compareIds(`${a.polityId}|${a.conceptId}`, `${b.polityId}|${b.conceptId}`));

  const evidenceLinks = new Map<string, { entityRefs: Set<string>; canonicalPointers: Set<string> }>();
  const linkEvidence = (evidenceIds: readonly string[], entityRefs: readonly string[], pointer: string): void => {
    for (const evidenceId of evidenceIds) {
      const links = evidenceLinks.get(evidenceId) ?? { entityRefs: new Set<string>(), canonicalPointers: new Set<string>() };
      entityRefs.forEach((entityRef) => links.entityRefs.add(entityRef));
      links.canonicalPointers.add(pointer);
      evidenceLinks.set(evidenceId, links);
    }
  };
  polities.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.id], `/polities/${index}`));
  regions.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.regionId], `/regions/${index}`));
  populationCohorts.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.cohortId], `/populationCohorts/${index}`));
  formations.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.formationId], `/formations/${index}`));
  institutions.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.institutionId], `/institutions/${index}`));
  concepts.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.conceptId], `/concepts/${index}`));
  relationships.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.relationshipId], `/relationships/${index}`));
  knowledgeRecords.forEach((entry, index) => linkEvidence(
    entry.evidenceIds,
    [entry.polityId, entry.conceptId],
    `/knowledge/records/${index}`,
  ));

  const rawInput = {
    schemaVersion: 'open-historia-world/2',
    scenarioId: scenario.id,
    month: scenario.game.startDate,
    turn: 0,
    revisionLineage: { seedRevision: seedChecksum, ancestorRevisions: [] },
    worldRules: canonicalJson(scenario.worldRules),
    modules: { enabled: [...scenario.modules.enabled].sort(compareIds) },
    catalogs: {
      modules: sortedValues(scenario.catalogs.modules).map((entry) => ({ moduleId: entry.id })),
      worldModels: sortedValues(scenario.catalogs.worldModels).map((entry) => ({ modelId: entry.id, kind: entry.kind })),
      commodities: sortedValues(scenario.catalogs.commodities).map((entry) => ({ commodityId: entry.id, usage: entry.usage })),
      controlProfiles: sortedValues(scenario.catalogs.controlProfiles).map((entry) => ({
        controlProfileId: entry.id,
        kind: entry.kind,
        administrationAccessBp: entry.administrationAccessBp,
        extractionAccessBp: entry.extractionAccessBp,
        recruitmentAccessBp: entry.recruitmentAccessBp,
        integrationBp: entry.integrationBp,
      })),
    },
    polities,
    regions,
    populationCohorts,
    formations,
    characters: [],
    groups: [],
    institutions,
    concepts,
    processes: [],
    relationships,
    knowledge: { records: knowledgeRecords },
    events: [],
    evidence: sortedValues(scenario.provenance.evidence).map((evidence) => {
      const links = evidenceLinks.get(evidence.id);
      return {
        evidenceId: evidence.id,
        revision: seedChecksum,
        kind: `scenario-provenance:${evidence.basis.kind}`,
        entityRefs: [...(links?.entityRefs ?? [])].sort(compareIds),
        eventRefs: [],
        canonicalPointers: [...(links?.canonicalPointers ?? [])].sort(compareIds),
        visibility: evidence.visibility,
        ...(evidence.visibleToPolityIds ? { visibleToPolityIds: [...evidence.visibleToPolityIds].sort(compareIds) } : {}),
      };
    }),
  };
  const input = worldStateV2ContentSchema.parse(rawInput);
  const controlByRegionId = new Map(input.regions.map((region) => [region.regionId, region.control]));
  return { input, controlByRegionId };
}

/** Validate first, then compile deterministically without I/O or model calls. */
export function compileScenarioV3(input: unknown): CompiledScenarioV3 {
  const validation = scenarioV3.validateScenarioV3(input);
  if (!validation.valid || !validation.scenario) {
    throw new ScenarioV3CompilationError(validation.errors);
  }
  const unsupported = unsupportedLiveDiagnostics(validation.scenario);
  if (unsupported.length > 0) throw new ScenarioV3CompilationError(unsupported);

  const scenario = canonicalJson(validation.scenario);
  const bundleChecksum = checksum(scenario);
  const seed = buildSeed(scenario);
  const seedChecksum = checksum(seed);
  const { input: initialInput, controlByRegionId } = buildInitialState(scenario, seedChecksum);
  const initialState = stampWorldStateRevision(initialInput);
  const runtimeProjection = buildRuntimeProjection(scenario, controlByRegionId);
  const runtimeProjectionChecksum = checksum(runtimeProjection);
  return {
    bundleChecksum,
    seed,
    seedChecksum,
    initialState,
    runtimeProjection,
    runtimeProjectionChecksum,
    diagnostics: [],
  };
}
