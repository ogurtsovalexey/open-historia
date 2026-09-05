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

function canonicalScenario(scenario: ValidatedScenarioV3): ValidatedScenarioV3 {
  const result = canonicalJson(scenario);
  result.game.playerEligiblePolityIds.sort(compareIds);
  result.worldRules.knowledgeBaseline.sort(compareIds);
  result.worldRules.hardProhibitions.sort(compareIds);
  result.worldRules.plausibilityContext.sort(compareIds);
  result.modules.enabled.sort(compareIds);
  for (const archetype of Object.values(result.catalogs.formationArchetypes)) archetype.equipmentClassIds.sort(compareIds);
  for (const activity of Object.values(result.catalogs.activities)) {
    activity.inputCommodityIds.sort(compareIds);
    activity.outputCommodityIds.sort(compareIds);
  }
  for (const profile of Object.values(result.catalogs.financeProfiles)) {
    profile.revenueChannelIds.sort(compareIds);
    profile.instrumentIds.sort(compareIds);
  }
  for (const region of Object.values(result.geography.regions)) region.adjacentRegionIds.sort(compareIds);
  for (const relationship of Object.values(result.startingState.relationships)) relationship.participantPolityIds.sort(compareIds);
  for (const obligation of Object.values(result.startingState.tributeObligations)) {
    obligation.payerPolityIds.sort(compareIds);
    obligation.sourceRegionIds.sort(compareIds);
    obligation.beneficiaries.sort((a, b) => compareIds(a.polityId, b.polityId));
    obligation.deliveries.sort((a, b) => compareIds(a.commodityId, b.commodityId));
    obligation.routeIds.sort(compareIds);
    obligation.arrears.sort((a, b) => compareIds(a.commodityId, b.commodityId));
    obligation.evidenceIds.sort(compareIds);
  }
  for (const route of Object.values(result.startingState.routes)) {
    route.regionIds.sort(compareIds);
    route.allowedCommodityIds.sort(compareIds);
    route.evidenceIds.sort(compareIds);
  }
  for (const evidence of Object.values(result.provenance.evidence)) evidence.visibleToPolityIds?.sort(compareIds);
  return result;
}

function liveCompatibilityDiagnostics(scenario: ValidatedScenarioV3): ScenarioV3CompilationDiagnostic[] {
  const diagnostics: ScenarioV3CompilationDiagnostic[] = [];
  for (const formation of sortedValues(scenario.startingState.formations)) {
    const allowed = new Set(scenario.catalogs.formationArchetypes[formation.archetypeId]?.equipmentClassIds ?? []);
    for (const equipmentClassId of Object.keys(formation.equipment).sort(compareIds)) {
      if (!allowed.has(equipmentClassId)) diagnostics.push({
        code: 'integrity.equipment-not-allowed-by-archetype',
        path: `/startingState/formations/${formation.id}/equipment/${equipmentClassId}`,
        message: `equipment class ${equipmentClassId} is not allowed by formation archetype ${formation.archetypeId}`,
        refs: [formation.archetypeId, equipmentClassId],
      });
    }
  }
  return diagnostics;
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
    decisionMode: polity.decisionMode ?? (scenario.game.playerEligiblePolityIds.includes(polity.id) ? 'active' as const : 'supported' as const),
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
      archetypeId: formation.archetypeId,
      manpower: personnelOrigins.reduce((sum, origin) => sum + origin.personnel, 0),
      personnelOrigins,
      equipment: Object.entries(formation.equipment)
        .map(([equipmentClassId, quantity]) => ({ equipmentClassId, quantity }))
        .sort((a, b) => compareIds(a.equipmentClassId, b.equipmentClassId)),
      evidenceIds: [...formation.evidenceIds].sort(compareIds),
    };
  });
  const routes = sortedValues(scenario.startingState.routes).map((route) => ({
    routeId: route.id,
    classId: route.classId,
    regionIds: [...route.regionIds].sort(compareIds),
    allowedCommodityIds: [...route.allowedCommodityIds].sort(compareIds),
    evidenceIds: [...route.evidenceIds].sort(compareIds),
  }));
  const institutions = sortedValues(scenario.startingState.institutions).map((institution) => ({
    institutionId: institution.id,
    kind: institution.typeId,
    ...(institution.polityId ? { polityId: institution.polityId } : {}),
    ...(institution.regionId ? { regionId: institution.regionId } : {}),
    evidenceIds: [...institution.evidenceIds].sort(compareIds),
  }));
  const concepts = sortedValues(scenario.startingState.concepts).map((concept) => ({
    conceptId: concept.id,
    type: concept.type,
    semanticKey: concept.semanticKey,
    displayName: concept.displayName,
    description: concept.description,
    origin: {
      kind: 'scenario' as const,
      originEntityRefs: [...concept.origin.originEntityRefs].sort(compareIds),
      originMonth: concept.origin.originMonth,
      ...(concept.origin.discovererEntityRef
        ? { discovererEntityRef: concept.origin.discovererEntityRef }
        : {}),
    },
    parentConceptIds: [...concept.parentConceptIds].sort(compareIds),
    supportingEvidenceIds: [...concept.supportingEvidenceIds].sort(compareIds),
    domains: [...concept.domains].sort(compareIds),
    status: concept.status,
    maturityBp: concept.maturityBp,
    diffusion: Object.entries(concept.diffusion)
      .map(([regionId, awarenessBp]) => ({ regionId, awarenessBp }))
      .sort((a, b) => compareIds(a.regionId, b.regionId)),
    adoption: [
      ...Object.entries(concept.adoption.polities)
        .map(([polityId, adoptionBp]) => ({ scope: 'polity' as const, polityId, adoptionBp })),
      ...Object.entries(concept.adoption.regions)
        .map(([regionId, adoptionBp]) => ({ scope: 'region' as const, regionId, adoptionBp })),
    ].sort((a, b) => compareIds(
      a.scope === 'polity' ? `polity|${a.polityId}` : `region|${a.regionId}`,
      b.scope === 'polity' ? `polity|${b.polityId}` : `region|${b.regionId}`,
    )),
    provenance: {
      kind: 'scenario' as const,
      sourceEvidenceId: concept.sourceEvidenceId,
      createdRevision: seedChecksum,
      createdMonth: scenario.game.startDate,
    },
    evidenceIds: [...concept.evidenceIds].sort(compareIds),
  }));
  const relationships = sortedValues(scenario.startingState.relationships).map((relationship) => ({
    relationshipId: relationship.id,
    kind: relationship.typeId,
    participantPolityIds: [...relationship.participantPolityIds].sort(compareIds),
    evidenceIds: [...relationship.evidenceIds].sort(compareIds),
  }));
  const tributeObligations = sortedValues(scenario.startingState.tributeObligations).map((obligation) => ({
    obligationId: obligation.id,
    payerPolityIds: [...obligation.payerPolityIds].sort(compareIds),
    sourceRegionIds: [...obligation.sourceRegionIds].sort(compareIds),
    beneficiaries: obligation.beneficiaries.map((entry) => ({ ...entry })).sort((a, b) => compareIds(a.polityId, b.polityId)),
    deliveries: obligation.deliveries.map((entry) => ({ ...entry })).sort((a, b) => compareIds(a.commodityId, b.commodityId)),
    ...(obligation.laborService ? { laborService: { ...obligation.laborService } } : {}),
    ...(obligation.militaryService ? { militaryService: { ...obligation.militaryService } } : {}),
    routeIds: [...obligation.routeIds].sort(compareIds),
    cadence: obligation.cadence,
    arrears: obligation.arrears.map((entry) => ({ ...entry })).sort((a, b) => compareIds(a.commodityId, b.commodityId)),
    complianceBp: obligation.complianceBp,
    enforcementBasisId: obligation.enforcementBasisId,
    evidenceIds: [...obligation.evidenceIds].sort(compareIds),
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
  routes.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.routeId], `/routes/${index}`));
  institutions.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.institutionId], `/institutions/${index}`));
  concepts.forEach((entry, index) => linkEvidence(
    [...entry.evidenceIds, ...entry.supportingEvidenceIds, entry.provenance.sourceEvidenceId],
    [entry.conceptId],
    `/concepts/${index}`,
  ));
  relationships.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.relationshipId], `/relationships/${index}`));
  tributeObligations.forEach((entry, index) => linkEvidence(entry.evidenceIds, [entry.obligationId], `/tributeObligations/${index}`));
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
      formationArchetypes: sortedValues(scenario.catalogs.formationArchetypes).map((entry) => ({
        formationArchetypeId: entry.id,
        equipmentClassIds: [...entry.equipmentClassIds].sort(compareIds),
      })),
      equipmentClasses: sortedValues(scenario.catalogs.equipmentClasses).map((entry) => ({ equipmentClassId: entry.id })),
      routeClasses: sortedValues(scenario.catalogs.routeClasses).map((entry) => ({ routeClassId: entry.id })),
    },
    polities,
    regions,
    populationCohorts,
    formations,
    routes,
    characters: [],
    groups: [],
    institutions,
    concepts,
    processes: [],
    relationships,
    tributeObligations,
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
  const liveCompatibility = liveCompatibilityDiagnostics(validation.scenario);
  if (liveCompatibility.length > 0) throw new ScenarioV3CompilationError(liveCompatibility);
  const scenario = canonicalScenario(validation.scenario);
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
