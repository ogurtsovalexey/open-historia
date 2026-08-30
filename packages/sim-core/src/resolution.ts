import {
  EconomyMvpRegion,
  PolityStocks,
  EconomyScenarioConstants,
  MonthlyResolutionResult,
  RegionalDelta,
  NationalContributionLedger,
  QuantityMicros,
  PersonCount,
  BasisPoints,
  Commodity
} from './types.js';
import { calculateRegionGrossOutput } from './investment.js';

/**
 * Monthly resolution algorithm as defined in spec
 * Follows fixed order and uses integer arithmetic
 */
export function resolveMonth(
  regions: EconomyMvpRegion[],
  polityStocksArray: PolityStocks[],
  constants: EconomyScenarioConstants
): MonthlyResolutionResult {
  // Step 1: Validate controller references and accepted policy commands
  const validated = validateControllersAndCommands(regions, polityStocksArray);
  if (!validated.valid) {
    throw new Error(`Validation failed: ${validated.errors.join(', ')}`);
  }

  // Create working copies
  const nextRegions: EconomyMvpRegion[] = JSON.parse(JSON.stringify(regions));
  const nextPolityStocks: PolityStocks[] = JSON.parse(JSON.stringify(polityStocksArray));
  const regionalDeltas: RegionalDelta[] = [];
  const nationalLedgers: NationalContributionLedger[] = [];
  const foodSurplusOrShortfall: Record<string, QuantityMicros> = {};
  const alerts: Array<{ polityId: string; message: string; severity: 'info' | 'warning' | 'error' }> = [];

  // Step 2: Process investments
  processInvestments(nextRegions, nextPolityStocks, constants);

  // Step 3-5: Calculate regional updates
  for (let i = 0; i < nextRegions.length; i++) {
    const region = nextRegions[i];
    if (!region) continue;
    
    const delta = calculateRegionMonth(region, constants);
    
    // Update region with new values
    const updatedRegion: EconomyMvpRegion = {
      regionId: region.regionId,
      controllerId: region.controllerId,
      population: region.population + delta.populationChange,
      annualBirthRateBp: region.annualBirthRateBp,
      annualDeathRateBp: region.annualDeathRateBp,
      birthRemainder: delta.birthRemainder,
      deathRemainder: delta.deathRemainder,
      workforceRateBp: region.workforceRateBp,
      infrastructureBp: region.infrastructureBp,
      primaryCommodity: region.primaryCommodity,
      baseMonthlyCapacity: region.baseMonthlyCapacity,
      outputPerWorker: region.outputPerWorker,
      damageBp: region.damageBp
    };
    nextRegions[i] = updatedRegion;
    
    regionalDeltas.push(delta);
  }

  // Step 6-8: Aggregate and update polity stocks
  const polityMap = new Map<string, PolityStocks>();
  for (const stocks of nextPolityStocks) {
    polityMap.set(stocks.polityId, stocks);
  }

  for (const polityId of polityMap.keys()) {
    const ledger = aggregatePolityContributions(nextRegions, regionalDeltas, polityId, constants);
    nationalLedgers.push(ledger);

    // Update polity stocks
    const stocks = polityMap.get(polityId);
    if (!stocks) continue;
    
    // Add tax revenue
    stocks.treasuryMicros += ledger.taxRevenueContribution;
    
    // Consume food
    const foodNeed = ledger.foodNeedContribution;
    const foodProduction = ledger.foodProductionContribution;
    const currentFoodInventory = stocks.inventory.food || 0;
    
    const totalFoodAvailable = currentFoodInventory + foodProduction;
    const foodConsumed = Math.min(foodNeed, totalFoodAvailable);
    const foodRemaining = totalFoodAvailable - foodConsumed;
    
    stocks.inventory.food = Math.max(0, foodRemaining) as QuantityMicros;
    foodSurplusOrShortfall[polityId] = (foodRemaining - foodNeed) as QuantityMicros;
    
    // Reset accepted investment for next month
    stocks.acceptedInvestment = null;
    
    // Generate alerts for food shortage
    if (foodConsumed < foodNeed) {
      const shortage = foodNeed - foodConsumed;
      alerts.push({
        polityId,
        message: `Food shortage: ${shortage} units needed`,
        severity: 'warning'
      });
    }
  }

  return {
    nextRegions,
    nextPolityStocks,
    regionalDeltas,
    nationalLedgers,
    foodSurplusOrShortfall,
    alerts
  };
}

/**
 * Calculate one region's monthly update
 */
function calculateRegionMonth(
  region: EconomyMvpRegion,
  constants: EconomyScenarioConstants
): RegionalDelta & { birthRemainder: bigint; deathRemainder: bigint } {
  // Calculate births: birth numerator = population × annualBirthRateBp + birthRemainder
  const birthNumerator = BigInt(region.population) * BigInt(region.annualBirthRateBp) + region.birthRemainder;
  const births = Number(birthNumerator / BigInt(120000));
  const birthRemainder = birthNumerator % BigInt(120000);

  // Calculate deaths: death numerator = population × annualDeathRateBp + deathRemainder
  const deathNumerator = BigInt(region.population) * BigInt(region.annualDeathRateBp) + region.deathRemainder;
  const deaths = Number(deathNumerator / BigInt(120000));
  const deathRemainder = deathNumerator % BigInt(120000);

  const populationChange = births - deaths;
  const newPopulation = region.population + populationChange;

  // Calculate workforce
  const oldWorkforce = Math.floor((region.population * region.workforceRateBp) / 10000);
  const newWorkforce = Math.floor((newPopulation * region.workforceRateBp) / 10000);
  const workforceChange = newWorkforce - oldWorkforce;

  // Calculate gross output
  const grossOutput = calculateRegionGrossOutput(region);

  return {
    regionId: region.regionId,
    populationChange,
    births: births as PersonCount,
    deaths: deaths as PersonCount,
    workforceChange,
    grossOutput,
    infrastructureChange: 0, // Set during investment processing
    damageChange: 0,
    birthRemainder,
    deathRemainder
  };
}

/**
 * Process investments for the month
 */
function processInvestments(
  regions: EconomyMvpRegion[],
  polityStocks: PolityStocks[],
  constants: EconomyScenarioConstants
): void {
  for (const stocks of polityStocks) {
    if (!stocks.acceptedInvestment) continue;

    const { targetRegionId, spendMicros } = stocks.acceptedInvestment;
    
    // Find and validate target region
    const regionIndex = regions.findIndex(r => 
      r.regionId === targetRegionId && r.controllerId === stocks.polityId
    );
    
    if (regionIndex === -1) {
      // Invalid investment - skip but don't throw
      continue;
    }

    // Deduct from treasury
    if (stocks.treasuryMicros >= spendMicros) {
      stocks.treasuryMicros -= spendMicros;
      
      // Apply infrastructure improvement
      const region = regions[regionIndex];
      if (!region) continue;
      const infrastructureGain = Math.floor(
        (spendMicros * constants.infrastructureBpPerMoney) / 1000000
      );
      region.infrastructureBp = Math.min(
        region.infrastructureBp + infrastructureGain,
        constants.maxInfrastructureBp
      );
    }
  }
}

/**
 * Aggregate contributions for a polity
 */
function aggregatePolityContributions(
  regions: EconomyMvpRegion[],
  regionalDeltas: RegionalDelta[],
  polityId: string,
  constants: EconomyScenarioConstants
): NationalContributionLedger {
  let populationContribution = 0;
  let workforceContribution = 0;
  const productionContribution: Record<Commodity, QuantityMicros> = {
    food: 0 as QuantityMicros,
    energy: 0 as QuantityMicros,
    materials: 0 as QuantityMicros,
    manufactures: 0 as QuantityMicros
  };
  let taxRevenueContribution = 0;
  let foodNeedContribution = 0;
  let foodProductionContribution = 0;

  // Filter regions controlled by this polity
  const polityRegions = regions.filter(r => r.controllerId === polityId);
  const polityDeltas = regionalDeltas.filter(d => 
    polityRegions.some(r => r.regionId === d.regionId)
  );

  for (const region of polityRegions) {
    const delta = polityDeltas.find(d => d.regionId === region.regionId);
    
    // Population and workforce
    populationContribution += region.population + (delta?.populationChange || 0);
    workforceContribution += Math.floor(
      ((region.population + (delta?.populationChange || 0)) * region.workforceRateBp) / 10000
    );

    // Production by commodity
    const output = delta?.grossOutput || calculateRegionGrossOutput(region);
    productionContribution[region.primaryCommodity] += output;

    // Tax revenue
    const accountingValue = constants.accountingValue[region.primaryCommodity];
    const commodityTax = Math.floor((output * accountingValue * constants.taxRateBp) / 100000000);
    taxRevenueContribution += commodityTax;

    // Food-specific calculations
    if (region.primaryCommodity === 'food') {
      foodProductionContribution += output;
    }
  }

  // Food need
  foodNeedContribution = Math.floor(populationContribution * constants.foodNeedPerPerson / 1000000);

  return {
    polityId,
    populationContribution: populationContribution as PersonCount,
    workforceContribution: workforceContribution as PersonCount,
    productionContribution,
    taxRevenueContribution: taxRevenueContribution as QuantityMicros,
    foodNeedContribution: foodNeedContribution as QuantityMicros,
    foodProductionContribution: foodProductionContribution as QuantityMicros
  };
}

/**
 * Validate controller references and commands
 */
function validateControllersAndCommands(
  regions: EconomyMvpRegion[],
  polityStocks: PolityStocks[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const polityIds = new Set(polityStocks.map(p => p.polityId));

  // Check each region has a valid controller
  for (const region of regions) {
    if (!polityIds.has(region.controllerId)) {
      errors.push(`Region ${region.regionId} has invalid controller ${region.controllerId}`);
    }
  }

  // Check accepted investments reference valid regions
  for (const stocks of polityStocks) {
    if (stocks.acceptedInvestment) {
      const { targetRegionId } = stocks.acceptedInvestment;
      const region = regions.find(r => r.regionId === targetRegionId);
      
      if (!region) {
        errors.push(`Accepted investment references non-existent region ${targetRegionId}`);
      } else if (region.controllerId !== stocks.polityId) {
        errors.push(`Accepted investment targets region not controlled by polity ${stocks.polityId}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate total population for a polity
 */
export function calculatePolityPopulation(
  regions: EconomyMvpRegion[],
  polityId: string
): PersonCount {
  return regions
    .filter(r => r.controllerId === polityId)
    .reduce((sum, r) => sum + r.population, 0) as PersonCount;
}

/**
 * Calculate total production for a polity by commodity
 */
export function calculatePolityProduction(
  regions: EconomyMvpRegion[],
  polityId: string
): Record<Commodity, QuantityMicros> {
  const result: Record<Commodity, QuantityMicros> = {
    food: 0 as QuantityMicros,
    energy: 0 as QuantityMicros,
    materials: 0 as QuantityMicros,
    manufactures: 0 as QuantityMicros
  };

  for (const region of regions) {
    if (region.controllerId === polityId) {
      const output = calculateRegionGrossOutput(region);
      result[region.primaryCommodity] += output;
    }
  }

  return result;
}