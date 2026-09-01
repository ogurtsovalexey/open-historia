import type { PolityId, RegionId } from '@open-historia/domain';
import type { CommandRejection, MilitaryCommand } from './commands.js';
import { clampBp } from './fixedPoint.js';
import { sha256OfString } from './canonical.js';
import type { EconRegionState, EconWorldState } from './state.js';
import { addMonth } from './state.js';
import { actualController, type Formation, type MilitaryState } from './military.js';
import { polityIdentityEffects } from './identityReducer.js';
import { capabilityBonusBp, type CapabilityState, type IdentityState } from './society.js';

export interface MutableMilitaryPolity { id: PolityId; treasury: number }
export interface MilitaryTransferRecord {
  regionId: RegionId; fromPolityId: PolityId; toPolityId: PolityId;
  population: number; infrastructureBp: number; damageBp: number;
}
export interface CombatRecord {
  frontId: string; warId: string; seedKey: string; variationBp: number;
  attackerPolityId: PolityId; defenderPolityId: PolityId;
  fromRegionId: RegionId; targetRegionId: RegionId;
  attackerManpower: number; defenderManpower: number;
  attackerEquipment: number; defenderEquipment: number;
  attackerSupplyBp: number; defenderSupplyBp: number;
  attackerPower: number; defenderPower: number;
  attackerLosses: number; defenderLosses: number;
  attackerEquipmentLost: number; defenderEquipmentLost: number;
  outcome: 'held' | 'occupied' | 'unopposed-occupation';
}
export interface MilitaryCommandRecord {
  commandId: string; kind: MilitaryCommand['kind']; polityId: PolityId;
  manpowerMoved: number; equipmentMoved: number; treasuryMoved: number;
}
export interface MilitaryTreasuryTransfer { offerId: string; fromPolityId: PolityId; toPolityId: PolityId; amount: number }
export type MilitaryEngineEvent =
  | { type: 'war-declared'; warId: string; attackerPolityId: PolityId; defenderPolityId: PolityId; reason: string }
  | { type: 'formation-mobilized'; formationId: string; polityId: PolityId; readyMonth: string }
  | { type: 'formation-activated'; formationId: string; polityId: PolityId }
  | { type: 'formation-demobilized'; formationId: string; polityId: PolityId }
  | { type: 'formation-split'; formationId: string; newFormationId: string; polityId: PolityId }
  | { type: 'formation-merged'; primaryFormationId: string; secondaryFormationId: string; polityId: PolityId }
  | { type: 'military-order-issued'; formationId: string; polityId: PolityId; posture: string }
  | { type: 'combat-resolved'; frontId: string; warId: string; outcome: CombatRecord['outcome'] }
  | { type: 'region-occupied'; warId: string; regionId: RegionId; actualControllerId: PolityId }
  | { type: 'peace-offered'; offerId: string; warId: string; proposerPolityId: PolityId; recipientPolityId: PolityId }
  | { type: 'peace-resolved'; offerId: string; warId: string; accepted: boolean }
  | { type: 'call-to-arms-issued'; callId: string; warId: string; calledPolityId: PolityId; beneficiaryPolityId: PolityId }
  | { type: 'call-to-arms-resolved'; callId: string; warId: string; response: 'accept' | 'refuse' | 'expired' };

const cloneMilitary = (state: MilitaryState): MilitaryState => ({
  combatSeed: state.combatSeed,
  polities: state.polities.map((entry) => ({ ...entry })),
  commanders: state.commanders.map((entry) => ({ ...entry, displayName: { ...entry.displayName }, traits: [...entry.traits] })),
  formations: state.formations.map((entry) => ({ ...entry, displayName: { ...entry.displayName } })),
  supplyLinks: state.supplyLinks.map((entry) => ({ ...entry, regions: [...entry.regions] as [RegionId, RegionId] })),
  wars: state.wars.map((entry) => ({ ...entry, attackers: [...entry.attackers], defenders: [...entry.defenders] })),
  fronts: state.fronts.map((entry) => ({ ...entry })),
  occupations: state.occupations.map((entry) => ({ ...entry })),
  peaceOffers: state.peaceOffers.map((entry) => ({ ...entry, regionTransfers: entry.regionTransfers.map((transfer) => ({ ...transfer })), reparation: entry.reparation ? { ...entry.reparation } : null })),
  callsToArms: (state.callsToArms ?? []).map((entry) => ({ ...entry, sourceAgreementIds: [...entry.sourceAgreementIds] })),
});

const opposing = (war: MilitaryState['wars'][number], left: string, right: string): boolean =>
  (war.attackers.includes(left as PolityId) && war.defenders.includes(right as PolityId))
  || (war.defenders.includes(left as PolityId) && war.attackers.includes(right as PolityId));
const partyTo = (war: MilitaryState['wars'][number], polityId: string): boolean =>
  war.attackers.includes(polityId as PolityId) || war.defenders.includes(polityId as PolityId);
const linkFor = (military: MilitaryState, left: string, right: string) => military.supplyLinks.find((entry) =>
  (entry.regions[0] === left && entry.regions[1] === right) || (entry.regions[0] === right && entry.regions[1] === left));

export function applyMilitaryCommands(
  state: EconWorldState,
  commands: MilitaryCommand[],
  polities: MutableMilitaryPolity[],
  regions: EconRegionState[],
  identity?: IdentityState,
): {
  military: MilitaryState | undefined; transfers: MilitaryTransferRecord[]; treasuryTransfers: MilitaryTreasuryTransfer[];
  relationPenalties: Array<{ polityId: PolityId; counterpartyPolityId?: PolityId; deltaTrust: number; deltaOpinion: number; deltaThreat: number }>;
  politicsPenalties: Array<{ polityId: PolityId; legitimacy: number; stability: number; unrest: number }>;
  commandRecords: MilitaryCommandRecord[]; events: MilitaryEngineEvent[]; rejections: CommandRejection[];
} {
  const military = state.military ? cloneMilitary(state.military) : undefined;
  const polityById = new Map(polities.map((entry) => [entry.id, entry]));
  const regionById = new Map(regions.map((entry) => [entry.regionId, entry]));
  const transfers: MilitaryTransferRecord[] = [];
  const treasuryTransfers: MilitaryTreasuryTransfer[] = [];
  const relationPenalties: Array<{ polityId: PolityId; counterpartyPolityId?: PolityId; deltaTrust: number; deltaOpinion: number; deltaThreat: number }> = [];
  const politicsPenalties: Array<{ polityId: PolityId; legitimacy: number; stability: number; unrest: number }> = [];
  const commandRecords: MilitaryCommandRecord[] = [];
  const events: MilitaryEngineEvent[] = [];
  const rejections: CommandRejection[] = [];
  const reject = (command: MilitaryCommand, reason: CommandRejection['reason'], detail: string) => rejections.push({ command, reason, detail });
  const record = (command: MilitaryCommand, manpowerMoved = 0, equipmentMoved = 0, treasuryMoved = 0) =>
    commandRecords.push({ commandId: command.commandId, kind: command.kind, polityId: command.actorPolityId, manpowerMoved, equipmentMoved, treasuryMoved });

  for (const formation of military?.formations ?? []) {
    if (formation.status === 'mobilizing' && formation.readyMonth && formation.readyMonth <= state.month) {
      formation.status = 'active'; formation.readyMonth = null;
      events.push({ type: 'formation-activated', formationId: formation.formationId, polityId: formation.polityId });
    }
  }

  for (const command of commands) {
    const actor = polityById.get(command.actorPolityId);
    if (!actor) { reject(command, 'unknown-actor', `no polity ${command.actorPolityId}`); continue; }
    if (command.effectiveMonth !== state.month) { reject(command, 'wrong-month', `command month ${command.effectiveMonth}, world month ${state.month}`); continue; }
    if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) { reject(command, 'stale-revision', `expected ${command.expectedRevision}, world at ${state.revision}`); continue; }
    if (state.modules?.armedForces !== true || !military) { reject(command, 'module-disabled', 'armedForces module is not enabled'); continue; }
    const militaryPolity = military.polities.find((entry) => entry.polityId === actor.id)!;

    if (command.kind === 'war.declare') {
      const defender = polityById.get(command.defenderPolityId);
      if (!defender) { reject(command, 'unknown-polity', `no defender ${command.defenderPolityId}`); continue; }
      if (defender.id === actor.id) { reject(command, 'invalid-target', 'cannot declare war on self'); continue; }
      if (military.wars.some((entry) => entry.warId === command.warId)) { reject(command, 'duplicate-id', `war ${command.warId} exists`); continue; }
      if (military.wars.some((entry) => entry.status === 'active' && opposing(entry, actor.id, defender.id))) { reject(command, 'invalid-target', 'the parties are already at war'); continue; }
      const protectedAgreement = state.diplomacy?.agreements.find((entry) => entry.terms.kind === 'agreement'
        && ['non-aggression', 'defensive-alliance'].includes(entry.terms.agreementType)
        && [entry.terms.fromPolityId, entry.terms.toPolityId].includes(actor.id)
        && [entry.terms.fromPolityId, entry.terms.toPolityId].includes(defender.id));
      if (protectedAgreement) { reject(command, 'invalid-target', `active protected agreement ${protectedAgreement.agreementId} forbids this declaration`); continue; }
      military.wars.push({ warId: command.warId, attackers: [actor.id], defenders: [defender.id], reason: command.reason,
        declaredByPolityId: actor.id, startedMonth: state.month, endedMonth: null, status: 'active' });
      const obligations = new Map<PolityId, string[]>();
      for (const agreement of state.diplomacy?.agreements ?? []) {
        if (agreement.terms.kind !== 'agreement') continue;
        let called: PolityId | null = null;
        if (agreement.terms.agreementType === 'defensive-alliance') {
          if (agreement.terms.fromPolityId === defender.id) called = agreement.terms.toPolityId;
          if (agreement.terms.toPolityId === defender.id) called = agreement.terms.fromPolityId;
        } else if (agreement.terms.agreementType === 'guarantee' && agreement.terms.toPolityId === defender.id) {
          called = agreement.terms.fromPolityId;
        }
        if (!called || called === actor.id || called === defender.id) continue;
        const sources = obligations.get(called) ?? []; sources.push(agreement.agreementId); obligations.set(called, sources);
      }
      for (const called of [...obligations.keys()].sort()) {
        const slug = (value: string) => value.slice(value.indexOf(':') + 1).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
        const digest = sha256OfString(`${command.warId}|${called}`).slice('sha256:'.length, 'sha256:'.length + 16);
        const callId = `call:${slug(command.warId).slice(0, 80)}-${digest}`;
        military.callsToArms!.push({ callId, warId: command.warId, beneficiaryPolityId: defender.id, calledPolityId: called,
          sourceAgreementIds: [...new Set(obligations.get(called)!)].sort(), status: 'pending', createdMonth: state.month, resolvedMonth: null });
        events.push({ type: 'call-to-arms-issued', callId, warId: command.warId, calledPolityId: called, beneficiaryPolityId: defender.id });
      }
      if (command.reason === 'none') {
        relationPenalties.push({ polityId: actor.id, deltaTrust: -1500, deltaOpinion: -1200, deltaThreat: 1800 });
        politicsPenalties.push({ polityId: actor.id, legitimacy: -800, stability: -500, unrest: 700 });
      }
      record(command);
      events.push({ type: 'war-declared', warId: command.warId, attackerPolityId: actor.id, defenderPolityId: defender.id, reason: command.reason });
      continue;
    }

    if (command.kind === 'war.respond-call') {
      const call = military.callsToArms!.find((entry) => entry.callId === command.callId && entry.status === 'pending');
      if (!call) { reject(command, 'invalid-target', `no pending call ${command.callId}`); continue; }
      if (call.calledPolityId !== actor.id) { reject(command, 'unauthorized', 'only the called polity may respond'); continue; }
      const war = military.wars.find((entry) => entry.warId === call.warId && entry.status === 'active');
      if (!war) { reject(command, 'unknown-war', `war ${call.warId} is not active`); continue; }
      if (command.response === 'accept' && war.attackers.includes(actor.id)) { reject(command, 'invalid-target', 'an attacker cannot join the defenders'); continue; }
      if (command.response === 'accept' && !war.defenders.includes(actor.id)) war.defenders.push(actor.id);
      call.status = command.response === 'accept' ? 'accepted' : 'refused'; call.resolvedMonth = state.month;
      if (command.response === 'refuse') relationPenalties.push({ polityId: actor.id, counterpartyPolityId: call.beneficiaryPolityId,
        deltaTrust: -1000, deltaOpinion: -500, deltaThreat: 0 });
      war.defenders.sort(); record(command);
      events.push({ type: 'call-to-arms-resolved', callId: call.callId, warId: war.warId, response: command.response });
      continue;
    }

    if (command.kind === 'military.mobilize') {
      if (military.formations.some((entry) => entry.formationId === command.formationId)) { reject(command, 'duplicate-id', `formation ${command.formationId} exists`); continue; }
      const region = regionById.get(command.locationRegionId);
      if (!region || region.controllerId !== actor.id || actualController(military, region.regionId, region.controllerId) !== actor.id) { reject(command, 'foreign-target', 'mobilization region is not under actual control'); continue; }
      const commander = command.commanderId ? military.commanders.find((entry) => entry.commanderId === command.commanderId) : null;
      if (command.commanderId && (!commander || commander.polityId !== actor.id)) { reject(command, 'unknown-commander', 'commander is unknown or foreign'); continue; }
      if (command.manpower > militaryPolity.manpowerPool) { reject(command, 'invalid-amount', `manpower ${command.manpower} exceeds pool ${militaryPolity.manpowerPool}`); continue; }
      const recruitmentBp = polityIdentityEffects(identity, regions, actor.id).recruitmentMultiplierBp;
      const identityAvailable = Math.max(0, Math.floor((militaryPolity.manpowerCeiling * recruitmentBp) / 10000)
        - militaryPolity.mobilized - militaryPolity.casualties);
      if (command.manpower > identityAvailable) { reject(command, 'invalid-amount', `manpower ${command.manpower} exceeds identity-adjusted availability ${identityAvailable}`); continue; }
      if (command.equipment > militaryPolity.equipmentReserve) { reject(command, 'invalid-amount', `equipment ${command.equipment} exceeds reserve ${militaryPolity.equipmentReserve}`); continue; }
      militaryPolity.manpowerPool -= command.manpower; militaryPolity.mobilized += command.manpower;
      militaryPolity.equipmentReserve -= command.equipment;
      const readyMonth = addMonth(state.month);
      military.formations.push({ formationId: command.formationId, polityId: actor.id,
        displayName: { en: `Reserve ${command.formationId.slice('formation:'.length)}`, ru: `Резерв ${command.formationId.slice('formation:'.length)}` },
        manpower: command.manpower, equipment: command.equipment, homeRegionId: region.regionId,
        locationRegionId: region.regionId, commanderId: command.commanderId, status: 'mobilizing', readyMonth,
        posture: 'hold', targetRegionId: null, moraleBp: 7000, familiarityBp: 0 });
      record(command, command.manpower, command.equipment);
      events.push({ type: 'formation-mobilized', formationId: command.formationId, polityId: actor.id, readyMonth });
      continue;
    }

    if (command.kind === 'peace.propose') {
      const war = military.wars.find((entry) => entry.warId === command.warId && entry.status === 'active');
      if (!war) { reject(command, 'unknown-war', `no active war ${command.warId}`); continue; }
      if (!partyTo(war, actor.id) || !partyTo(war, command.recipientPolityId) || !opposing(war, actor.id, command.recipientPolityId)) { reject(command, 'unauthorized', 'peace parties must oppose each other in the war'); continue; }
      if (military.peaceOffers.some((entry) => entry.offerId === command.offerId)) { reject(command, 'duplicate-id', `peace offer ${command.offerId} exists`); continue; }
      const uniqueRegions = new Set(command.regionTransfers.map((entry) => entry.regionId));
      const invalidTransfer = uniqueRegions.size !== command.regionTransfers.length || command.regionTransfers.some((transfer) => {
        const region = regionById.get(transfer.regionId);
        return !region || !partyTo(war, region.controllerId) || !partyTo(war, transfer.toPolityId)
          || actualController(military, region.regionId, region.controllerId) !== transfer.toPolityId;
      });
      const invalidReparation = command.reparation && (!opposing(war, command.reparation.fromPolityId, command.reparation.toPolityId)
        || ![actor.id, command.recipientPolityId].includes(command.reparation.fromPolityId)
        || ![actor.id, command.recipientPolityId].includes(command.reparation.toPolityId));
      if (invalidTransfer || invalidReparation) { reject(command, 'illegal-peace-term', 'peace terms require occupied belligerent regions and opposing reparation parties'); continue; }
      military.peaceOffers.push({ offerId: command.offerId, warId: war.warId, proposerPolityId: actor.id,
        recipientPolityId: command.recipientPolityId, regionTransfers: command.regionTransfers.map((entry) => ({ ...entry })),
        reparation: command.reparation ? { ...command.reparation } : null, status: 'pending', createdMonth: state.month, resolvedMonth: null });
      record(command);
      events.push({ type: 'peace-offered', offerId: command.offerId, warId: war.warId, proposerPolityId: actor.id, recipientPolityId: command.recipientPolityId });
      continue;
    }

    if (command.kind === 'peace.respond') {
      const offer = military.peaceOffers.find((entry) => entry.offerId === command.offerId && entry.status === 'pending');
      if (!offer) { reject(command, 'unknown-peace-offer', `no pending offer ${command.offerId}`); continue; }
      if (offer.recipientPolityId !== actor.id) { reject(command, 'unauthorized', 'only the peace recipient may respond'); continue; }
      const war = military.wars.find((entry) => entry.warId === offer.warId && entry.status === 'active');
      if (!war) { reject(command, 'unknown-war', `war ${offer.warId} is not active`); continue; }
      if (command.response === 'accept' && offer.regionTransfers.some((transfer) => {
        const region = regionById.get(transfer.regionId);
        return !region || !partyTo(war, region.controllerId) || !partyTo(war, transfer.toPolityId)
          || actualController(military, transfer.regionId, region.controllerId) !== transfer.toPolityId;
      })) { reject(command, 'illegal-peace-term', 'accepted territorial terms no longer match current occupation'); continue; }
      if (command.response === 'accept' && offer.reparation) {
        const payer = polityById.get(offer.reparation.fromPolityId)!;
        if (payer.treasury < offer.reparation.amount) { reject(command, 'insufficient-treasury', `reparation ${offer.reparation.amount} exceeds treasury ${payer.treasury}`); continue; }
      }
      offer.status = command.response === 'accept' ? 'accepted' : 'rejected'; offer.resolvedMonth = state.month;
      if (command.response === 'accept') {
        for (const transfer of offer.regionTransfers) {
          const region = regionById.get(transfer.regionId)!;
          const from = region.controllerId;
          if (from !== transfer.toPolityId) {
            transfers.push({ regionId: region.regionId, fromPolityId: from, toPolityId: transfer.toPolityId,
              population: region.population, infrastructureBp: region.infrastructureBp, damageBp: region.damageBp });
            region.controllerId = transfer.toPolityId;
          }
        }
        if (offer.reparation) {
          const payer = polityById.get(offer.reparation.fromPolityId)!;
          const receiver = polityById.get(offer.reparation.toPolityId)!;
          payer.treasury -= offer.reparation.amount; receiver.treasury += offer.reparation.amount;
          treasuryTransfers.push({ offerId: offer.offerId, fromPolityId: payer.id, toPolityId: receiver.id, amount: offer.reparation.amount });
        }
        war.status = 'ended'; war.endedMonth = state.month;
        for (const call of military.callsToArms!.filter((entry) => entry.warId === war.warId && entry.status === 'pending')) {
          call.status = 'expired'; call.resolvedMonth = state.month;
          events.push({ type: 'call-to-arms-resolved', callId: call.callId, warId: war.warId, response: 'expired' });
        }
        military.occupations = military.occupations.filter((entry) => entry.warId !== war.warId);
        military.fronts = military.fronts.filter((entry) => entry.warId !== war.warId);
        for (const formation of military.formations.filter((entry) => partyTo(war, entry.polityId))) {
          formation.posture = 'hold'; formation.targetRegionId = null;
        }
        for (const other of military.peaceOffers.filter((entry) => entry.warId === war.warId && entry.status === 'pending')) {
          other.status = 'superseded'; other.resolvedMonth = state.month;
        }
      }
      record(command, 0, 0, command.response === 'accept' ? (offer.reparation?.amount ?? 0) : 0);
      events.push({ type: 'peace-resolved', offerId: offer.offerId, warId: war.warId, accepted: command.response === 'accept' });
      continue;
    }

    const formationId = command.kind === 'military.split' ? command.sourceFormationId
      : command.kind === 'military.merge' ? command.primaryFormationId : command.formationId;
    const formation = military.formations.find((entry) => entry.formationId === formationId);
    if (!formation) { reject(command, 'unknown-formation', `no formation ${formationId}`); continue; }
    if (formation.polityId !== actor.id) { reject(command, 'unauthorized', 'formation belongs to another polity'); continue; }

    if (command.kind === 'military.demobilize') {
      if (!['active', 'mobilizing'].includes(formation.status)) { reject(command, 'invalid-target', `formation is ${formation.status}`); continue; }
      if (military.wars.some((entry) => entry.status === 'active' && partyTo(entry, actor.id))) { reject(command, 'not-at-war', 'cannot demobilize while at war'); continue; }
      militaryPolity.manpowerPool += formation.manpower; militaryPolity.mobilized -= formation.manpower;
      militaryPolity.equipmentReserve += formation.equipment;
      const movedManpower = formation.manpower; const movedEquipment = formation.equipment;
      formation.manpower = 0; formation.equipment = 0; formation.status = 'demobilized'; formation.posture = 'hold'; formation.targetRegionId = null;
      record(command, movedManpower, movedEquipment);
      events.push({ type: 'formation-demobilized', formationId: formation.formationId, polityId: actor.id });
    } else if (command.kind === 'military.split') {
      if (formation.status !== 'active' || command.manpower >= formation.manpower || command.equipment >= formation.equipment) { reject(command, 'invalid-amount', 'split must leave positive manpower and equipment in the source'); continue; }
      if (military.formations.some((entry) => entry.formationId === command.newFormationId)) { reject(command, 'duplicate-id', `formation ${command.newFormationId} exists`); continue; }
      formation.manpower -= command.manpower; formation.equipment -= command.equipment;
      military.formations.push({ ...formation, formationId: command.newFormationId,
        displayName: { en: `${formation.displayName.en} Detachment`, ru: `${formation.displayName.ru} — отряд` },
        manpower: command.manpower, equipment: command.equipment, commanderId: null });
      record(command, command.manpower, command.equipment);
      events.push({ type: 'formation-split', formationId: formation.formationId, newFormationId: command.newFormationId, polityId: actor.id });
    } else if (command.kind === 'military.merge') {
      const secondary = military.formations.find((entry) => entry.formationId === command.secondaryFormationId);
      if (!secondary) { reject(command, 'unknown-formation', `no formation ${command.secondaryFormationId}`); continue; }
      if (secondary.polityId !== actor.id || secondary.status !== 'active' || formation.status !== 'active'
        || secondary.locationRegionId !== formation.locationRegionId || secondary.formationId === formation.formationId) {
        reject(command, 'invalid-target', 'merge requires two distinct active co-located formations of the actor'); continue;
      }
      const movedManpower = secondary.manpower; const movedEquipment = secondary.equipment;
      formation.manpower += movedManpower; formation.equipment += movedEquipment;
      formation.familiarityBp = Math.floor((formation.familiarityBp + secondary.familiarityBp) / 2);
      secondary.manpower = 0; secondary.equipment = 0; secondary.status = 'demobilized'; secondary.posture = 'hold'; secondary.targetRegionId = null;
      record(command, movedManpower, movedEquipment);
      events.push({ type: 'formation-merged', primaryFormationId: formation.formationId, secondaryFormationId: secondary.formationId, polityId: actor.id });
    } else {
      if (formation.status !== 'active') { reject(command, 'invalid-target', `formation is ${formation.status}`); continue; }
      if (command.posture === 'advance') {
        const target = command.targetRegionId ? regionById.get(command.targetRegionId) : undefined;
        const targetController = target ? actualController(military, target.regionId, target.controllerId) : null;
        const war = targetController ? military.wars.find((entry) => entry.status === 'active' && opposing(entry, actor.id, targetController)) : null;
        if (!target || !war || !linkFor(military, formation.locationRegionId, target.regionId)) { reject(command, 'disconnected-front', 'advance requires an adjacent supplied enemy target in an active war'); continue; }
      } else if (command.targetRegionId !== null) { reject(command, 'invalid-target', `${command.posture} order must not carry a target`); continue; }
      if (command.posture === 'withdraw') {
        const home = regionById.get(formation.homeRegionId)!;
        if (actualController(military, home.regionId, home.controllerId) !== actor.id) { reject(command, 'invalid-target', 'cannot withdraw to an enemy-controlled home region'); continue; }
        formation.locationRegionId = formation.homeRegionId;
      }
      formation.posture = command.posture; formation.targetRegionId = command.targetRegionId;
      record(command);
      events.push({ type: 'military-order-issued', formationId: formation.formationId, polityId: actor.id, posture: command.posture });
    }
  }
  military?.wars.sort((a, b) => a.warId.localeCompare(b.warId));
  military?.formations.sort((a, b) => a.formationId.localeCompare(b.formationId));
  military?.peaceOffers.sort((a, b) => a.offerId.localeCompare(b.offerId));
  military?.callsToArms?.sort((a, b) => a.callId.localeCompare(b.callId));
  return { military, transfers, treasuryTransfers, relationPenalties, politicsPenalties, commandRecords, events, rejections };
}

const formationPower = (formation: Formation, commanderSkill: number, supplyBp: number, variationBp: number): number => {
  const equipmentBp = Math.min(10000, Math.floor((formation.equipment * 10000) / Math.max(1, formation.manpower)));
  const postureBp = formation.posture === 'advance' ? 11000 : formation.posture === 'defend' ? 12000 : 10000;
  let power = formation.manpower;
  for (const factor of [equipmentBp, formation.moraleBp, supplyBp, postureBp, 10000 + commanderSkill * 500, 10000 + Math.floor(formation.familiarityBp / 4), variationBp]) {
    power = Math.floor((power * factor) / 10000);
  }
  return power;
};

const applyFormationLosses = (military: MilitaryState, formations: Formation[], lossBp: number): { manpower: number; equipment: number } => {
  let manpower = 0; let equipment = 0;
  for (const formation of formations.sort((a, b) => a.formationId.localeCompare(b.formationId))) {
    const polity = military.polities.find((entry) => entry.polityId === formation.polityId)!;
    const manpowerLoss = Math.min(formation.manpower, Math.floor((formation.manpower * lossBp) / 10000));
    const equipmentLoss = Math.min(formation.equipment, Math.floor((formation.equipment * lossBp) / 10000));
    formation.manpower -= manpowerLoss; formation.equipment -= equipmentLoss;
    formation.moraleBp = clampBp(formation.moraleBp - lossBp);
    formation.familiarityBp = clampBp(formation.familiarityBp + 150);
    polity.mobilized -= manpowerLoss; polity.casualties += manpowerLoss; polity.equipmentLost += equipmentLoss;
    manpower += manpowerLoss; equipment += equipmentLoss;
    if (formation.manpower === 0) { formation.status = 'destroyed'; formation.posture = 'hold'; formation.targetRegionId = null; }
  }
  return { manpower, equipment };
};

export function resolveMilitaryMonth(
  state: EconWorldState,
  military: MilitaryState | undefined,
  regions: EconRegionState[],
  capabilities?: CapabilityState,
): { military: MilitaryState | undefined; combats: CombatRecord[]; events: MilitaryEngineEvent[] } {
  if (!military || state.modules?.combat !== true) return { military, combats: [], events: [] };
  const events: MilitaryEngineEvent[] = [];
  const combats: CombatRecord[] = [];
  const regionById = new Map(regions.map((entry) => [entry.regionId, entry]));
  const advances = military.formations.filter((entry) => entry.status === 'active' && entry.posture === 'advance' && entry.targetRegionId)
    .sort((a, b) => a.formationId.localeCompare(b.formationId));
  const groups = new Map<string, Formation[]>();
  for (const formation of advances) {
    const target = regionById.get(formation.targetRegionId!);
    if (!target) continue;
    const defenderId = actualController(military, target.regionId, target.controllerId);
    const war = military.wars.find((entry) => entry.status === 'active' && opposing(entry, formation.polityId, defenderId));
    if (!war) continue;
    const key = `${war.warId}|${formation.polityId}|${formation.locationRegionId}|${target.regionId}|${defenderId}`;
    const list = groups.get(key) ?? []; list.push(formation); groups.set(key, list);
  }
  for (const key of [...groups.keys()].sort()) {
    const attackers = groups.get(key)!;
    const [warId, attackerText, fromText, targetText, defenderText] = key.split('|');
    const attackerId = attackerText as PolityId; const defenderId = defenderText as PolityId;
    const fromRegionId = fromText as RegionId; const targetRegionId = targetText as RegionId;
    const defenders = military.formations.filter((entry) => entry.status === 'active' && entry.polityId === defenderId && entry.locationRegionId === targetRegionId);
    const link = linkFor(military, fromRegionId, targetRegionId)!;
    const attackerManpower = attackers.reduce((sum, entry) => sum + entry.manpower, 0);
    const defenderManpower = defenders.reduce((sum, entry) => sum + entry.manpower, 0);
    const attackerEquipment = attackers.reduce((sum, entry) => sum + entry.equipment, 0);
    const defenderEquipment = defenders.reduce((sum, entry) => sum + entry.equipment, 0);
    const effectiveLinkCapacity = Math.floor((link.capacity * (10000 + capabilityBonusBp(capabilities, attackerId, 'land-supply'))) / 10000);
    const attackerSupplyBp = Math.min(10000, Math.floor((effectiveLinkCapacity * 10000) / Math.max(1, attackerManpower)));
    const target = regionById.get(targetRegionId)!;
    const defenderSupplyBp = actualController(military, targetRegionId, target.controllerId) === defenderId ? 10000 : 6000;
    const frontSlug = (regionId: string) => regionId.slice(regionId.lastIndexOf(':') + 1).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const frontId = `front:${warId!.slice('war:'.length)}-${frontSlug(fromRegionId)}-${frontSlug(targetRegionId)}`;
    const seedKey = `${military.combatSeed}|${state.month}|${warId}|${frontId}`;
    const variationBp = 9500 + (Number.parseInt(sha256OfString(seedKey).slice(7, 15), 16) % 1001);
    const totalPower = (formations: Formation[], supplyBp: number, variation: number) => formations.reduce((sum, formation) => {
      const commander = formation.commanderId ? military.commanders.find((entry) => entry.commanderId === formation.commanderId) : null;
      const traitBonus = commander?.traits.includes(formation.posture === 'defend' ? 'defensive' : 'offensive') ? 1 : 0;
      return sum + formationPower(formation, (commander?.skill ?? 0) + traitBonus, supplyBp, variation);
    }, 0);
    const attackerPower = totalPower(attackers, attackerSupplyBp, variationBp);
    const defenderPower = totalPower(defenders, defenderSupplyBp, 10000);
    const attackerLossBp = Math.min(1200, Math.max(defenderPower > 0 ? 100 : 0, Math.floor((defenderPower * 500) / Math.max(1, attackerPower))));
    const defenderLossBp = Math.min(1800, Math.max(attackerPower > 0 ? 150 : 0, Math.floor((attackerPower * 700) / Math.max(1, defenderPower))));
    const attackerLoss = applyFormationLosses(military, attackers, attackerLossBp);
    const defenderLoss = applyFormationLosses(military, defenders, defenderLossBp);
    let outcome: CombatRecord['outcome'] = 'held';
    if (defenders.length === 0 || attackerPower > Math.floor((defenderPower * 11000) / 10000)) {
      outcome = defenders.length === 0 ? 'unopposed-occupation' : 'occupied';
      const existing = military.occupations.find((entry) => entry.warId === warId && entry.regionId === targetRegionId);
      if (existing) { existing.actualControllerId = attackerId; existing.occupiedMonth = state.month; }
      else military.occupations.push({ warId: warId!, regionId: targetRegionId, legalControllerId: target.controllerId,
        actualControllerId: attackerId, occupiedMonth: state.month });
      for (const formation of attackers.filter((entry) => entry.status === 'active')) {
        formation.locationRegionId = targetRegionId; formation.posture = 'hold'; formation.targetRegionId = null;
      }
      for (const formation of defenders.filter((entry) => entry.status === 'active')) {
        formation.locationRegionId = formation.homeRegionId; formation.posture = 'defend'; formation.targetRegionId = null;
      }
      events.push({ type: 'region-occupied', warId: warId!, regionId: targetRegionId, actualControllerId: attackerId });
    }
    const front = military.fronts.find((entry) => entry.frontId === frontId);
    if (front) front.lastResolvedMonth = state.month;
    else military.fronts.push({ frontId, warId: warId!, fromRegionId, targetRegionId, attackerPolityId: attackerId,
      defenderPolityId: defenderId, lastResolvedMonth: state.month });
    const combat: CombatRecord = { frontId, warId: warId!, seedKey, variationBp, attackerPolityId: attackerId,
      defenderPolityId: defenderId, fromRegionId, targetRegionId, attackerManpower, defenderManpower,
      attackerEquipment, defenderEquipment, attackerSupplyBp, defenderSupplyBp, attackerPower, defenderPower,
      attackerLosses: attackerLoss.manpower, defenderLosses: defenderLoss.manpower,
      attackerEquipmentLost: attackerLoss.equipment, defenderEquipmentLost: defenderLoss.equipment, outcome };
    combats.push(combat); events.push({ type: 'combat-resolved', frontId, warId: warId!, outcome });
    for (const formation of [...attackers, ...defenders]) {
      const commander = formation.commanderId ? military.commanders.find((entry) => entry.commanderId === formation.commanderId) : null;
      if (commander) commander.experience += 1;
    }
  }
  military.fronts.sort((a, b) => a.frontId.localeCompare(b.frontId));
  military.occupations.sort((a, b) => `${a.regionId}|${a.warId}`.localeCompare(`${b.regionId}|${b.warId}`));
  return { military, combats, events };
}
