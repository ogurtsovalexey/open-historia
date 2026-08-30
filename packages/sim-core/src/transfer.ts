import {
  EconomyMvpRegion,
  PolityStocks,
  RegionTransferResult,
  RegionalEconomicContribution,
  QuantityMicros,
  PersonCount,
  Commodity,
  PolityId,
  economyMvpRegionSchema,
  polityStocksSchema,
  regionTransferResultSchema
} from './types.js';
import { calculateRegionGrossOutput } from './investment.js';
import { addExact, multiplyDivideFloor, subtractExact } from './arithmetic.js';

/**
 * Re-aggregate region transfer as defined in spec
 * Preserves treasury/inventories, moves each region contribution exactly once
 */
export function processRegionTransfer(
  regions: EconomyMvpRegion[],
  polityStocks: PolityStocks[],
  regionId: string,
  fromPolityId: string,
  toPolityId: string
): RegionTransferResult {
  economyMvpRegionSchema.array().parse(regions);
  polityStocksSchema.array().parse(polityStocks);
  // Validate inputs
  const validation = validateTransfer(regions, polityStocks, regionId, fromPolityId, toPolityId);
  if (!validation.valid) {
    throw new Error(`Invalid transfer: ${validation.errors.join(', ')}`);
  }

  // Create working copies
  // Deep copy to avoid mutation - handle BigInt by manual copying
  const updatedRegions: EconomyMvpRegion[] = regions.map(region => ({
    ...region,
    birthRemainder: region.birthRemainder,
    deathRemainder: region.deathRemainder
  }));
  const updatedPolityStocks: PolityStocks[] = polityStocks.map(stocks => ({
    polityId: stocks.polityId,
    treasuryMicros: stocks.treasuryMicros,
    inventory: { ...stocks.inventory },
    acceptedInvestment: stocks.acceptedInvestment ? {
      targetRegionId: stocks.acceptedInvestment.targetRegionId,
      spendMicros: stocks.acceptedInvestment.spendMicros,
      effectiveMonth: stocks.acceptedInvestment.effectiveMonth
    } : null
  }));

  // Find the region to transfer
  const regionIndex = updatedRegions.findIndex(r => r.regionId === regionId);
  if (regionIndex === -1) {
    throw new Error(`Region ${regionId} not found`);
  }

  // Update controller
  const regionToUpdate = updatedRegions[regionIndex];
  if (!regionToUpdate) {
    throw new Error(`Region ${regionId} not found after validation`);
  }

  const updatedRegion: EconomyMvpRegion = {
    regionId: regionToUpdate.regionId,
    controllerId: toPolityId as PolityId,
    population: regionToUpdate.population,
    annualBirthRateBp: regionToUpdate.annualBirthRateBp,
    annualDeathRateBp: regionToUpdate.annualDeathRateBp,
    birthRemainder: regionToUpdate.birthRemainder,
    deathRemainder: regionToUpdate.deathRemainder,
    workforceRateBp: regionToUpdate.workforceRateBp,
    infrastructureBp: regionToUpdate.infrastructureBp,
    primaryCommodity: regionToUpdate.primaryCommodity,
    baseMonthlyCapacity: regionToUpdate.baseMonthlyCapacity,
    outputPerWorker: regionToUpdate.outputPerWorker,
    damageBp: regionToUpdate.damageBp
  };
  updatedRegions[regionIndex] = updatedRegion;

  // Calculate losses for fromPolity and gains for toPolity
  const fromPolityLosses = calculateRegionContributions(regionToUpdate, fromPolityId);
  const toPolityGains = calculateRegionContributions(updatedRegion, toPolityId);

  // Note: Treasury and inventories remain with their original polities
  // Only regional contributions are transferred

  return regionTransferResultSchema.parse({
    updatedRegions,
    updatedPolityStocks,
    fromPolityLosses,
    toPolityGains
  });
}

/**
 * Validate region transfer parameters
 */
function validateTransfer(
  regions: EconomyMvpRegion[],
  polityStocks: PolityStocks[],
  regionId: string,
  fromPolityId: string,
  toPolityId: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (new Set(regions.map(region => region.regionId)).size !== regions.length) {
    errors.push('Duplicate region IDs are not allowed');
  }
  if (new Set(polityStocks.map(stocks => stocks.polityId)).size !== polityStocks.length) {
    errors.push('Duplicate polity stock IDs are not allowed');
  }

  // Check region exists
  const region = regions.find(r => r.regionId === regionId);
  if (!region) {
    errors.push(`Region ${regionId} not found`);
    return { valid: false, errors };
  }

  // Check fromPolity exists
  const fromPolity = polityStocks.find(p => p.polityId === fromPolityId);
  if (!fromPolity) {
    errors.push(`From polity ${fromPolityId} not found`);
  }

  // Check toPolity exists
  const toPolity = polityStocks.find(p => p.polityId === toPolityId);
  if (!toPolity) {
    errors.push(`To polity ${toPolityId} not found`);
  }

  // Check region is controlled by fromPolity
  if (region.controllerId !== fromPolityId) {
    errors.push(`Region ${regionId} is not controlled by ${fromPolityId}`);
  }

  // Check fromPolity and toPolity are different
  if (fromPolityId === toPolityId) {
    errors.push(`Cannot transfer region to same polity`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate regional contributions for a polity
 */
function calculateRegionContributions(
  region: EconomyMvpRegion,
  polityId: string
): RegionalEconomicContribution {
  const grossOutput = calculateRegionGrossOutput(region);

  const productionContribution: Record<Commodity, QuantityMicros> = {
    food: 0 as QuantityMicros,
    energy: 0 as QuantityMicros,
    materials: 0 as QuantityMicros,
    manufactures: 0 as QuantityMicros
  };
  productionContribution[region.primaryCommodity] = grossOutput;

  // Calculate workforce
  const workforce = multiplyDivideFloor([region.population, region.workforceRateBp], 10000, `workforce.${region.regionId}`);

  return {
    polityId: polityId as PolityId,
    populationContribution: region.population,
    workforceContribution: workforce as PersonCount,
    productionContribution
  };
}

/**
 * Verify accounting identities after transfer
 */
export function verifyTransferAccounting(
  originalRegions: EconomyMvpRegion[],
  transferResult: RegionTransferResult,
  fromPolityId: string,
  toPolityId: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Calculate original totals
  const originalFromTotal = calculatePolityContributions(originalRegions, fromPolityId);
  const originalToTotal = calculatePolityContributions(originalRegions, toPolityId);

  // Calculate new totals
  const newFromTotal = calculatePolityContributions(transferResult.updatedRegions, fromPolityId);
  const newToTotal = calculatePolityContributions(transferResult.updatedRegions, toPolityId);

  // Verify losses match gains
  const expectedFromLosses = transferResult.fromPolityLosses;
  const expectedToGains = transferResult.toPolityGains;

  // Check population
  if (subtractExact(originalFromTotal.populationContribution, newFromTotal.populationContribution, 'transfer.fromPopulation') !==
      expectedFromLosses.populationContribution) {
    errors.push(`Population loss mismatch for ${fromPolityId}`);
  }

  if (subtractExact(newToTotal.populationContribution, originalToTotal.populationContribution, 'transfer.toPopulation') !==
      expectedToGains.populationContribution) {
    errors.push(`Population gain mismatch for ${toPolityId}`);
  }

  if (subtractExact(originalFromTotal.workforceContribution, newFromTotal.workforceContribution, 'transfer.fromWorkforce') !==
      expectedFromLosses.workforceContribution) {
    errors.push(`Workforce loss mismatch for ${fromPolityId}`);
  }

  if (subtractExact(newToTotal.workforceContribution, originalToTotal.workforceContribution, 'transfer.toWorkforce') !==
      expectedToGains.workforceContribution) {
    errors.push(`Workforce gain mismatch for ${toPolityId}`);
  }

  // Check each commodity production
  const commodities: Commodity[] = ['food', 'energy', 'materials', 'manufactures'];
  for (const commodity of commodities) {
    const fromLoss = subtractExact(
      originalFromTotal.productionContribution[commodity],
      newFromTotal.productionContribution[commodity],
      `transfer.from.${commodity}`
    );
    const toGain = subtractExact(
      newToTotal.productionContribution[commodity],
      originalToTotal.productionContribution[commodity],
      `transfer.to.${commodity}`
    );

    if (fromLoss !== expectedFromLosses.productionContribution[commodity]) {
      errors.push(`${commodity} production loss mismatch for ${fromPolityId}`);
    }

    if (toGain !== expectedToGains.productionContribution[commodity]) {
      errors.push(`${commodity} production gain mismatch for ${toPolityId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate total contributions for a polity
 */
function calculatePolityContributions(
  regions: EconomyMvpRegion[],
  polityId: string
): Omit<RegionalEconomicContribution, 'polityId'> {
  let populationContribution = 0;
  let workforceContribution = 0;
  const productionContribution: Record<Commodity, QuantityMicros> = {
    food: 0 as QuantityMicros,
    energy: 0 as QuantityMicros,
    materials: 0 as QuantityMicros,
    manufactures: 0 as QuantityMicros
  };

  for (const region of regions) {
    if (region.controllerId === polityId) {
      populationContribution = addExact(populationContribution, region.population, `population.${polityId}`);
      workforceContribution = addExact(
        workforceContribution,
        multiplyDivideFloor([region.population, region.workforceRateBp], 10000, `workforce.${region.regionId}`),
        `workforce.${polityId}`
      );

      const output = calculateRegionGrossOutput(region);
      productionContribution[region.primaryCommodity] = addExact(
        productionContribution[region.primaryCommodity],
        output,
        `production.${polityId}.${region.primaryCommodity}`
      ) as QuantityMicros;
    }
  }

  return {
    populationContribution: populationContribution as PersonCount,
    workforceContribution: workforceContribution as PersonCount,
    productionContribution
  };
}
