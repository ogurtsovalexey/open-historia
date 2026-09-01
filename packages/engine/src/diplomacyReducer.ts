import type { PolityId, RegionId } from '@open-historia/domain';
import type { CommandRejection, DiplomacyCommand } from './commands.js';
import type { NegotiationTerms } from './diplomacy.js';
import { relationKey } from './diplomacy.js';
import type { RawResourceId, ResourceId } from './scenario.js';
import { hasProcessingActivity } from './scenario.js';
import type { EconWorldState } from './state.js';
import { addMonth } from './state.js';

export interface MutableTradePolity {
  id: PolityId;
  treasury: number;
  stock: Map<ResourceId, number>;
}

export interface MutableSettlementRegion {
  regionId: RegionId;
  controllerId: PolityId;
  population: number;
  infrastructureBp: number;
  damageBp: number;
  activity?: { kind: 'processing'; activity: 'basic_goods' } | { kind: 'extraction'; resource: RawResourceId };
  activities?: Array<{ activity: { kind: 'processing'; activity: 'basic_goods' } | { kind: 'extraction'; resource: RawResourceId }; allocationBp: number }>;
}

export interface TerritorialSettlementTransfer {
  regionId: RegionId;
  fromPolityId: PolityId;
  toPolityId: PolityId;
  population: number;
  infrastructureBp: number;
  damageBp: number;
}

export interface ResourceTransferRecord {
  contractId: string;
  fromPolityId: PolityId;
  toPolityId: PolityId;
  resource: ResourceId;
  amount: number;
}

export interface TreasuryTransferRecord {
  sourceId: string;
  reason: 'trade' | 'termination-penalty';
  fromPolityId: PolityId;
  toPolityId: PolityId;
  amount: number;
}

export interface TradeExecutionRecord {
  contractId: string;
  fromPolityId: PolityId;
  toPolityId: PolityId;
  fulfillmentBp: number;
  routeCapacityUsed: number;
  fromDelivered: { kind: 'resource' | 'treasury'; resource?: ResourceId; amount: number; referenceValue: number };
  toDelivered: { kind: 'resource' | 'treasury'; resource?: ResourceId; amount: number; referenceValue: number };
  breach: boolean;
}

export type DiplomacyEngineEvent =
  | { type: 'proposal-created'; proposalId: string; proposerId: PolityId; recipientId: PolityId }
  | { type: 'proposal-countered'; proposalId: string; counterProposalId: string; proposerId: PolityId; recipientId: PolityId }
  | { type: 'proposal-rejected'; proposalId: string; actorPolityId: PolityId }
  | { type: 'agreement-created'; agreementId: string; proposalId: string; parties: [PolityId, PolityId]; agreementKind: string }
  | { type: 'territorial-settlement-accepted'; proposalId: string; fromPolityId: PolityId; toPolityId: PolityId; regionIds: RegionId[] }
  | { type: 'agreement-terminated'; agreementId: string; actorPolityId: PolityId; penaltyPaid: number }
  | { type: 'trade-settled'; contractId: string; fulfillmentBp: number; breach: boolean };

const agreementIdFor = (proposalId: string): string => `agreement:${proposalId.slice('proposal:'.length)}`;
const pair = (left: string, right: string): [PolityId, PolityId] =>
  (left < right ? [left, right] : [right, left]) as [PolityId, PolityId];
const participantsMatch = (terms: NegotiationTerms, left: string, right: string): boolean =>
  relationKey(terms.fromPolityId, terms.toPolityId) === relationKey(left, right);
const isParticipant = (terms: NegotiationTerms, polityId: string): boolean =>
  terms.fromPolityId === polityId || terms.toPolityId === polityId;

const legAvailabilityBp = (polity: MutableTradePolity, leg: { kind: string; resource?: ResourceId; amount: number }): number => {
  const available = leg.kind === 'treasury' ? polity.treasury : polity.stock.get(leg.resource!) ?? 0;
  return Math.min(10000, Math.floor((available * 10000) / leg.amount));
};

const referenceValue = (state: EconWorldState, polity: MutableTradePolity, leg: { kind: string; resource?: ResourceId; amount: number }): number => {
  if (leg.kind === 'treasury') return leg.amount;
  const accountingValue = state.economy.resourceParams.find((entry) => entry.resource === leg.resource)?.accountingValue ?? 0;
  const available = polity.stock.get(leg.resource!) ?? 0;
  const target = Math.max(1, leg.amount * 4);
  const availabilityBp = Math.min(10000, Math.floor((available * 10000) / target));
  const scarcityBp = 10000 - availabilityBp;
  return Math.floor((leg.amount * accountingValue * (10000 + scarcityBp)) / 10000);
};

export function resolveDiplomacyPhase(
  state: EconWorldState,
  commands: DiplomacyCommand[],
  polities: MutableTradePolity[],
  regions: MutableSettlementRegion[],
): {
  diplomacy: EconWorldState['diplomacy'];
  trade: EconWorldState['trade'];
  events: DiplomacyEngineEvent[];
  rejections: CommandRejection[];
  executions: TradeExecutionRecord[];
  resourceTransfers: ResourceTransferRecord[];
  treasuryTransfers: TreasuryTransferRecord[];
  territorialTransfers: TerritorialSettlementTransfer[];
} {
  const diplomacy = state.diplomacy ? {
    relations: state.diplomacy.relations.map((entry) => ({ ...entry, polities: [...entry.polities] as [PolityId, PolityId] })),
    proposals: state.diplomacy.proposals.map((entry) => ({ ...entry })),
    agreements: state.diplomacy.agreements.map((entry) => ({ ...entry })),
  } : undefined;
  const trade = state.trade ? {
    routes: state.trade.routes.map((entry) => ({ ...entry, polities: [...entry.polities] as [PolityId, PolityId] })),
    contracts: state.trade.contracts.map((entry) => ({ ...entry })),
  } : undefined;
  const polityById = new Map(polities.map((entry) => [entry.id, entry]));
  const events: DiplomacyEngineEvent[] = [];
  const rejections: CommandRejection[] = [];
  const executions: TradeExecutionRecord[] = [];
  const resourceTransfers: ResourceTransferRecord[] = [];
  const treasuryTransfers: TreasuryTransferRecord[] = [];
  const territorialTransfers: TerritorialSettlementTransfer[] = [];

  const reject = (command: DiplomacyCommand, reason: CommandRejection['reason'], detail: string) => {
    rejections.push({ command, reason, detail });
  };
  const adjustTrust = (left: string, right: string, delta: number) => {
    const relation = diplomacy?.relations.find((entry) => relationKey(...entry.polities) === relationKey(left, right));
    if (!relation) return;
    relation.trust = Math.max(0, Math.min(10000, relation.trust + delta));
    relation.updatedMonth = state.month;
  };
  const knownId = (id: string) => diplomacy?.proposals.some((entry) => entry.proposalId === id)
    || diplomacy?.agreements.some((entry) => entry.sourceProposalId === id || entry.agreementId === agreementIdFor(id));

  for (const command of commands) {
    if (!diplomacy || state.modules?.diplomacy !== true) {
      reject(command, 'module-disabled', 'diplomacy module is not enabled');
      continue;
    }
    const actor = polityById.get(command.actorPolityId);
    if (!actor) { reject(command, 'unknown-actor', `no polity ${command.actorPolityId}`); continue; }
    if (command.effectiveMonth !== state.month) { reject(command, 'wrong-month', `command month ${command.effectiveMonth}, world month ${state.month}`); continue; }
    if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) { reject(command, 'stale-revision', `expected ${command.expectedRevision}, world at ${state.revision}`); continue; }

    if (command.kind === 'diplomacy.propose') {
      if (!polityById.has(command.recipientPolityId)) { reject(command, 'unknown-polity', `no polity ${command.recipientPolityId}`); continue; }
      if (command.recipientPolityId === command.actorPolityId || !participantsMatch(command.terms, command.actorPolityId, command.recipientPolityId)) {
        reject(command, 'invalid-terms', 'proposal terms must name exactly proposer and recipient'); continue;
      }
      if (knownId(command.proposalId)) { reject(command, 'duplicate-id', `proposal id ${command.proposalId} already exists`); continue; }
      diplomacy.proposals.push({
        proposalId: command.proposalId, proposerId: command.actorPolityId,
        recipientId: command.recipientPolityId, terms: command.terms, createdMonth: state.month,
      });
      events.push({ type: 'proposal-created', proposalId: command.proposalId, proposerId: command.actorPolityId, recipientId: command.recipientPolityId });
      continue;
    }

    const proposal = 'proposalId' in command
      ? diplomacy.proposals.find((entry) => entry.proposalId === command.proposalId)
      : undefined;
    if (command.kind === 'diplomacy.counter') {
      if (!proposal) { reject(command, 'unknown-proposal', `no active proposal ${command.proposalId}`); continue; }
      if (proposal.recipientId !== command.actorPolityId) { reject(command, 'unauthorized', 'only the current recipient may counter'); continue; }
      if (knownId(command.counterProposalId)) { reject(command, 'duplicate-id', `proposal id ${command.counterProposalId} already exists`); continue; }
      if (!participantsMatch(command.terms, proposal.proposerId, proposal.recipientId)) { reject(command, 'invalid-terms', 'counter terms must keep the same parties'); continue; }
      diplomacy.proposals = diplomacy.proposals.filter((entry) => entry.proposalId !== proposal.proposalId);
      diplomacy.proposals.push({
        proposalId: command.counterProposalId, proposerId: command.actorPolityId,
        recipientId: proposal.proposerId, terms: command.terms, createdMonth: state.month,
        parentProposalId: proposal.proposalId,
      });
      events.push({ type: 'proposal-countered', proposalId: proposal.proposalId, counterProposalId: command.counterProposalId, proposerId: command.actorPolityId, recipientId: proposal.proposerId });
      continue;
    }
    if (command.kind === 'diplomacy.respond') {
      if (!proposal) { reject(command, 'unknown-proposal', `no active proposal ${command.proposalId}`); continue; }
      if (proposal.recipientId !== command.actorPolityId) { reject(command, 'unauthorized', 'only the current recipient may respond'); continue; }
      if (command.response === 'reject') {
        diplomacy.proposals = diplomacy.proposals.filter((entry) => entry.proposalId !== proposal.proposalId);
        events.push({ type: 'proposal-rejected', proposalId: proposal.proposalId, actorPolityId: command.actorPolityId });
        continue;
      }
      if (proposal.terms.kind === 'territorial-settlement') {
        const { fromPolityId, toPolityId, regionIds } = proposal.terms;
        const selected = regionIds.map((regionId) => regions.find((entry) => entry.regionId === regionId));
        const occupied = new Set((state.military?.occupations ?? []).map((entry) => entry.regionId));
        const receiverProcessing = regions.filter((entry) => entry.controllerId === toPolityId && hasProcessingActivity(entry)).length;
        const incomingProcessing = selected.filter((entry) => entry && hasProcessingActivity(entry)).length;
        if (!polityById.has(fromPolityId) || !polityById.has(toPolityId)
          || selected.some((entry) => !entry || entry.controllerId !== fromPolityId)
          || regionIds.some((regionId) => occupied.has(regionId))
          || receiverProcessing + incomingProcessing > 1) {
          reject(command, 'invalid-terms', 'settlement requires unoccupied regions currently owned by the ceding party and a valid resulting economy');
          continue;
        }
        for (const region of selected as MutableSettlementRegion[]) {
          territorialTransfers.push({ regionId: region.regionId, fromPolityId, toPolityId,
            population: region.population, infrastructureBp: region.infrastructureBp, damageBp: region.damageBp });
          region.controllerId = toPolityId;
        }
        diplomacy.proposals = diplomacy.proposals.filter((entry) => entry.proposalId !== proposal.proposalId);
        events.push({ type: 'territorial-settlement-accepted', proposalId: proposal.proposalId,
          fromPolityId, toPolityId, regionIds: [...regionIds].sort() });
        continue;
      }
      const duplicate = diplomacy.agreements.some((entry) =>
        entry.terms.kind === 'agreement' && proposal.terms.kind === 'agreement'
        && entry.terms.agreementType === proposal.terms.agreementType
        && entry.terms.fromPolityId === proposal.terms.fromPolityId
        && entry.terms.toPolityId === proposal.terms.toPolityId);
      if (duplicate) { reject(command, 'duplicate-agreement', 'the same agreement is already active'); continue; }
      if (proposal.terms.kind === 'trade') {
        if (!trade || state.modules?.trade !== true) { reject(command, 'module-disabled', 'trade module is not enabled'); continue; }
        if (!trade.routes.some((entry) => relationKey(...entry.polities) === relationKey(proposal.proposerId, proposal.recipientId))) {
          reject(command, 'route-unavailable', 'no authored trade route connects the parties'); continue;
        }
      }
      const agreementId = agreementIdFor(proposal.proposalId);
      diplomacy.proposals = diplomacy.proposals.filter((entry) => entry.proposalId !== proposal.proposalId);
      diplomacy.agreements.push({ agreementId, sourceProposalId: proposal.proposalId, acceptedMonth: state.month, terms: proposal.terms });
      if (proposal.terms.kind === 'trade') {
        trade!.contracts.push({
          contractId: agreementId, sourceProposalId: proposal.proposalId, terms: proposal.terms,
          remainingSettlements: proposal.terms.durationMonths, nextSettlementMonth: state.month,
        });
      }
      events.push({ type: 'agreement-created', agreementId, proposalId: proposal.proposalId, parties: pair(proposal.proposerId, proposal.recipientId), agreementKind: proposal.terms.kind === 'trade' ? 'trade' : proposal.terms.agreementType });
      continue;
    }
    if (command.kind === 'diplomacy.terminate-agreement') {
      const agreement = diplomacy.agreements.find((entry) => entry.agreementId === command.agreementId);
      if (!agreement) { reject(command, 'unknown-agreement', `no active agreement ${command.agreementId}`); continue; }
      if (!isParticipant(agreement.terms, command.actorPolityId)) { reject(command, 'unauthorized', 'only a participant may terminate an agreement'); continue; }
      let penaltyPaid = 0;
      if (agreement.terms.kind === 'trade') {
        const otherId = agreement.terms.fromPolityId === command.actorPolityId ? agreement.terms.toPolityId : agreement.terms.fromPolityId;
        const other = polityById.get(otherId)!;
        penaltyPaid = Math.min(actor.treasury, agreement.terms.earlyTerminationPenalty);
        actor.treasury -= penaltyPaid;
        other.treasury += penaltyPaid;
        if (penaltyPaid > 0) treasuryTransfers.push({ sourceId: agreement.agreementId, reason: 'termination-penalty', fromPolityId: actor.id, toPolityId: other.id, amount: penaltyPaid });
        trade!.contracts = trade!.contracts.filter((entry) => entry.contractId !== agreement.agreementId);
        adjustTrust(actor.id, other.id, -250);
      }
      diplomacy.agreements = diplomacy.agreements.filter((entry) => entry.agreementId !== agreement.agreementId);
      events.push({ type: 'agreement-terminated', agreementId: agreement.agreementId, actorPolityId: actor.id, penaltyPaid });
    }
  }

  const routeRemaining = new Map((trade?.routes ?? []).map((entry) => [relationKey(...entry.polities), entry.monthlyCapacity]));
  for (const contract of [...(trade?.contracts ?? [])].sort((left, right) => left.contractId.localeCompare(right.contractId))) {
    if (contract.nextSettlementMonth !== state.month) continue;
    const from = polityById.get(contract.terms.fromPolityId)!;
    const to = polityById.get(contract.terms.toPolityId)!;
    const routeKey = relationKey(from.id, to.id);
    const routeAvailable = routeRemaining.get(routeKey) ?? 0;
    const resourceDemand = (contract.terms.fromLeg.kind === 'resource' ? contract.terms.fromLeg.amount : 0)
      + (contract.terms.toLeg.kind === 'resource' ? contract.terms.toLeg.amount : 0);
    const routeBp = resourceDemand === 0 ? 10000 : Math.min(10000, Math.floor((routeAvailable * 10000) / resourceDemand));
    const fulfillmentBp = Math.min(routeBp, legAvailabilityBp(from, contract.terms.fromLeg), legAvailabilityBp(to, contract.terms.toLeg));
    const fromAmount = Math.floor((contract.terms.fromLeg.amount * fulfillmentBp) / 10000);
    const toAmount = Math.floor((contract.terms.toLeg.amount * fulfillmentBp) / 10000);
    const routeCapacityUsed = (contract.terms.fromLeg.kind === 'resource' ? fromAmount : 0)
      + (contract.terms.toLeg.kind === 'resource' ? toAmount : 0);
    routeRemaining.set(routeKey, routeAvailable - routeCapacityUsed);
    const transferLeg = (sender: MutableTradePolity, receiver: MutableTradePolity, leg: typeof contract.terms.fromLeg, amount: number) => {
      if (leg.kind === 'treasury') {
        sender.treasury -= amount; receiver.treasury += amount;
        if (amount > 0) treasuryTransfers.push({ sourceId: contract.contractId, reason: 'trade', fromPolityId: sender.id, toPolityId: receiver.id, amount });
      } else {
        sender.stock.set(leg.resource, (sender.stock.get(leg.resource) ?? 0) - amount);
        receiver.stock.set(leg.resource, (receiver.stock.get(leg.resource) ?? 0) + amount);
        if (amount > 0) resourceTransfers.push({ contractId: contract.contractId, fromPolityId: sender.id, toPolityId: receiver.id, resource: leg.resource, amount });
      }
    };
    const fromReference = referenceValue(state, from, contract.terms.fromLeg);
    const toReference = referenceValue(state, to, contract.terms.toLeg);
    transferLeg(from, to, contract.terms.fromLeg, fromAmount);
    transferLeg(to, from, contract.terms.toLeg, toAmount);
    const breach = fulfillmentBp < 10000;
    if (breach) adjustTrust(from.id, to.id, -500);
    executions.push({
      contractId: contract.contractId, fromPolityId: from.id, toPolityId: to.id,
      fulfillmentBp, routeCapacityUsed,
      fromDelivered: { kind: contract.terms.fromLeg.kind, ...(contract.terms.fromLeg.kind === 'resource' ? { resource: contract.terms.fromLeg.resource } : {}), amount: fromAmount, referenceValue: fromReference },
      toDelivered: { kind: contract.terms.toLeg.kind, ...(contract.terms.toLeg.kind === 'resource' ? { resource: contract.terms.toLeg.resource } : {}), amount: toAmount, referenceValue: toReference },
      breach,
    });
    events.push({ type: 'trade-settled', contractId: contract.contractId, fulfillmentBp, breach });
    contract.remainingSettlements -= 1;
    contract.nextSettlementMonth = addMonth(contract.nextSettlementMonth);
  }
  if (trade) trade.contracts = trade.contracts.filter((entry) => entry.remainingSettlements > 0);
  if (diplomacy) {
    diplomacy.proposals.sort((left, right) => left.proposalId.localeCompare(right.proposalId));
    diplomacy.agreements.sort((left, right) => left.agreementId.localeCompare(right.agreementId));
  }
  if (trade) trade.contracts.sort((left, right) => left.contractId.localeCompare(right.contractId));
  return { diplomacy, trade, events, rejections, executions, resourceTransfers, treasuryTransfers, territorialTransfers };
}
