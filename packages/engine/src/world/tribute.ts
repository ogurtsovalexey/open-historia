import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  evidenceRecordSchema,
  tributeObligationIdSchema,
  worldEventSchema,
  worldRevisionHashSchema,
  type EvidenceId,
  type WorldStateV2,
  type WorldStateV2Input,
} from './schema.js';
import { assertExpectedWorldRevision, nextRevisionLineage, stampWorldStateRevision } from './revision.js';

export const tributeDeliveryCommandSchema = z.object({
  obligationId: tributeObligationIdSchema,
  expectedRevision: worldRevisionHashSchema,
}).strict();

export interface TributeDeliveryRow {
  commodityId: string;
  due: number;
  delivered: number;
  arrearsAdded: number;
  payerDebits: Array<{ polityId: string; quantity: number }>;
  beneficiaryCredits: Array<{ polityId: string; quantity: number }>;
}

export interface TributeDeliveryResult {
  state: WorldStateV2;
  obligationId: string;
  rows: TributeDeliveryRow[];
  laborReserved: number;
  militaryPersonnelReserved: number;
  controlChanged: false;
  eventId: string;
  evidenceId: string;
}

const hashId = (prefix: 'event' | 'evidence', values: readonly string[]) => `${prefix}:tribute-${createHash('sha256').update(values.join('\u001f')).digest('hex').slice(0, 32)}`;

function addSafe(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds the safe integer range`);
  return result;
}

function applyBp(value: number, bp: number): number {
  return Number(BigInt(value) * BigInt(bp) / 10000n);
}

function allocateShares(total: number, beneficiaries: Array<{ polityId: string; shareBp: number }>) {
  const rows = beneficiaries.map((entry) => {
    const numerator = BigInt(total) * BigInt(entry.shareBp);
    return { polityId: entry.polityId, quantity: Number(numerator / 10000n), remainder: numerator % 10000n };
  });
  let remainder = total - rows.reduce((sum, entry) => sum + entry.quantity, 0);
  for (const row of [...rows].sort((a, b) => (
    a.remainder === b.remainder ? a.polityId.localeCompare(b.polityId) : a.remainder > b.remainder ? -1 : 1
  ))) {
    if (remainder === 0) break;
    row.quantity += 1;
    remainder -= 1;
  }
  return rows.map((entry) => ({ polityId: entry.polityId, quantity: entry.quantity }));
}

/** Deliver one due tribute basket with exact debit/credit conservation. */
export function applyTributeDelivery(state: WorldStateV2, input: unknown): TributeDeliveryResult {
  const command = tributeDeliveryCommandSchema.parse(input);
  assertExpectedWorldRevision(state, command.expectedRevision);
  const obligation = state.tributeObligations.find((entry) => entry.obligationId === command.obligationId);
  if (!obligation) throw new Error(`Unknown tribute obligation ${command.obligationId}`);
  const polities = structuredClone(state.polities);
  const polityById = new Map(polities.map((entry) => [entry.id as string, entry]));
  const rows: TributeDeliveryRow[] = [];
  const arrears = new Map(obligation.arrears.map((entry) => [entry.commodityId, entry.quantity]));

  for (const delivery of obligation.deliveries) {
    const scheduled = applyBp(delivery.quantity, obligation.complianceBp);
    const payerDebits: TributeDeliveryRow['payerDebits'] = [];
    let remaining = scheduled;
    for (const polityId of [...obligation.payerPolityIds].sort()) {
      const polity = polityById.get(polityId)!;
      const stock = polity.stockpiles.find((entry) => entry.commodityId === delivery.commodityId);
      const debit = Math.min(stock?.quantity ?? 0, remaining);
      if (stock && debit > 0) stock.quantity -= debit;
      if (debit > 0) payerDebits.push({ polityId, quantity: debit });
      remaining -= debit;
    }
    const delivered = scheduled - remaining;
    const beneficiaryCredits = allocateShares(delivered, obligation.beneficiaries);
    for (const credit of beneficiaryCredits) {
      const polity = polityById.get(credit.polityId)!;
      const stock = polity.stockpiles.find((entry) => entry.commodityId === delivery.commodityId);
      if (stock) stock.quantity = addSafe(stock.quantity, credit.quantity, `tribute stock ${delivery.commodityId}`);
      else polity.stockpiles.push({ commodityId: delivery.commodityId, quantity: credit.quantity });
    }
    const arrearsAdded = delivery.quantity - delivered;
    arrears.set(delivery.commodityId, addSafe(arrears.get(delivery.commodityId) ?? 0, arrearsAdded, `tribute arrears ${delivery.commodityId}`));
    rows.push({ commodityId: delivery.commodityId, due: delivery.quantity, delivered, arrearsAdded, payerDebits, beneficiaryCredits });
  }

  const updatedObligation = {
    ...obligation,
    arrears: [...arrears].map(([commodityId, quantity]) => ({ commodityId, quantity })),
  };
  const eventId = hashId('event', [state.revision, obligation.obligationId, state.month]);
  const evidenceId = hashId('evidence', [eventId]);
  const entityRefs = [...new Set([
    obligation.obligationId,
    ...obligation.payerPolityIds,
    ...obligation.beneficiaries.map((entry) => entry.polityId),
    ...obligation.sourceRegionIds,
    ...obligation.routeIds,
  ])].sort();
  const event = worldEventSchema.parse({
    eventId, revision: state.revision, kind: 'tribute-delivered', entityRefs,
    evidenceIds: [evidenceId, ...obligation.evidenceIds],
  });
  const obligationIndex = [...state.tributeObligations].sort((a, b) => a.obligationId.localeCompare(b.obligationId))
    .findIndex((entry) => entry.obligationId === obligation.obligationId);
  const evidence = evidenceRecordSchema.parse({
    evidenceId, revision: state.revision, kind: 'tribute-delivery', entityRefs, eventRefs: [eventId],
    canonicalPointers: [
      `/tributeObligations/${obligationIndex}/arrears`,
      ...[...new Set([...obligation.payerPolityIds, ...obligation.beneficiaries.map((entry) => entry.polityId)])]
        .map((polityId) => `/polities/${[...state.polities].sort((a, b) => a.id.localeCompare(b.id)).findIndex((entry) => entry.id === polityId)}/stockpiles`),
    ],
    visibility: 'public',
  });
  const { revision: _revision, ...content } = state;
  void _revision;
  const nextInput: WorldStateV2Input = {
    ...content,
    revisionLineage: nextRevisionLineage(state),
    polities,
    tributeObligations: state.tributeObligations.map((entry) => entry.obligationId === obligation.obligationId ? updatedObligation : entry),
    events: [...state.events, event],
    evidence: [...state.evidence, evidence],
  };
  const next = stampWorldStateRevision(nextInput);
  return {
    state: next,
    obligationId: obligation.obligationId,
    rows,
    laborReserved: applyBp(obligation.laborService?.people ?? 0, obligation.complianceBp),
    militaryPersonnelReserved: applyBp(obligation.militaryService?.personnel ?? 0, obligation.complianceBp),
    controlChanged: false,
    eventId,
    evidenceId,
  };
}

export function tributeServiceReservedInRegion(
  state: WorldStateV2,
  regionId: string,
): { labor: number; military: number; evidenceIds: EvidenceId[] } {
  let labor = 0;
  let military = 0;
  const evidenceIds: EvidenceId[] = [];
  for (const obligation of state.tributeObligations) {
    const regions = [...obligation.sourceRegionIds].sort();
    const index = regions.findIndex((entry) => entry === regionId);
    if (index < 0) continue;
    const allocate = (total: number) => Math.trunc(total / regions.length) + (index < total % regions.length ? 1 : 0);
    labor = addSafe(labor, allocate(applyBp(obligation.laborService?.people ?? 0, obligation.complianceBp)), 'tribute labor reservation');
    military = addSafe(military, allocate(applyBp(obligation.militaryService?.personnel ?? 0, obligation.complianceBp)), 'tribute military reservation');
    evidenceIds.push(...obligation.evidenceIds);
  }
  return { labor, military, evidenceIds: [...new Set(evidenceIds)].sort() };
}
