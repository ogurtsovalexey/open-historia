import type { PolityId, RegionId } from '@open-historia/domain';
import type {
  EvidenceId,
  RegionalControl,
  RegionStateV2,
  RouteId,
  WorldStateV2,
} from './schema.js';

export interface GroundedProjection<T> {
  revision: WorldStateV2['revision'];
  asOfMonth: WorldStateV2['month'];
  value: T;
  evidenceIds: EvidenceId[];
}

export interface ResourceQuantity {
  resourceId: string;
  amount: number;
}

export interface EquipmentQuantity {
  equipmentClassId: string;
  quantity: number;
}

export interface RouteSnapshot {
  routeId: RouteId;
  classId: string;
  regionIds: RegionId[];
  allowedCommodityIds: string[];
}

export interface UnavailableMetric {
  status: 'unavailable';
  reason: string;
}

export interface RegionSnapshot {
  regionId: RegionId;
  control: RegionalControl;
  population: number;
  potentialWorkforce: number;
  mobilizedPersonnel: number;
  workforce: number;
  eligiblePopulation: number;
  fiscalBase: number;
  productiveCapacity: number;
  supplyCapacity: number;
  resourceDeposits: ResourceQuantity[];
}

export interface RecruitmentAccess {
  regionId: RegionId;
  polityId: PolityId;
  actualControllerPolityId: PolityId;
  hasControl: boolean;
  recruitmentAccessBp: number;
  eligiblePopulation: number;
  mobilizedPersonnel: number;
  recruitablePopulation: number;
  unmobilizedRecruitablePopulation: number;
  mobilizationCeiling: UnavailableMetric;
  availableManpower: UnavailableMetric;
}

export interface PolityRegionContribution {
  regionId: RegionId;
  controlKind: RegionalControl['kind'];
  legalPopulation: number;
  controlledPopulation: number;
  administeredPopulation: number;
  workforce: number;
  taxBase: number;
  recruitablePopulation: number;
  unmobilizedRecruitablePopulation: number;
  regionalOutput: number;
  supplyCapacity: number;
  resourceAccess: ResourceQuantity[];
}

export interface PolitySnapshot {
  polityId: PolityId;
  treasury: number;
  stockpiles: Array<{ commodityId: string; quantity: number }>;
  legalPopulation: number;
  controlledPopulation: number;
  administeredPopulation: number;
  workforce: number;
  taxBase: number;
  recruitablePopulation: number;
  mobilizationCeiling: UnavailableMetric;
  unmobilizedRecruitablePopulation: number;
  availableManpower: UnavailableMetric;
  overmobilizedBy: UnavailableMetric;
  fieldedPersonnel: number;
  equipment: EquipmentQuantity[];
  regionalOutput: number;
  resourceAccess: ResourceQuantity[];
  supplyCapacity: number;
  identityPressure: UnavailableMetric;
  contributions: PolityRegionContribution[];
}

export interface PopulationIdentityContribution {
  regionId: RegionId;
  population: number;
  mobilizedPersonnel: number;
  civilianPopulation: number;
  potentialWorkforce: number;
  availableWorkforce: number;
}

export interface PopulationIdentity {
  population: number;
  mobilizedPersonnel: number;
  civilianPopulation: number;
  potentialWorkforce: number;
  availableWorkforce: number;
  contributions: PopulationIdentityContribution[];
}

const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const unavailableMobilizationCeiling = (): UnavailableMetric => ({
  status: 'unavailable',
  reason: 'requires a scenario or policy mobilization ceiling not present in WorldStateV2',
});

const unavailableIdentityPressure = (): UnavailableMetric => ({
  status: 'unavailable',
  reason: 'requires identity-model inputs not present in WorldStateV2',
});

function addSafe(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds the safe integer range`);
  return result;
}

function sumSafe(values: readonly number[], label: string): number {
  return values.reduce((sum, value) => addSafe(sum, value, label), 0);
}

/** Apply basis points with deterministic integer truncation and no floating-point drift. */
function applyBp(value: number, basisPoints: number): number {
  const result = (BigInt(value) * BigInt(basisPoints)) / 10000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('basis-point result exceeds the safe integer range');
  return Number(result);
}

function requirePolity(state: WorldStateV2, polityId: string) {
  const polity = state.polities.find((entry) => entry.id === polityId);
  if (!polity) throw new Error(`unknown polity ${polityId}`);
  return polity;
}

function requireRegion(state: WorldStateV2, regionId: string): RegionStateV2 {
  const region = state.regions.find((entry) => entry.regionId === regionId);
  if (!region) throw new Error(`unknown region ${regionId}`);
  return region;
}

function projection<T>(state: WorldStateV2, value: T, evidenceIds: Iterable<EvidenceId>): GroundedProjection<T> {
  return {
    revision: state.revision,
    asOfMonth: state.month,
    value,
    evidenceIds: [...new Set(evidenceIds)].sort(compareIds),
  };
}

function entityEvidence(state: WorldStateV2, entityRefs: readonly string[], direct: readonly EvidenceId[]): EvidenceId[] {
  const refs = new Set(entityRefs);
  const registered = state.evidence
    .filter((entry) => entry.entityRefs.some((entityRef) => refs.has(entityRef)))
    .map((entry) => entry.evidenceId);
  return [...direct, ...registered];
}

function cohortsIn(state: WorldStateV2, regionId: string) {
  return state.populationCohorts.filter((entry) => entry.regionId === regionId);
}

function originsIn(state: WorldStateV2, regionId: string) {
  return state.formations.flatMap((formation) => formation.personnelOrigins
    .filter((origin) => origin.regionId === regionId)
    .map((origin) => ({ formation, personnel: origin.personnel })));
}

function addResources(rows: readonly ResourceQuantity[]): ResourceQuantity[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.resourceId, addSafe(totals.get(row.resourceId) ?? 0, row.amount, `resource ${row.resourceId}`));
  return [...totals].map(([resourceId, amount]) => ({ resourceId, amount })).sort((a, b) => compareIds(a.resourceId, b.resourceId));
}

function addEquipment(rows: readonly EquipmentQuantity[]): EquipmentQuantity[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.equipmentClassId, addSafe(totals.get(row.equipmentClassId) ?? 0, row.quantity, `equipment ${row.equipmentClassId}`));
  }
  return [...totals].map(([equipmentClassId, quantity]) => ({ equipmentClassId, quantity }))
    .sort((a, b) => compareIds(a.equipmentClassId, b.equipmentClassId));
}

export function controlOf(state: WorldStateV2, regionId: string): RegionalControl {
  const control = requireRegion(state, regionId).control;
  return { ...control };
}

export function regionsLegallyOwnedBy(state: WorldStateV2, polityId: string): RegionId[] {
  requirePolity(state, polityId);
  return state.regions
    .filter((region) => region.control.legalOwnerPolityId === polityId)
    .map((region) => region.regionId)
    .sort(compareIds);
}

export function regionsActuallyControlledBy(state: WorldStateV2, polityId: string): RegionId[] {
  requirePolity(state, polityId);
  return state.regions
    .filter((region) => region.control.actualControllerPolityId === polityId)
    .map((region) => region.regionId)
    .sort(compareIds);
}

export function deriveRegionSnapshot(state: WorldStateV2, regionId: string): GroundedProjection<RegionSnapshot> {
  const region = requireRegion(state, regionId);
  const cohorts = cohortsIn(state, regionId);
  const origins = originsIn(state, regionId);
  const population = sumSafe(cohorts.map((cohort) => cohort.population), `population in ${regionId}`);
  const potentialWorkforce = sumSafe(
    cohorts.map((cohort) => applyBp(cohort.population, cohort.workforceParticipationBp)),
    `potential workforce in ${regionId}`,
  );
  const eligiblePopulation = sumSafe(
    cohorts.map((cohort) => applyBp(cohort.population, cohort.recruitmentEligibilityBp)),
    `eligible population in ${regionId}`,
  );
  const mobilizedPersonnel = sumSafe(origins.map((origin) => origin.personnel), `mobilized personnel in ${regionId}`);
  if (mobilizedPersonnel > population) throw new Error(`mobilized personnel exceeds population in ${regionId}`);
  const workforce = Math.max(0, potentialWorkforce - mobilizedPersonnel);
  const directEvidence = [
    ...region.evidenceIds,
    ...cohorts.flatMap((cohort) => cohort.evidenceIds),
    ...origins.flatMap(({ formation }) => formation.evidenceIds),
  ];
  return projection(state, {
    regionId: region.regionId,
    control: { ...region.control },
    population,
    potentialWorkforce,
    mobilizedPersonnel,
    workforce,
    eligiblePopulation,
    fiscalBase: region.fiscalBase,
    productiveCapacity: region.productiveCapacity,
    supplyCapacity: region.supplyCapacity,
    resourceDeposits: region.resourceDeposits.map((entry) => ({ ...entry })).sort((a, b) => compareIds(a.resourceId, b.resourceId)),
  }, entityEvidence(
    state,
    [region.regionId, ...cohorts.map((cohort) => cohort.cohortId), ...origins.map(({ formation }) => formation.formationId)],
    directEvidence,
  ));
}

export function deriveRegionalRecruitmentAvailability(
  state: WorldStateV2,
  regionId: string,
  polityId: string,
): GroundedProjection<RecruitmentAccess> {
  const polity = requirePolity(state, polityId);
  const regionProjection = deriveRegionSnapshot(state, regionId);
  const region = regionProjection.value;
  const hasControl = region.control.actualControllerPolityId === polity.id;
  const recruitmentAccessBp = hasControl ? region.control.recruitmentAccessBp : 0;
  const recruitablePopulation = hasControl ? applyBp(region.eligiblePopulation, recruitmentAccessBp) : 0;
  return projection(state, {
    regionId: region.regionId,
    polityId: polity.id,
    actualControllerPolityId: region.control.actualControllerPolityId,
    hasControl,
    recruitmentAccessBp,
    eligiblePopulation: region.eligiblePopulation,
    mobilizedPersonnel: region.mobilizedPersonnel,
    recruitablePopulation,
    unmobilizedRecruitablePopulation: Math.max(0, recruitablePopulation - region.mobilizedPersonnel),
    mobilizationCeiling: unavailableMobilizationCeiling(),
    availableManpower: unavailableMobilizationCeiling(),
  }, [...polity.evidenceIds, ...regionProjection.evidenceIds]);
}

function contributionFor(state: WorldStateV2, regionId: RegionId, polityId: PolityId): PolityRegionContribution {
  const region = deriveRegionSnapshot(state, regionId).value;
  const actual = region.control.actualControllerPolityId === polityId;
  const legal = region.control.legalOwnerPolityId === polityId;
  const recruitment = deriveRegionalRecruitmentAvailability(state, regionId, polityId).value;
  const administrationBp = actual ? region.control.administrationAccessBp : 0;
  const extractionBp = actual ? region.control.extractionAccessBp : 0;
  return {
    regionId,
    controlKind: region.control.kind,
    legalPopulation: legal ? region.population : 0,
    controlledPopulation: actual ? region.population : 0,
    administeredPopulation: actual ? applyBp(region.population, administrationBp) : 0,
    workforce: actual ? applyBp(region.workforce, administrationBp) : 0,
    taxBase: actual ? applyBp(region.fiscalBase, administrationBp) : 0,
    recruitablePopulation: recruitment.recruitablePopulation,
    unmobilizedRecruitablePopulation: recruitment.unmobilizedRecruitablePopulation,
    regionalOutput: actual ? applyBp(region.productiveCapacity, extractionBp) : 0,
    supplyCapacity: actual ? applyBp(region.supplyCapacity, administrationBp) : 0,
    resourceAccess: actual
      ? region.resourceDeposits.map((entry) => ({ resourceId: entry.resourceId, amount: applyBp(entry.amount, extractionBp) }))
      : [],
  };
}

export function derivePolitySnapshot(state: WorldStateV2, polityId: string): GroundedProjection<PolitySnapshot> {
  const polity = requirePolity(state, polityId);
  const relevantRegions = state.regions
    .filter((region) => region.control.legalOwnerPolityId === polity.id || region.control.actualControllerPolityId === polity.id)
    .map((region) => region.regionId)
    .sort(compareIds);
  const contributions = relevantRegions.map((regionId) => contributionFor(state, regionId, polity.id));
  const total = (field: keyof Pick<PolityRegionContribution,
    'legalPopulation' | 'controlledPopulation' | 'administeredPopulation' | 'workforce' | 'taxBase' |
    'recruitablePopulation' | 'unmobilizedRecruitablePopulation' | 'regionalOutput' | 'supplyCapacity'>): number =>
    sumSafe(contributions.map((row) => row[field]), `${polity.id} ${field}`);
  const fieldedPersonnel = sumSafe(
    state.formations.filter((formation) => formation.polityId === polity.id).map((formation) => formation.manpower),
    `${polity.id} fielded personnel`,
  );
  const equipment = addEquipment(state.formations
    .filter((formation) => formation.polityId === polity.id)
    .flatMap((formation) => formation.equipment));
  const regionEvidence = relevantRegions.flatMap((regionId) => deriveRegionSnapshot(state, regionId).evidenceIds);
  const formationEvidence = state.formations
    .filter((formation) => formation.polityId === polity.id)
    .flatMap((formation) => formation.evidenceIds);
  return projection(state, {
    polityId: polity.id,
    treasury: polity.treasury,
    stockpiles: polity.stockpiles.map((entry) => ({ ...entry })).sort((a, b) => compareIds(a.commodityId, b.commodityId)),
    legalPopulation: total('legalPopulation'),
    controlledPopulation: total('controlledPopulation'),
    administeredPopulation: total('administeredPopulation'),
    workforce: total('workforce'),
    taxBase: total('taxBase'),
    recruitablePopulation: total('recruitablePopulation'),
    mobilizationCeiling: unavailableMobilizationCeiling(),
    unmobilizedRecruitablePopulation: total('unmobilizedRecruitablePopulation'),
    availableManpower: unavailableMobilizationCeiling(),
    overmobilizedBy: unavailableMobilizationCeiling(),
    fieldedPersonnel,
    equipment,
    regionalOutput: total('regionalOutput'),
    resourceAccess: addResources(contributions.flatMap((row) => row.resourceAccess)),
    supplyCapacity: total('supplyCapacity'),
    identityPressure: unavailableIdentityPressure(),
    contributions,
  }, entityEvidence(state, [polity.id, ...relevantRegions], [...polity.evidenceIds, ...regionEvidence, ...formationEvidence]));
}

export function deriveRouteSnapshot(state: WorldStateV2, routeId: string): GroundedProjection<RouteSnapshot> {
  const route = state.routes.find((entry) => entry.routeId === routeId);
  if (!route) throw new Error(`unknown route ${routeId}`);
  return projection(state, {
    routeId: route.routeId,
    classId: route.classId,
    regionIds: [...route.regionIds],
    allowedCommodityIds: [...route.allowedCommodityIds],
  }, entityEvidence(state, [route.routeId, ...route.regionIds], route.evidenceIds));
}

export function routesThroughRegion(state: WorldStateV2, regionId: string): RouteId[] {
  requireRegion(state, regionId);
  return state.routes.filter((route) => route.regionIds.includes(regionId as RegionId))
    .map((route) => route.routeId)
    .sort(compareIds);
}

export function deriveWorldPopulationIdentity(state: WorldStateV2): GroundedProjection<PopulationIdentity> {
  const regionProjections = [...state.regions]
    .sort((a, b) => compareIds(a.regionId, b.regionId))
    .map((region) => deriveRegionSnapshot(state, region.regionId));
  const contributions = regionProjections.map(({ value }) => ({
    regionId: value.regionId,
    population: value.population,
    mobilizedPersonnel: value.mobilizedPersonnel,
    civilianPopulation: value.population - value.mobilizedPersonnel,
    potentialWorkforce: value.potentialWorkforce,
    availableWorkforce: value.workforce,
  }));
  const total = (field: keyof Omit<PopulationIdentityContribution, 'regionId'>): number =>
    sumSafe(contributions.map((row) => row[field]), `world ${field}`);
  return projection(state, {
    population: total('population'),
    mobilizedPersonnel: total('mobilizedPersonnel'),
    civilianPopulation: total('civilianPopulation'),
    potentialWorkforce: total('potentialWorkforce'),
    availableWorkforce: total('availableWorkforce'),
    contributions,
  }, regionProjections.flatMap((entry) => entry.evidenceIds));
}
