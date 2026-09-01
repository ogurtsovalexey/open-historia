import type { PolityId, RegionId } from '@open-historia/domain';
import type { CommandRejection, IdentityCommand } from './commands.js';
import type { EconRegionState, EconWorldState } from './state.js';
import { clampBp } from './fixedPoint.js';
import { compositionShares, type IdentityPolicy, type IdentityState } from './society.js';

export interface IdentityCommandRecord {
  commandId: string;
  polityId: PolityId;
  kind: IdentityCommand['kind'];
  domain: 'culture' | 'religion';
  value: string;
}
export interface RegionIdentityRecord {
  regionId: RegionId;
  polityId: PolityId;
  cultureMismatchBp: number;
  religionMismatchBp: number;
  taxMultiplierBp: number;
  recruitmentMultiplierBp: number;
  cultureShiftBp: number;
  religionShiftBp: number;
}
export interface PolityIdentityRecord {
  polityId: PolityId;
  cultureMismatchBp: number;
  religionMismatchBp: number;
  taxMultiplierBp: number;
  recruitmentMultiplierBp: number;
  unrestPressureBp: number;
}
export type IdentityEngineEvent =
  | { type: 'identity-policy-changed'; polityId: PolityId; domain: 'culture' | 'religion'; policy: IdentityPolicy }
  | { type: 'identity-acceptance-changed'; polityId: PolityId; domain: 'culture' | 'religion'; identityId: string; accepted: boolean }
  | { type: 'identity-shifted'; polityId: PolityId; regionId: RegionId; domain: 'culture' | 'religion'; fromIdentityId: string; toIdentityId: string; shareBp: number };

const cloneIdentity = (state: IdentityState): IdentityState => ({
  cultures: state.cultures.map((entry) => ({ ...entry, displayName: { ...entry.displayName } })),
  religions: state.religions.map((entry) => ({ ...entry, displayName: { ...entry.displayName } })),
  regions: state.regions.map((entry) => ({ ...entry,
    culture: { ...entry.culture, minorities: entry.culture.minorities.map((minority) => ({ ...minority })) },
    religion: { ...entry.religion, minorities: entry.religion.minorities.map((minority) => ({ ...minority })) },
  })),
  polities: state.polities.map((entry) => ({ ...entry,
    acceptedCultureIds: [...entry.acceptedCultureIds], acceptedReligionIds: [...entry.acceptedReligionIds],
  })),
});

const presentIds = (identity: IdentityState, regions: EconRegionState[], polityId: string, domain: 'culture' | 'religion'): Set<string> => {
  const controlled = new Set(regions.filter((entry) => entry.controllerId === polityId).map((entry) => entry.regionId));
  const result = new Set<string>();
  for (const row of identity.regions.filter((entry) => controlled.has(entry.regionId))) {
    const composition = row[domain];
    result.add(composition.primaryId);
    composition.minorities.forEach((entry) => result.add(entry.identityId));
  }
  return result;
};

export function applyIdentityCommands(
  state: EconWorldState,
  commands: IdentityCommand[],
  regions: EconRegionState[],
): { identity: IdentityState | undefined; commandRecords: IdentityCommandRecord[]; events: IdentityEngineEvent[]; rejections: CommandRejection[] } {
  const identity = state.identity ? cloneIdentity(state.identity) : undefined;
  const commandRecords: IdentityCommandRecord[] = [];
  const events: IdentityEngineEvent[] = [];
  const rejections: CommandRejection[] = [];
  const reject = (command: IdentityCommand, reason: CommandRejection['reason'], detail: string) => rejections.push({ command, reason, detail });
  for (const command of commands) {
    if (!state.polities.some((entry) => entry.id === command.actorPolityId)) { reject(command, 'unknown-actor', `no polity ${command.actorPolityId}`); continue; }
    if (command.effectiveMonth !== state.month) { reject(command, 'wrong-month', `command month ${command.effectiveMonth}, world month ${state.month}`); continue; }
    if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) { reject(command, 'stale-revision', `expected ${command.expectedRevision}, world at ${state.revision}`); continue; }
    if (state.modules?.societyAndIdentity !== true || !identity) { reject(command, 'module-disabled', 'societyAndIdentity module is not enabled'); continue; }
    const polity = identity.polities.find((entry) => entry.polityId === command.actorPolityId);
    if (!polity) { reject(command, 'unknown-polity', `no identity polity ${command.actorPolityId}`); continue; }
    if (command.kind === 'identity.set-policy') {
      if (command.domain === 'culture') polity.culturePolicy = command.policy;
      else polity.religionPolicy = command.policy;
      commandRecords.push({ commandId: command.commandId, polityId: command.actorPolityId, kind: command.kind, domain: command.domain, value: command.policy });
      events.push({ type: 'identity-policy-changed', polityId: command.actorPolityId, domain: command.domain, policy: command.policy });
      continue;
    }
    const catalog = command.domain === 'culture' ? identity.cultures.map((entry) => entry.cultureId) : identity.religions.map((entry) => entry.religionId);
    if (!catalog.includes(command.identityId as never)) { reject(command, 'unknown-identity', `no ${command.domain} identity ${command.identityId}`); continue; }
    if (!presentIds(identity, regions, command.actorPolityId, command.domain).has(command.identityId)) { reject(command, 'foreign-target', 'identity is not present in a controlled region'); continue; }
    const official = command.domain === 'culture' ? polity.officialCultureId : polity.officialReligionId;
    const accepted = command.domain === 'culture' ? polity.acceptedCultureIds : polity.acceptedReligionIds;
    if (!command.accepted && command.identityId === official) { reject(command, 'invalid-target', 'the official identity cannot be revoked'); continue; }
    const index = accepted.indexOf(command.identityId as never);
    if ((command.accepted && index >= 0) || (!command.accepted && index < 0)) { reject(command, 'invalid-target', 'identity already has the requested acceptance status'); continue; }
    if (command.accepted) accepted.push(command.identityId as never); else accepted.splice(index, 1);
    accepted.sort();
    commandRecords.push({ commandId: command.commandId, polityId: command.actorPolityId, kind: command.kind, domain: command.domain, value: `${command.identityId}:${command.accepted}` });
    events.push({ type: 'identity-acceptance-changed', polityId: command.actorPolityId, domain: command.domain, identityId: command.identityId, accepted: command.accepted });
  }
  return { identity, commandRecords, events, rejections };
}

const policyFactors: Record<IdentityPolicy, { taxPenaltyBp: number; recruitmentPenaltyBp: number; unrestBp: number; shiftBp: number }> = {
  tolerance: { taxPenaltyBp: 1500, recruitmentPenaltyBp: 2500, unrestBp: 500, shiftBp: 0 },
  privilege: { taxPenaltyBp: 0, recruitmentPenaltyBp: 0, unrestBp: 1500, shiftBp: 0 },
  integration: { taxPenaltyBp: 1000, recruitmentPenaltyBp: 1500, unrestBp: 1000, shiftBp: 25 },
  coercion: { taxPenaltyBp: 500, recruitmentPenaltyBp: 1000, unrestBp: 2500, shiftBp: 75 },
};

const mismatch = (composition: IdentityState['regions'][number]['culture'] | IdentityState['regions'][number]['religion'], accepted: Set<string>): number =>
  [...compositionShares(composition).entries()].filter(([identityId]) => !accepted.has(identityId)).reduce((sum, [, share]) => sum + share, 0);

export function regionIdentityEffects(identity: IdentityState | undefined, regionId: string, polityId: string): Omit<RegionIdentityRecord, 'regionId' | 'polityId' | 'cultureShiftBp' | 'religionShiftBp'> {
  const row = identity?.regions.find((entry) => entry.regionId === regionId);
  const polity = identity?.polities.find((entry) => entry.polityId === polityId);
  if (!row || !polity) return { cultureMismatchBp: 0, religionMismatchBp: 0, taxMultiplierBp: 10000, recruitmentMultiplierBp: 10000 };
  const cultureAccepted = new Set<string>([polity.officialCultureId, ...polity.acceptedCultureIds]);
  const religionAccepted = new Set<string>([polity.officialReligionId, ...polity.acceptedReligionIds]);
  const cultureMismatchBp = mismatch(row.culture, cultureAccepted);
  const religionMismatchBp = mismatch(row.religion, religionAccepted);
  const factor = (mismatchBp: number, penaltyBp: number) => 10000 - Math.floor((mismatchBp * penaltyBp) / 10000);
  const culture = policyFactors[polity.culturePolicy];
  const religion = policyFactors[polity.religionPolicy];
  const taxMultiplierBp = Math.floor((factor(cultureMismatchBp, culture.taxPenaltyBp) * factor(religionMismatchBp, religion.taxPenaltyBp)) / 10000);
  const recruitmentMultiplierBp = Math.floor((factor(cultureMismatchBp, culture.recruitmentPenaltyBp) * factor(religionMismatchBp, religion.recruitmentPenaltyBp)) / 10000);
  return { cultureMismatchBp, religionMismatchBp, taxMultiplierBp, recruitmentMultiplierBp };
}

export function polityIdentityEffects(identity: IdentityState | undefined, regions: EconRegionState[], polityId: string): Omit<PolityIdentityRecord, 'polityId'> {
  const controlled = regions.filter((entry) => entry.controllerId === polityId);
  const population = controlled.reduce((sum, entry) => sum + entry.population, 0);
  if (!identity || population <= 0) return { cultureMismatchBp: 0, religionMismatchBp: 0, taxMultiplierBp: 10000, recruitmentMultiplierBp: 10000, unrestPressureBp: 0 };
  const polity = identity.polities.find((entry) => entry.polityId === polityId);
  if (!polity) return { cultureMismatchBp: 0, religionMismatchBp: 0, taxMultiplierBp: 10000, recruitmentMultiplierBp: 10000, unrestPressureBp: 0 };
  let cultureMismatchBp = 0; let religionMismatchBp = 0; let taxMultiplierBp = 0; let recruitmentMultiplierBp = 0; let unrestPressureBp = 0;
  for (const region of controlled) {
    const effects = regionIdentityEffects(identity, region.regionId, polityId);
    cultureMismatchBp += effects.cultureMismatchBp * region.population;
    religionMismatchBp += effects.religionMismatchBp * region.population;
    taxMultiplierBp += effects.taxMultiplierBp * region.population;
    recruitmentMultiplierBp += effects.recruitmentMultiplierBp * region.population;
    unrestPressureBp += (Math.floor((effects.cultureMismatchBp * policyFactors[polity.culturePolicy].unrestBp) / 10000)
      + Math.floor((effects.religionMismatchBp * policyFactors[polity.religionPolicy].unrestBp) / 10000)) * region.population;
  }
  return {
    cultureMismatchBp: Math.floor(cultureMismatchBp / population), religionMismatchBp: Math.floor(religionMismatchBp / population),
    taxMultiplierBp: Math.floor(taxMultiplierBp / population), recruitmentMultiplierBp: Math.floor(recruitmentMultiplierBp / population),
    unrestPressureBp: Math.floor(unrestPressureBp / population),
  };
}

const shiftComposition = (
  composition: IdentityState['regions'][number]['culture'] | IdentityState['regions'][number]['religion'],
  officialId: string,
  accepted: Set<string>,
  amount: number,
): { shifted: number; fromIdentityId: string | null } => {
  if (amount <= 0) return { shifted: 0, fromIdentityId: null };
  const shares = compositionShares(composition);
  const source = [...shares.entries()].filter(([identityId, share]) => !accepted.has(identityId) && share > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  if (!source) return { shifted: 0, fromIdentityId: null };
  const shifted = Math.min(amount, source[1]);
  shares.set(source[0], source[1] - shifted); shares.set(officialId, (shares.get(officialId) ?? 0) + shifted);
  const ordered = [...shares.entries()].filter(([, share]) => share > 0).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const primary = ordered[0]!;
  composition.primaryId = primary[0] as never;
  composition.minorities = ordered.slice(1).sort((left, right) => left[0].localeCompare(right[0]))
    .map(([identityId, shareBp]) => ({ identityId: identityId as never, shareBp }));
  return { shifted, fromIdentityId: source[0] };
};

export function resolveIdentityMonth(identity: IdentityState | undefined, regions: EconRegionState[]): {
  identity: IdentityState | undefined; polityRecords: PolityIdentityRecord[]; regionRecords: RegionIdentityRecord[]; events: IdentityEngineEvent[];
} {
  if (!identity) return { identity, polityRecords: [], regionRecords: [], events: [] };
  const polityRecords = identity.polities.map((polity) => ({ polityId: polity.polityId, ...polityIdentityEffects(identity, regions, polity.polityId) }));
  const events: IdentityEngineEvent[] = [];
  const regionRecords: RegionIdentityRecord[] = [];
  for (const region of regions) {
    const identityRegion = identity.regions.find((entry) => entry.regionId === region.regionId)!;
    const polity = identity.polities.find((entry) => entry.polityId === region.controllerId)!;
    const effects = regionIdentityEffects(identity, region.regionId, region.controllerId);
    const cultureAccepted = new Set<string>([polity.officialCultureId, ...polity.acceptedCultureIds]);
    const religionAccepted = new Set<string>([polity.officialReligionId, ...polity.acceptedReligionIds]);
    const cultureShift = shiftComposition(identityRegion.culture, polity.officialCultureId, cultureAccepted, policyFactors[polity.culturePolicy].shiftBp);
    const religionShift = shiftComposition(identityRegion.religion, polity.officialReligionId, religionAccepted, policyFactors[polity.religionPolicy].shiftBp);
    if (cultureShift.shifted > 0) events.push({ type: 'identity-shifted', polityId: region.controllerId, regionId: region.regionId, domain: 'culture', fromIdentityId: cultureShift.fromIdentityId!, toIdentityId: polity.officialCultureId, shareBp: cultureShift.shifted });
    if (religionShift.shifted > 0) events.push({ type: 'identity-shifted', polityId: region.controllerId, regionId: region.regionId, domain: 'religion', fromIdentityId: religionShift.fromIdentityId!, toIdentityId: polity.officialReligionId, shareBp: religionShift.shifted });
    regionRecords.push({ regionId: region.regionId, polityId: region.controllerId, ...effects,
      cultureShiftBp: cultureShift.shifted, religionShiftBp: religionShift.shifted });
  }
  identity.regions.sort((a, b) => a.regionId.localeCompare(b.regionId));
  identity.polities.sort((a, b) => a.polityId.localeCompare(b.polityId));
  return { identity, polityRecords, regionRecords, events };
}

export const applyIdentityUnrest = (currentBp: number, pressureBp: number): number => clampBp(currentBp + Math.min(300, Math.floor(pressureBp / 5)));
