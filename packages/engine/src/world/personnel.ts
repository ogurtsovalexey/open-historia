import { z } from 'zod';
import {
  evidenceIdSchema,
  formationIdSchema,
  populationCausalitySchema,
  worldEventIdSchema,
  type EvidenceId,
  type FormationPersonnelOrigin,
  type PopulationCausality,
  type WorldStateV2,
  type WorldStateV2Input,
} from './schema.js';
import { assertExpectedWorldRevision, nextRevisionLineage, stampWorldStateRevision } from './revision.js';

const safePositiveIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const personnelTransitionIdSchema = z.string().max(160).regex(/^personnel-transition:[a-z0-9][a-z0-9._-]{0,138}$/);
const authorityId = (prefix: string) => z.string().max(160).regex(new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{0,139}$`));

export interface CombatPersonnelLossTransition {
  transitionId: string;
  formationId: string;
  combatDeaths: number;
  expectedRevision: WorldStateV2['revision'];
  authority: { warId: string; battleId: string };
}

export interface DemobilizationTransition {
  transitionId: string;
  formationId: string;
  personnel: number;
  expectedRevision: WorldStateV2['revision'];
  authority: { orderId: string };
}

export interface PersonnelTransitionLedgerRecord {
  transitionId: string;
  kind: 'combat-loss' | 'demobilization';
  formationId: WorldStateV2['formations'][number]['formationId'];
  polityId: WorldStateV2['polities'][number]['id'];
  personnel: number;
  authority: { kind: 'combat'; warId: string; battleId: string } | { kind: 'order'; orderId: string };
  originChanges: FormationPersonnelOrigin[];
  populationCausality?: PopulationCausality;
  revisionBefore: WorldStateV2['revision'];
  revisionAfter: WorldStateV2['revision'];
  evidenceIds: EvidenceId[];
}

export interface PersonnelTransitionResult {
  state: WorldStateV2;
  ledgerRecord: PersonnelTransitionLedgerRecord;
}

const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function fail(transitionId: string, reason: string): never {
  throw new Error(`personnel transition ${transitionId}: ${reason}`);
}

interface WeightedRow { id: string; weight: number }

/** Exact integer proportional allocation: floor quotas, then largest remainder and stable ID tie-break. */
function largestRemainder(total: number, rows: readonly WeightedRow[], label: string): Map<string, number> {
  safePositiveIntegerSchema.parse(total);
  if (rows.length === 0) throw new Error(`${label}: cannot allocate without rows`);
  const ids = new Set<string>();
  let weightTotal = 0n;
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${label}: duplicate row ${row.id}`);
    ids.add(row.id);
    if (!Number.isSafeInteger(row.weight) || row.weight < 0) throw new Error(`${label}: invalid weight for ${row.id}`);
    weightTotal += BigInt(row.weight);
  }
  if (weightTotal === 0n) throw new Error(`${label}: total weight must be positive`);
  if (BigInt(total) > weightTotal) throw new Error(`${label}: allocation ${total} exceeds available ${weightTotal}`);

  const allocated = rows.map((row) => {
    const numerator = BigInt(total) * BigInt(row.weight);
    return { id: row.id, personnel: Number(numerator / weightTotal), remainder: numerator % weightTotal };
  });
  const floorTotal = allocated.reduce((sum, row) => sum + row.personnel, 0);
  const ranked = [...allocated].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return compareIds(left.id, right.id);
  });
  for (let index = 0; index < total - floorTotal; index += 1) ranked[index]!.personnel += 1;
  return new Map(allocated.map((row) => [row.id, row.personnel]));
}

export function allocatePersonnelByLargestRemainder(
  personnel: number,
  origins: readonly FormationPersonnelOrigin[],
): FormationPersonnelOrigin[] {
  const allocated = largestRemainder(
    personnel,
    origins.map((origin) => ({ id: origin.regionId, weight: origin.personnel })),
    'personnel origins',
  );
  return origins.map((origin) => ({ regionId: origin.regionId, personnel: allocated.get(origin.regionId) ?? 0 }))
    .sort((left, right) => compareIds(left.regionId, right.regionId));
}

function transitionIds(state: WorldStateV2, transitionId: string) {
  if (!personnelTransitionIdSchema.safeParse(transitionId).success) fail(transitionId, 'invalid transitionId');
  const suffix = transitionId.slice('personnel-transition:'.length);
  const eventId = worldEventIdSchema.parse(`event:personnel-${suffix}`);
  const evidenceId = evidenceIdSchema.parse(`evidence:personnel-${suffix}`);
  if (state.events.some((event) => event.eventId === eventId)) fail(transitionId, `event ${eventId} already exists`);
  if (state.evidence.some((evidence) => evidence.evidenceId === evidenceId)) fail(transitionId, `evidence ${evidenceId} already exists`);
  return { eventId, evidenceId };
}

function requireFormation(state: WorldStateV2, transitionId: string, formationId: string) {
  const parsedId = formationIdSchema.safeParse(formationId);
  if (!parsedId.success) fail(transitionId, 'invalid formationId');
  const index = state.formations.findIndex((formation) => formation.formationId === parsedId.data);
  if (index < 0) fail(transitionId, `unknown formation ${formationId}`);
  return { formation: state.formations[index]!, index };
}

function prospectiveSortedIndex(ids: readonly string[], addedId: string): number {
  return [...ids, addedId].sort(compareIds).indexOf(addedId);
}

function commitPersonnelEvent(
  state: WorldStateV2,
  transitionId: string,
  kind: 'combat-loss' | 'demobilization',
  formationIndex: number,
  formations: WorldStateV2['formations'],
  populationCohorts: WorldStateV2['populationCohorts'],
  originChanges: FormationPersonnelOrigin[],
  personnel: number,
  authority: PersonnelTransitionLedgerRecord['authority'],
  populationCausality?: PopulationCausality,
): PersonnelTransitionResult {
  const oldFormation = state.formations[formationIndex]!;
  const { eventId, evidenceId } = transitionIds(state, transitionId);
  const affectedRegionIds = originChanges.filter((row) => row.personnel > 0).map((row) => row.regionId);
  const affectedCohortIds = populationCausality?.regions.flatMap((region) => region.cohorts.map((cohort) => cohort.cohortId)) ?? [];
  const entityRefs = [oldFormation.formationId, oldFormation.polityId, ...affectedRegionIds, ...affectedCohortIds].sort(compareIds);
  const eventKind = kind === 'combat-loss' ? 'personnel-combat-loss' : 'personnel-demobilization';
  const eventIndex = prospectiveSortedIndex(state.events.map((event) => event.eventId), eventId);
  const canonicalPointers = [
    `/formations/${formationIndex}/manpower`,
    `/formations/${formationIndex}/personnelOrigins`,
    ...(populationCausality ? [
      ...affectedCohortIds.map((cohortId) => `/populationCohorts/${populationCohorts.findIndex((cohort) => cohort.cohortId === cohortId)}/population`),
      `/events/${eventIndex}/populationCausality`,
    ] : []),
  ];
  const { revision: _revision, ...content } = state;
  void _revision;
  const nextInput: WorldStateV2Input = {
    ...content,
    revisionLineage: nextRevisionLineage(state),
    formations,
    populationCohorts,
    events: [...state.events, {
      eventId, revision: state.revision, kind: eventKind, entityRefs, evidenceIds: [evidenceId],
      ...(populationCausality ? { populationCausality } : {}),
    }],
    evidence: [...state.evidence, {
      evidenceId, revision: state.revision, kind: eventKind, entityRefs, eventRefs: [eventId],
      canonicalPointers, visibility: 'public',
    }],
  };
  const nextState = stampWorldStateRevision(nextInput);
  return {
    state: nextState,
    ledgerRecord: {
      transitionId, kind, formationId: oldFormation.formationId, polityId: oldFormation.polityId,
      personnel, authority, originChanges, ...(populationCausality ? { populationCausality } : {}),
      revisionBefore: state.revision, revisionAfter: nextState.revision, evidenceIds: [evidenceId],
    },
  };
}

export function applyCombatPersonnelLosses(
  state: WorldStateV2,
  transition: CombatPersonnelLossTransition,
): PersonnelTransitionResult {
  assertExpectedWorldRevision(state, transition.expectedRevision);
  if (!authorityId('war').safeParse(transition.authority.warId).success || !authorityId('battle').safeParse(transition.authority.battleId).success) {
    fail(transition.transitionId, 'combat authority has invalid stable IDs');
  }
  safePositiveIntegerSchema.parse(transition.combatDeaths);
  const { formation, index: formationIndex } = requireFormation(state, transition.transitionId, transition.formationId);
  if (transition.combatDeaths > formation.manpower) fail(transition.transitionId, 'combat deaths exceed formation manpower');
  const originChanges = allocatePersonnelByLargestRemainder(transition.combatDeaths, formation.personnelOrigins);
  const lossByRegion = new Map(originChanges.map((row) => [row.regionId, row.personnel]));
  const nextFormation = {
    ...formation,
    manpower: formation.manpower - transition.combatDeaths,
    personnelOrigins: formation.personnelOrigins.map((origin) => ({
      ...origin,
      personnel: origin.personnel - (lossByRegion.get(origin.regionId) ?? 0),
    })),
  };
  const cohortLosses = new Map<string, number>();
  const regions = originChanges.filter((origin) => origin.personnel > 0).map((origin) => {
    const cohorts = state.populationCohorts.filter((cohort) => cohort.regionId === origin.regionId);
    const allocation = largestRemainder(
      origin.personnel,
      cohorts.map((cohort) => ({ id: cohort.cohortId, weight: cohort.population })),
      `cohort deaths in ${origin.regionId}`,
    );
    const cohortRows = cohorts.map((cohort) => {
      const combatDeaths = allocation.get(cohort.cohortId) ?? 0;
      cohortLosses.set(cohort.cohortId, combatDeaths);
      return { cohortId: cohort.cohortId, births: 0, naturalDeaths: 0, combatDeaths, migrationNet: 0, populationDelta: -combatDeaths };
    }).sort((left, right) => compareIds(left.cohortId, right.cohortId));
    return {
      regionId: origin.regionId,
      totals: { births: 0, naturalDeaths: 0, combatDeaths: origin.personnel, migrationNet: 0, populationDelta: -origin.personnel },
      cohorts: cohortRows,
    };
  }).sort((left, right) => compareIds(left.regionId, right.regionId));
  const populationCausality = populationCausalitySchema.parse({
    totals: { births: 0, naturalDeaths: 0, combatDeaths: transition.combatDeaths, migrationNet: 0, populationDelta: -transition.combatDeaths },
    regions,
  });
  const formations = state.formations.map((candidate, index) => index === formationIndex ? nextFormation : candidate);
  const populationCohorts = state.populationCohorts.map((cohort) => ({
    ...cohort,
    population: cohort.population - (cohortLosses.get(cohort.cohortId) ?? 0),
  }));
  return commitPersonnelEvent(
    state, transition.transitionId, 'combat-loss', formationIndex, formations, populationCohorts,
    originChanges, transition.combatDeaths,
    { kind: 'combat', warId: transition.authority.warId, battleId: transition.authority.battleId },
    populationCausality,
  );
}

export function applyDemobilization(
  state: WorldStateV2,
  transition: DemobilizationTransition,
): PersonnelTransitionResult {
  assertExpectedWorldRevision(state, transition.expectedRevision);
  if (!authorityId('order').safeParse(transition.authority.orderId).success) fail(transition.transitionId, 'demobilization authority has invalid orderId');
  safePositiveIntegerSchema.parse(transition.personnel);
  const { formation, index: formationIndex } = requireFormation(state, transition.transitionId, transition.formationId);
  if (transition.personnel > formation.manpower) fail(transition.transitionId, 'demobilized personnel exceed formation manpower');
  const originChanges = allocatePersonnelByLargestRemainder(transition.personnel, formation.personnelOrigins);
  const demobilizedByRegion = new Map(originChanges.map((row) => [row.regionId, row.personnel]));
  const nextFormation = {
    ...formation,
    manpower: formation.manpower - transition.personnel,
    personnelOrigins: formation.personnelOrigins.map((origin) => ({
      ...origin,
      personnel: origin.personnel - (demobilizedByRegion.get(origin.regionId) ?? 0),
    })),
  };
  const formations = state.formations.map((candidate, index) => index === formationIndex ? nextFormation : candidate);
  return commitPersonnelEvent(
    state, transition.transitionId, 'demobilization', formationIndex, formations, state.populationCohorts,
    originChanges, transition.personnel, { kind: 'order', orderId: transition.authority.orderId },
  );
}
