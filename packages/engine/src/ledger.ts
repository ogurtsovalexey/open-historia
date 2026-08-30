/**
 * Contribution ledger: the deterministic "why changed" record for one month,
 * plus the invariant checker for the automated gates in first-economy-mvp §10.
 */
import type { PolityId, RegionId } from '@open-historia/domain';
import type { ResourceId } from './scenario.js';
import type { EconWorldState } from './state.js';
import { getStock } from './state.js';

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
  stockMovements: StockMovement[];
}

export interface TurnLedger {
  month: string;
  turn: number;
  polities: PolityLedger[];
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
      const expected = movement.opening + movement.produced - movement.processingUse - movement.populationUse;
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
    const expectedTreasury = polityLedger.treasuryOpening + polityLedger.taxTotal - spend;
    if (expectedTreasury !== polityLedger.treasuryClosing) {
      fail('treasury-identity', `${id}: ${polityLedger.treasuryOpening}+${polityLedger.taxTotal}-${spend} != ${polityLedger.treasuryClosing}`);
    }
    if (nextPolity.treasury !== polityLedger.treasuryClosing) {
      fail('treasury-state-match', `${id}: ledger ${polityLedger.treasuryClosing} != state ${nextPolity.treasury}`);
    }
    if (nextPolity.treasury < 0) fail('no-negative-treasury', `${id}: ${nextPolity.treasury}`);
    checked.push('treasury-identity');
  }

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
