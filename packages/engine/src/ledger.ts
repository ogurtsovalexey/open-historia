/**
 * Contribution ledger: the deterministic "why changed" record for one month,
 * plus the invariant checker for the automated gates in first-economy-mvp §10.
 */
import type { PolityId, RegionId } from '@open-historia/domain';
import type { ResourceId } from './scenario.js';
import type { EconWorldState } from './state.js';
import { getStock } from './state.js';
import type { ResourceTransferRecord, TradeExecutionRecord, TreasuryTransferRecord } from './diplomacyReducer.js';
import type { FinanceResolutionRecord, ProjectAllocationRecord } from './statecraftReducer.js';

export interface RegionPopulationRow {
  regionId: RegionId;
  births: number;
  deaths: number;
  population: number;
}

export interface RegionProductionRow {
  regionId: RegionId;
  amount: number;
}

export interface ResourceProduction {
  resource: ResourceId;
  total: number;
  byRegion: RegionProductionRow[];
}

export interface TaxRow {
  regionId: RegionId;
  resource: ResourceId;
  amount: number;
}

export interface StockMovement {
  resource: ResourceId;
  opening: number;
  produced: number;
  /** Processing inputs actually used this month. */
  processingUse: number;
  /** Population consumption actually used this month. */
  populationUse: number;
  tradeIn?: number;
  tradeOut?: number;
  closing: number;
}

export interface GoodsResolution {
  regionId: RegionId;
  potential: number;
  actual: number;
  coalUsed: number;
  ironUsed: number;
  inputSupplyBp: number;
  /** Inputs tied for the minimum when inputs limit output; empty otherwise. */
  limitingInputs: ResourceId[];
  /** What bounded actual output: material inputs or the capacity-side formula. */
  limitedBy: 'inputs' | 'capacity';
}

export interface InvestmentRecord {
  regionId: RegionId;
  spend: number;
  infrastructureGainBp: number;
  infrastructureBp: number;
}

export interface FoodRecord {
  need: number;
  available: number;
  consumed: number;
  surplus: number;
  shortfall: number;
}

export interface PolityLedger {
  polityId: PolityId;
  populationOpening: number;
  populationClosing: number;
  populationByRegion: RegionPopulationRow[];
  production: ResourceProduction[];
  taxTotal: number;
  taxByRegion: TaxRow[];
  investment?: InvestmentRecord;
  goods?: GoodsResolution;
  food: FoodRecord;
  treasuryOpening: number;
  treasuryClosing: number;
  treasuryTradeNet?: number;
  finance?: FinanceResolutionRecord;
  projectSpend?: number;
  stockMovements: StockMovement[];
}

/**
 * One accepted region transfer. Population is the value at transfer time, i.e.
 * before this month's demography, which is the amount that moves between the
 * national totals (first-economy-mvp.md §10).
 */
export interface TransferRecord {
  regionId: RegionId;
  fromPolityId: PolityId;
  toPolityId: PolityId;
  population: number;
  infrastructureBp: number;
  damageBp: number;
}

export interface TurnLedger {
  month: string;
  turn: number;
  polities: PolityLedger[];
  transfers: TransferRecord[];
  trade?: {
    executions: TradeExecutionRecord[];
    resourceTransfers: ResourceTransferRecord[];
    treasuryTransfers: TreasuryTransferRecord[];
  };
  statecraft?: {
    finance: FinanceResolutionRecord[];
    projectAllocations: ProjectAllocationRecord[];
  };
}

/**
 * Verify the §10 identities between two consecutive states and the ledger.
 * Throws on the first violated identity; returns the list of checked names.
 */
export function checkInvariants(
  prev: EconWorldState,
  next: EconWorldState,
  ledger: TurnLedger
): string[] {
  const checked: string[] = [];
  const fail = (name: string, detail: string): never => {
    throw new Error(`invariant violated [${name}]: ${detail}`);
  };

  for (const polityLedger of ledger.polities) {
    const id = polityLedger.polityId;
    const prevPolity = prev.polities.find((p) => p.id === id);
    const nextPolity = next.polities.find((p) => p.id === id);
    if (!prevPolity || !nextPolity) return fail('polity-exists', `polity ${id} missing`);

    // Region population sums equal polity totals after every month.
    const nextRegions = next.regions.filter((r) => r.controllerId === id);
    const regionPopSum = nextRegions.reduce((sum, r) => sum + r.population, 0);
    if (regionPopSum !== polityLedger.populationClosing) {
      fail('population-aggregation', `${id}: regions sum ${regionPopSum} != ledger ${polityLedger.populationClosing}`);
    }
    checked.push('population-aggregation');

    // population' = population + births - deaths per region.
    for (const row of polityLedger.populationByRegion) {
      const prevRegion = prev.regions.find((r) => r.regionId === row.regionId);
      if (!prevRegion) return fail('region-exists', `region ${row.regionId} missing in prev state`);
      const expected = prevRegion.population + row.births - row.deaths;
      if (expected !== row.population) {
        fail('population-identity', `${row.regionId}: ${prevRegion.population} + ${row.births} - ${row.deaths} != ${row.population}`);
      }
      if (row.population < 0) fail('no-negative-population', `${row.regionId}: ${row.population}`);
    }
    checked.push('population-identity');

    // Region production sums equal polity production per resource.
    for (const production of polityLedger.production) {
      const regionSum = production.byRegion.reduce((sum, row) => sum + row.amount, 0);
      if (regionSum !== production.total) {
        fail('production-aggregation', `${id}/${production.resource}: ${regionSum} != ${production.total}`);
      }
    }
    checked.push('production-aggregation');

    // inventory' = inventory + production - consumption, exactly, no negatives.
    for (const movement of polityLedger.stockMovements) {
      const expected = movement.opening + (movement.tradeIn ?? 0) - (movement.tradeOut ?? 0)
        + movement.produced - movement.processingUse - movement.populationUse;
      if (expected !== movement.closing) {
        fail('inventory-identity', `${id}/${movement.resource}: ${movement.opening}+${movement.produced}-${movement.processingUse}-${movement.populationUse} != ${movement.closing}`);
      }
      if (movement.closing < 0) fail('no-negative-inventory', `${id}/${movement.resource}: ${movement.closing}`);
      const actualClosing = getStock(nextPolity, movement.resource);
      if (actualClosing !== movement.closing) {
        fail('inventory-state-match', `${id}/${movement.resource}: ledger ${movement.closing} != state ${actualClosing}`);
      }
    }
    checked.push('inventory-identity');

    // Coal and Iron stock movements exactly reconcile with actual Goods output.
    if (polityLedger.goods) {
      const goods = polityLedger.goods;
      if (goods.coalUsed !== goods.actual || goods.ironUsed !== goods.actual) {
        fail('goods-input-reconciliation', `${id}: goods ${goods.actual}, coal used ${goods.coalUsed}, iron used ${goods.ironUsed}`);
      }
      const coalMovement = polityLedger.stockMovements.find((m) => m.resource === 'coal');
      const ironMovement = polityLedger.stockMovements.find((m) => m.resource === 'iron');
      if ((coalMovement?.processingUse ?? 0) !== goods.coalUsed) {
        fail('goods-input-reconciliation', `${id}: coal movement ${coalMovement?.processingUse} != used ${goods.coalUsed}`);
      }
      if ((ironMovement?.processingUse ?? 0) !== goods.ironUsed) {
        fail('goods-input-reconciliation', `${id}: iron movement ${ironMovement?.processingUse} != used ${goods.ironUsed}`);
      }
      checked.push('goods-input-reconciliation');
    }

    // treasury' = treasury + tax revenue - accepted spending.
    const spend = polityLedger.investment?.spend ?? 0;
    const expectedTreasury = polityLedger.treasuryOpening + (polityLedger.treasuryTradeNet ?? 0)
      + (polityLedger.finance?.bondsIssued ?? 0) + polityLedger.taxTotal - spend
      - (polityLedger.projectSpend ?? 0) - (polityLedger.finance?.interestPaid ?? 0);
    if (expectedTreasury !== polityLedger.treasuryClosing) {
      fail('treasury-identity', `${id}: ${polityLedger.treasuryOpening}+${polityLedger.taxTotal}-${spend} != ${polityLedger.treasuryClosing}`);
    }
    if (nextPolity.treasury !== polityLedger.treasuryClosing) {
      fail('treasury-state-match', `${id}: ledger ${polityLedger.treasuryClosing} != state ${nextPolity.treasury}`);
    }
    if (nextPolity.treasury < 0) fail('no-negative-treasury', `${id}: ${nextPolity.treasury}`);
    checked.push('treasury-identity');
  }

  if (ledger.statecraft) {
    for (const record of ledger.statecraft.finance) {
      const expectedDebt = record.debtOpening + record.bondsIssued - record.voluntaryHaircut - record.automaticHaircut;
      if (expectedDebt !== record.debtClosing) fail('debt-identity', `${record.polityId}: expected debt ${expectedDebt}, closed ${record.debtClosing}`);
      if (record.interestPaid > record.interestAccrued) fail('debt-identity', `${record.polityId}: paid more interest than accrued`);
    }
    const capacityUsed = new Map<string, number>();
    for (const allocation of ledger.statecraft.projectAllocations) {
      if (allocation.spent < 0 || allocation.spent > allocation.requested) fail('project-budget-conservation', `${allocation.projectId}: invalid spend`);
      const key = `${allocation.polityId}|${allocation.capacityKind}`;
      capacityUsed.set(key, (capacityUsed.get(key) ?? 0) + allocation.capacityUsed);
    }
    for (const capacity of prev.projects?.capacities ?? next.projects?.capacities ?? []) {
      for (const kind of ['administration', 'science', 'industry'] as const) {
        const used = capacityUsed.get(`${capacity.polityId}|${kind}`) ?? 0;
        if (used > capacity[kind]) fail('project-capacity-conservation', `${capacity.polityId}/${kind}: used ${used} > ${capacity[kind]}`);
      }
    }
    checked.push('debt-identity', 'project-budget-conservation', 'project-capacity-conservation');
  }

  if (ledger.trade) {
    const resourceIn = new Map<string, number>();
    const resourceOut = new Map<string, number>();
    const treasuryNet = new Map<string, number>();
    for (const transfer of ledger.trade.resourceTransfers) {
      const outKey = `${transfer.fromPolityId}|${transfer.resource}`;
      const inKey = `${transfer.toPolityId}|${transfer.resource}`;
      resourceOut.set(outKey, (resourceOut.get(outKey) ?? 0) + transfer.amount);
      resourceIn.set(inKey, (resourceIn.get(inKey) ?? 0) + transfer.amount);
    }
    for (const polity of ledger.polities) {
      for (const movement of polity.stockMovements) {
        const key = `${polity.polityId}|${movement.resource}`;
        if ((movement.tradeIn ?? 0) !== (resourceIn.get(key) ?? 0)
          || (movement.tradeOut ?? 0) !== (resourceOut.get(key) ?? 0)) {
          fail('trade-resource-conservation', `${key}: ledger trade movements do not match bilateral transfers`);
        }
      }
    }
    for (const transfer of ledger.trade.treasuryTransfers) {
      treasuryNet.set(transfer.fromPolityId, (treasuryNet.get(transfer.fromPolityId) ?? 0) - transfer.amount);
      treasuryNet.set(transfer.toPolityId, (treasuryNet.get(transfer.toPolityId) ?? 0) + transfer.amount);
    }
    for (const polity of ledger.polities) {
      if ((polity.treasuryTradeNet ?? 0) !== (treasuryNet.get(polity.polityId) ?? 0)) {
        fail('trade-treasury-conservation', `${polity.polityId}: ledger treasury net does not match bilateral transfers`);
      }
    }
    const totalResourceNet = [...resourceIn.values()].reduce((sum, value) => sum + value, 0)
      - [...resourceOut.values()].reduce((sum, value) => sum + value, 0);
    if (totalResourceNet !== 0) fail('trade-resource-conservation', `resource net is ${totalResourceNet}`);
    const totalTreasuryNet = [...treasuryNet.values()].reduce((sum, value) => sum + value, 0);
    if (totalTreasuryNet !== 0) fail('trade-treasury-conservation', `treasury net is ${totalTreasuryNet}`);
    checked.push('trade-resource-conservation', 'trade-treasury-conservation');
  }

  // Transfers move the region and its attached values, nothing else (§7).
  for (const transfer of ledger.transfers) {
    const before = prev.regions.find((r) => r.regionId === transfer.regionId);
    const after = next.regions.find((r) => r.regionId === transfer.regionId);
    if (!before || !after) return fail('transfer-region-exists', `${transfer.regionId} missing`);
    if (before.controllerId !== transfer.fromPolityId) {
      fail('transfer-source', `${transfer.regionId} was controlled by ${before.controllerId}, not ${transfer.fromPolityId}`);
    }
    if (after.controllerId !== transfer.toPolityId) {
      fail('transfer-applied', `${transfer.regionId} ended under ${after.controllerId}, expected ${transfer.toPolityId}`);
    }
    if (before.population !== transfer.population) {
      fail('transfer-population', `${transfer.regionId}: recorded ${transfer.population}, state had ${before.population}`);
    }
    // Infrastructure and damage stay attached to the region.
    if (after.infrastructureBp !== transfer.infrastructureBp || after.damageBp !== transfer.damageBp) {
      fail('transfer-attached-values', `${transfer.regionId}: infrastructure/damage changed during transfer`);
    }
    if (transfer.fromPolityId === transfer.toPolityId) {
      fail('transfer-distinct-controllers', `${transfer.regionId}: from equals to`);
    }
  }
  if (ledger.transfers.length > 0) checked.push('transfer-conservation');

  // A region belongs to exactly one controller and contributes exactly once.
  const seenRegions = new Set<string>();
  for (const region of next.regions) {
    if (seenRegions.has(region.regionId)) fail('region-single-controller', `${region.regionId} appears twice`);
    seenRegions.add(region.regionId);
  }
  checked.push('region-single-controller');

  if (next.turn !== prev.turn + 1) fail('turn-increment', `${prev.turn} -> ${next.turn}`);
  checked.push('turn-increment');

  return [...new Set(checked)];
}
