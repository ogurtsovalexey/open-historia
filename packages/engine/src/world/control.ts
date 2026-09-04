import type { PolityId, RegionId } from '@open-historia/domain';
import { z } from 'zod';
import {
  evidenceIdSchema,
  regionalControlSchema,
  worldEventIdSchema,
  type EvidenceId,
  type RegionalControl,
  type WorldStateV2,
  type WorldStateV2Input,
} from './schema.js';
import {
  assertExpectedWorldRevision,
  nextRevisionLineage,
  stampWorldStateRevision,
} from './revision.js';

export type TerritorialTransitionKind = 'annex' | 'occupy' | 'liberate' | 'cede' | 'set-control';
export type TerritorialTransitionEffectivePhase = 'opening' | 'closing';
export type TerritorialTransitionPhase = TerritorialTransitionEffectivePhase;

const prefixedTransitionIdSchema = (prefix: string) => z.string().max(160).regex(
  new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{0,138}$`),
  `Invalid ${prefix} ID format`,
);

export const territorialTransitionIdSchema = prefixedTransitionIdSchema('transition');
export const territorialTransitionAuthoritySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('peace'), offerId: prefixedTransitionIdSchema('offer') }).strict(),
  z.object({ kind: z.literal('agreement'), agreementId: prefixedTransitionIdSchema('agreement') }).strict(),
  z.object({
    kind: z.literal('combat'),
    warId: prefixedTransitionIdSchema('war'),
    frontId: prefixedTransitionIdSchema('front'),
  }).strict(),
  z.object({ kind: z.literal('gm'), interventionId: prefixedTransitionIdSchema('intervention') }).strict(),
]);

export type TerritorialTransitionAuthority = z.infer<typeof territorialTransitionAuthoritySchema>;

export interface TerritorialTransition {
  transitionId: string;
  regionId: RegionId;
  kind: TerritorialTransitionKind;
  expectedControl: RegionalControl;
  targetControlProfileId: RegionalControl['controlProfileId'];
  legalOwnerPolityId?: PolityId;
  actualControllerPolityId?: PolityId;
  authority: TerritorialTransitionAuthority;
  effectivePhase: TerritorialTransitionPhase;
  expectedRevision: WorldStateV2['revision'];
}

export interface TerritorialTransitionLedgerRecord {
  transitionId: string;
  regionId: RegionId;
  kind: TerritorialTransitionKind;
  authority: TerritorialTransitionAuthority;
  effectivePhase: TerritorialTransitionPhase;
  revisionBefore: WorldStateV2['revision'];
  revisionAfter: WorldStateV2['revision'];
  controlBefore: RegionalControl;
  controlAfter: RegionalControl;
  affectedPolityIds: PolityId[];
  evidenceIds: EvidenceId[];
}

export interface TerritorialTransitionResult {
  state: WorldStateV2;
  ledgerRecord: TerritorialTransitionLedgerRecord;
  affectedPolityIds: PolityId[];
}

const CONTROL_FIELDS = [
  'legalOwnerPolityId',
  'actualControllerPolityId',
  'kind',
  'controlProfileId',
  'administrationAccessBp',
  'extractionAccessBp',
  'recruitmentAccessBp',
  'integrationBp',
] as const;

const compareIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function fail(transition: TerritorialTransition, reason: string): never {
  throw new Error(`territorial transition ${transition.transitionId}: ${reason}`);
}

function validateAuthority(transition: TerritorialTransition): void {
  const parsed = territorialTransitionAuthoritySchema.safeParse(transition.authority);
  if (!parsed.success) {
    fail(transition, `authority has invalid stable IDs or shape: ${z.prettifyError(parsed.error)}`);
  }
}

function controlsEqual(left: RegionalControl, right: RegionalControl): boolean {
  return CONTROL_FIELDS.every((field) => left[field] === right[field]);
}

function requirePolity(state: WorldStateV2, polityId: PolityId, transition: TerritorialTransition): void {
  if (!state.polities.some((polity) => polity.id === polityId)) {
    fail(transition, `references unknown polity ${polityId}`);
  }
}

function validateKindAuthorityAndPhase(transition: TerritorialTransition): void {
  if (!['annex', 'occupy', 'liberate', 'cede', 'set-control'].includes(transition.kind)) {
    fail(transition, 'invalid transition kind');
  }
  if (transition.effectivePhase !== 'opening' && transition.effectivePhase !== 'closing') {
    fail(transition, 'invalid effective phase');
  }
  const authority = transition.authority.kind;
  const phase = transition.effectivePhase;
  if (authority === 'combat' && phase !== 'closing') {
    fail(transition, 'combat authority must take effect at closing');
  }
  if (authority !== 'combat' && phase !== 'opening') {
    fail(transition, `${authority} authority must take effect at opening`);
  }

  switch (transition.kind) {
    case 'occupy':
      if (authority !== 'combat') fail(transition, 'occupy requires combat authority');
      break;
    case 'annex':
      if (authority !== 'peace' && authority !== 'gm') fail(transition, 'annex requires peace or gm authority');
      break;
    case 'cede':
      if (authority !== 'peace' && authority !== 'agreement' && authority !== 'gm') {
        fail(transition, 'cede requires peace, agreement or gm authority');
      }
      break;
    case 'liberate':
      if (authority !== 'combat' && authority !== 'peace' && authority !== 'agreement' && authority !== 'gm') {
        fail(transition, 'liberate has invalid authority');
      }
      break;
    case 'set-control':
      if (authority !== 'gm') fail(transition, 'set-control requires gm authority');
      break;
  }
}

function resolveTargetParties(
  state: WorldStateV2,
  transition: TerritorialTransition,
  current: RegionalControl,
): { legalOwnerPolityId: PolityId; actualControllerPolityId: PolityId } {
  let legalOwnerPolityId = current.legalOwnerPolityId;
  let actualControllerPolityId = current.actualControllerPolityId;

  switch (transition.kind) {
    case 'annex':
      if (!transition.legalOwnerPolityId) fail(transition, 'annex requires legalOwnerPolityId');
      if (
        transition.actualControllerPolityId
        && transition.actualControllerPolityId !== transition.legalOwnerPolityId
      ) {
        fail(transition, 'annex cannot assign different legal owner and actual controller');
      }
      legalOwnerPolityId = transition.legalOwnerPolityId;
      actualControllerPolityId = transition.legalOwnerPolityId;
      break;
    case 'cede':
      if (!transition.legalOwnerPolityId) fail(transition, 'cede requires legalOwnerPolityId');
      if (!transition.actualControllerPolityId) fail(transition, 'cede requires explicit actualControllerPolityId');
      if (transition.legalOwnerPolityId === current.legalOwnerPolityId) {
        fail(transition, 'cede requires legal ownership to change');
      }
      legalOwnerPolityId = transition.legalOwnerPolityId;
      actualControllerPolityId = transition.actualControllerPolityId;
      break;
    case 'occupy':
      if (transition.legalOwnerPolityId !== undefined) fail(transition, 'occupy cannot change legal ownership');
      if (!transition.actualControllerPolityId) fail(transition, 'occupy requires actualControllerPolityId');
      actualControllerPolityId = transition.actualControllerPolityId;
      if (actualControllerPolityId === legalOwnerPolityId) fail(transition, 'occupier must differ from legal owner');
      break;
    case 'liberate':
      if (transition.legalOwnerPolityId !== undefined) fail(transition, 'liberate cannot change legal ownership');
      if (
        transition.actualControllerPolityId !== undefined
        && transition.actualControllerPolityId !== legalOwnerPolityId
      ) {
        fail(transition, 'liberate must restore the legal owner as actual controller');
      }
      actualControllerPolityId = legalOwnerPolityId;
      break;
    case 'set-control':
      if (transition.legalOwnerPolityId === undefined && transition.actualControllerPolityId === undefined) {
        fail(transition, 'set-control requires a legal owner or actual controller');
      }
      legalOwnerPolityId = transition.legalOwnerPolityId ?? legalOwnerPolityId;
      actualControllerPolityId = transition.actualControllerPolityId ?? actualControllerPolityId;
      break;
  }

  requirePolity(state, legalOwnerPolityId, transition);
  requirePolity(state, actualControllerPolityId, transition);
  return { legalOwnerPolityId, actualControllerPolityId };
}

/**
 * Apply exactly one already-authorized territorial fact at its turn boundary.
 * Access values are copied from the scenario profile; callers cannot supply numbers.
 */
export function applyTerritorialTransition(
  state: WorldStateV2,
  transition: TerritorialTransition,
): TerritorialTransitionResult {
  if (!territorialTransitionIdSchema.safeParse(transition.transitionId).success) {
    fail(transition, 'transitionId has invalid stable ID format');
  }
  assertExpectedWorldRevision(state, transition.expectedRevision);
  validateAuthority(transition);
  validateKindAuthorityAndPhase(transition);

  const regionIndex = state.regions.findIndex((region) => region.regionId === transition.regionId);
  if (regionIndex < 0) fail(transition, `references unknown region ${transition.regionId}`);
  const region = state.regions[regionIndex]!;
  const expectedControl = regionalControlSchema.parse(transition.expectedControl);
  if (!controlsEqual(region.control, expectedControl)) fail(transition, 'stale expected control');

  const profile = state.catalogs.controlProfiles.find(
    (candidate) => candidate.controlProfileId === transition.targetControlProfileId,
  );
  if (!profile) fail(transition, `references undeclared control profile ${transition.targetControlProfileId}`);
  const parties = resolveTargetParties(state, transition, region.control);
  if ((transition.kind === 'annex' || transition.kind === 'liberate') && profile.kind !== 'sovereign') {
    fail(transition, `${transition.kind} requires a sovereign control profile`);
  }
  if (transition.kind === 'occupy' && profile.kind !== 'occupation') {
    fail(transition, 'occupy requires an occupation control profile');
  }
  if (profile.kind === 'sovereign' && parties.legalOwnerPolityId !== parties.actualControllerPolityId) {
    fail(transition, 'sovereign control requires owner and controller to match');
  }
  if (profile.kind === 'occupation' && parties.legalOwnerPolityId === parties.actualControllerPolityId) {
    fail(transition, 'occupation requires different owner and controller');
  }

  const targetControl: RegionalControl = {
    ...parties,
    kind: profile.kind,
    controlProfileId: profile.controlProfileId,
    administrationAccessBp: profile.administrationAccessBp,
    extractionAccessBp: profile.extractionAccessBp,
    recruitmentAccessBp: profile.recruitmentAccessBp,
    integrationBp: profile.integrationBp,
  };
  if (controlsEqual(region.control, targetControl)) fail(transition, 'transition would not change control');

  const affectedPolityIds = [...new Set<PolityId>([
    region.control.legalOwnerPolityId,
    region.control.actualControllerPolityId,
    targetControl.legalOwnerPolityId,
    targetControl.actualControllerPolityId,
  ])].sort(compareIds);
  const transitionSuffix = transition.transitionId.slice('transition:'.length);
  const eventId = worldEventIdSchema.parse(`event:territorial-${transitionSuffix}`);
  const evidenceId = evidenceIdSchema.parse(`evidence:territorial-${transitionSuffix}`);
  if (state.events.some((event) => event.eventId === eventId)) fail(transition, `event ${eventId} already exists`);
  if (state.evidence.some((evidence) => evidence.evidenceId === evidenceId)) fail(transition, `evidence ${evidenceId} already exists`);
  const entityRefs = [transition.regionId, ...affectedPolityIds].sort(compareIds);

  const nextRegions = state.regions.map((entry, index) => index === regionIndex
    ? { ...entry, control: targetControl }
    : entry);
  const { revision: previousRevision, ...content } = state;
  void previousRevision;
  const nextInput: WorldStateV2Input = {
    ...content,
    revisionLineage: nextRevisionLineage(state),
    regions: nextRegions,
    events: [...state.events, {
      eventId,
      revision: state.revision,
      kind: 'territorial-transition',
      entityRefs,
      evidenceIds: [evidenceId],
    }],
    evidence: [...state.evidence, {
      evidenceId,
      revision: state.revision,
      kind: 'territorial-transition',
      entityRefs,
      eventRefs: [eventId],
      canonicalPointers: [`/regions/${regionIndex}/control`],
      visibility: 'public',
    }],
  };
  const nextState = stampWorldStateRevision(nextInput);
  const ledgerRecord: TerritorialTransitionLedgerRecord = {
    transitionId: transition.transitionId,
    regionId: transition.regionId,
    kind: transition.kind,
    authority: { ...transition.authority },
    effectivePhase: transition.effectivePhase,
    revisionBefore: state.revision,
    revisionAfter: nextState.revision,
    controlBefore: { ...region.control },
    controlAfter: { ...targetControl },
    affectedPolityIds: [...affectedPolityIds],
    evidenceIds: [evidenceId],
  };
  return { state: nextState, ledgerRecord, affectedPolityIds };
}
