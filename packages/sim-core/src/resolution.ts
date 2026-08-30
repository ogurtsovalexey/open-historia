import {
  EconomyMvpRegion,
  PolityStocks,
  EconomyScenarioConstants,
  MonthlyResolutionResult,
  RegionalDelta,
  NationalContributionLedger,
  QuantityMicros,
  PersonCount,
  Commodity,
  PolityId,
  economyMvpRegionSchema,
  polityStocksSchema,
  economyScenarioConstantsSchema,
  monthlyResolutionResultSchema
} from './types.js';
import {
  calculateRegionGrossOutput,
  calculateInfrastructureGain
} from './investment.js';
import {
  addExact,
  fromBigIntExact,
  multiplyDivideFloor,
  multiplyExact,
  subtractExact
} from './arithmetic.js';

// Fixed-point conversion constants used by the spec formulas.
const MICROS_PER_UNIT = 1_000_000;
const BP_PER_WHOLE = 10_000;

/**
 * Monthly resolution algorithm as defined in docs/spec/first-economy-mvp.md
 * Follows fixed order and uses integer arithmetic.
 *
 * Treasury identity: treasury' = treasury + tax revenue - accepted spending.
 */
export function resolveMonth(
  regions: EconomyMvpRegion[],
  polityStocksArray: PolityStocks[],
  constants: EconomyScenarioConstants
): MonthlyResolutionResult {
  economyMvpRegionSchema.array().parse(regions);
  polityStocksSchema.array().parse(polityStocksArray);
  economyScenarioConstantsSchema.parse(constants);
  // Step 1: Validate controller references and the accepted policy command.
  const validated = validateControllersAndCommands(regions, polityStocksArray);
  if (!validated.valid) {
    throw new Error(`Validation failed: ${validated.errors.join(', ')}`);
  }

  // Working copies — deep enough to never touch the caller's objects.
  const nextRegions: EconomyMvpRegion[] = regions.map(region => ({
    ...region,
    birthRemainder: region.birthRemainder,
    deathRemainder: region.deathRemainder
  }));
  const nextPolityStocks: PolityStocks[] = polityStocksArray.map(stocks => ({
    polityId: stocks.polityId,
    treasuryMicros: stocks.treasuryMicros,
    inventory: { ...stocks.inventory },
    acceptedInvestment: stocks.acceptedInvestment
      ? { ...stocks.acceptedInvestment }
      : null
  }));

  const regionalDeltas: RegionalDelta[] = [];
  const nationalLedgers: NationalContributionLedger[] = [];
  const foodSurplusOrShortfall: Record<string, QuantityMicros> = {};
  const alerts: Array<{ polityId: PolityId; message: string; severity: 'info' | 'warning' | 'error' }> = [];

  // Step 2: Pay the targeted regional investment from treasury and apply the
  // shared pure infrastructure gain formula used by the preview.
  const infrastructureChanges = processInvestments(nextRegions, nextPolityStocks, constants);

  // Step 3-5: Births, deaths, workforce and gross output per region.
  for (let i = 0; i < nextRegions.length; i++) {
    const region = nextRegions[i];
    if (!region) continue;

    const infrastructureChange = infrastructureChanges[region.regionId] ?? 0;
    const delta = calculateRegionMonth(region, infrastructureChange);

    // Update region with the new population and carried remainders.
    const updatedRegion: EconomyMvpRegion = {
      regionId: region.regionId,
      controllerId: region.controllerId,
      population: addExact(region.population, delta.populationChange, `population.${region.regionId}`),
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

    regionalDeltas.push({
      regionId: delta.regionId,
      populationChange: delta.populationChange,
      births: delta.births,
      deaths: delta.deaths,
      workforceChange: delta.workforceChange,
      grossOutput: delta.grossOutput,
      infrastructureChange: delta.infrastructureChange,
      damageChange: delta.damageChange
    });
  }

  // Step 6-8: Aggregate, consume food, add tax revenue and update treasury.
  const polityMap = new Map<PolityId, PolityStocks>();
  for (const stocks of nextPolityStocks) {
    polityMap.set(stocks.polityId, stocks);
  }

  for (const polityId of polityMap.keys()) {
    const ledger = aggregatePolityContributions(nextRegions, regionalDeltas, polityId, constants);
    nationalLedgers.push(ledger);

    const stocks = polityMap.get(polityId);
    if (!stocks) continue;

    // Step 8: Add tax revenue. Spending was already deducted in step 2.
    stocks.treasuryMicros = addExact(stocks.treasuryMicros, ledger.taxRevenueContribution, `treasury.${polityId}`);

    // Every commodity production enters its national inventory. Food is then
    // consumed below; other commodities remain accumulated stocks.
    for (const commodity of ['food', 'energy', 'materials', 'manufactures'] as Commodity[]) {
      stocks.inventory[commodity] = addExact(
        stocks.inventory[commodity],
        ledger.productionContribution[commodity],
        `inventory.${polityId}.${commodity}`
      );
    }

    // Step 7: Consume authored food need from inventory plus current production.
    const foodNeed = ledger.foodNeedContribution;
    const totalFoodAvailable = stocks.inventory.food;
    const foodConsumed = Math.min(foodNeed, totalFoodAvailable);
    const foodRemaining = subtractExact(totalFoodAvailable, foodConsumed, `foodRemaining.${polityId}`);

    stocks.inventory.food = Math.max(0, foodRemaining) as QuantityMicros;
    foodSurplusOrShortfall[polityId] = subtractExact(totalFoodAvailable, foodNeed, `foodBalance.${polityId}`) as QuantityMicros;

    // Reset accepted investment for next month.
    stocks.acceptedInvestment = null;

    // Generate alerts for food shortage.
    if (foodConsumed < foodNeed) {
      const shortage = subtractExact(foodNeed, foodConsumed, `foodShortage.${polityId}`);
      alerts.push({
        polityId,
        message: `Food shortage: ${shortage} micros needed`,
        severity: 'warning'
      });
    }
  }

  return monthlyResolutionResultSchema.parse({
    nextRegions,
    nextPolityStocks,
    regionalDeltas,
    nationalLedgers,
    foodSurplusOrShortfall,
    alerts
  });
}

/**
 * Calculate one region's monthly update.
 *
 * Spec order: births/deaths from authored annual rates, then workforce and
 * gross output from the NEW population.
 */
function calculateRegionMonth(
  region: EconomyMvpRegion,
  infrastructureChange: number
): RegionalDelta & { birthRemainder: bigint; deathRemainder: bigint } {
  // birth numerator = population × annualBirthRateBp + birthRemainder
  const birthNumerator = BigInt(region.population) * BigInt(region.annualBirthRateBp) + region.birthRemainder;
  const births = fromBigIntExact(birthNumerator / 120000n, `births.${region.regionId}`);
  const birthRemainder = birthNumerator % BigInt(120000);

  // death numerator = population × annualDeathRateBp + deathRemainder
  const deathNumerator = BigInt(region.population) * BigInt(region.annualDeathRateBp) + region.deathRemainder;
  const deaths = fromBigIntExact(deathNumerator / 120000n, `deaths.${region.regionId}`);
  const deathRemainder = deathNumerator % BigInt(120000);

  const populationChange = subtractExact(births, deaths, `populationChange.${region.regionId}`);
  const newPopulation = addExact(region.population, populationChange, `population.${region.regionId}`);
  if (newPopulation < 0) throw new RangeError(`population.${region.regionId} cannot become negative`);

  // Workforce from the new population.
  const oldWorkforce = multiplyDivideFloor([region.population, region.workforceRateBp], BP_PER_WHOLE, `oldWorkforce.${region.regionId}`);
  const newWorkforce = multiplyDivideFloor([newPopulation, region.workforceRateBp], BP_PER_WHOLE, `newWorkforce.${region.regionId}`);
  const workforceChange = subtractExact(newWorkforce, oldWorkforce, `workforceChange.${region.regionId}`);

  // Gross output from the new population and the (possibly updated) infrastructure.
  const outputRegion: EconomyMvpRegion = { ...region, population: newPopulation };
  const grossOutput = calculateRegionGrossOutput(outputRegion);

  return {
    regionId: region.regionId,
    populationChange,
    births: births as PersonCount,
    deaths: deaths as PersonCount,
    workforceChange,
    grossOutput,
    infrastructureChange,
    damageChange: 0,
    birthRemainder,
    deathRemainder
  };
}

/**
 * Step 2: pay accepted regional investments using the same pure gain formula
 * as the preview. Returns the applied infrastructure change per region.
 */
function processInvestments(
  regions: EconomyMvpRegion[],
  polityStocks: PolityStocks[],
  constants: EconomyScenarioConstants
): Record<string, number> {
  const infrastructureChanges: Record<string, number> = {};

  for (const stocks of polityStocks) {
    if (!stocks.acceptedInvestment) continue;

    const { targetRegionId, spendMicros } = stocks.acceptedInvestment;

    // Validation has already proved that the target exists and is controlled
    // by this polity. Keep the defensive throws so future refactors cannot
    // silently discard an accepted command.
    const regionIndex = regions.findIndex(r =>
      r.regionId === targetRegionId && r.controllerId === stocks.polityId
    );
    if (regionIndex === -1) {
      throw new Error(`Accepted investment target ${targetRegionId} failed validated lookup`);
    }

    if (stocks.treasuryMicros < spendMicros) {
      throw new Error(`Accepted investment for ${stocks.polityId} exceeds treasury`);
    }

    stocks.treasuryMicros = subtractExact(stocks.treasuryMicros, spendMicros, `investmentTreasury.${stocks.polityId}`);

    const region = regions[regionIndex];
    if (!region) throw new Error(`Accepted investment target ${targetRegionId} disappeared`);

    const gain = calculateInfrastructureGain(spendMicros, constants);
    const previous = region.infrastructureBp;
    region.infrastructureBp = Math.min(addExact(previous, gain, `infrastructure.${region.regionId}`), constants.maxInfrastructureBp);
    infrastructureChanges[region.regionId] = subtractExact(region.infrastructureBp, previous, `infrastructureChange.${region.regionId}`);
  }

  return infrastructureChanges;
}

/**
 * Aggregate contributions for a polity from its controlled regions.
 * `regions` here are already the post-tick regions (new population).
 */
function aggregatePolityContributions(
  regions: EconomyMvpRegion[],
  regionalDeltas: RegionalDelta[],
  polityId: PolityId,
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

  const polityRegions = regions.filter(r => r.controllerId === polityId);
  const polityDeltas = regionalDeltas.filter(d =>
    polityRegions.some(r => r.regionId === d.regionId)
  );

  for (const region of polityRegions) {
    const delta = polityDeltas.find(d => d.regionId === region.regionId);

    // Population and workforce (post-tick values).
    populationContribution = addExact(populationContribution, region.population, `populationContribution.${polityId}`);
    workforceContribution = addExact(
      workforceContribution,
      multiplyDivideFloor([region.population, region.workforceRateBp], BP_PER_WHOLE, `workforce.${region.regionId}`),
      `workforceContribution.${polityId}`
    );

    // Production by commodity.
    const output = delta ? delta.grossOutput : calculateRegionGrossOutput(region);
    productionContribution[region.primaryCommodity] = addExact(
      productionContribution[region.primaryCommodity],
      output,
      `production.${polityId}.${region.primaryCommodity}`
    );

    // Tax revenue = gross output (micros) × accounting value (micros per unit)
    //               × taxRateBp / (micros-per-unit × basis-points-per-whole)
    const accountingValue = constants.accountingValue[region.primaryCommodity];
    const commodityTax = multiplyDivideFloor(
      [output, accountingValue, constants.taxRateBp],
      MICROS_PER_UNIT * BP_PER_WHOLE,
      `tax.${region.regionId}`
    );
    taxRevenueContribution = addExact(taxRevenueContribution, commodityTax, `tax.${polityId}`);

    // Food-specific calculations.
    if (region.primaryCommodity === 'food') {
      foodProductionContribution = addExact(foodProductionContribution, output, `foodProduction.${polityId}`);
    }
  }

  // Food need = polity population × foodNeedPerPerson (both micros).
  foodNeedContribution = multiplyExact(populationContribution, constants.foodNeedPerPerson, `foodNeed.${polityId}`);

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
 * Validate controller references and commands.
 */
function validateControllersAndCommands(
  regions: EconomyMvpRegion[],
  polityStocks: PolityStocks[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const polityIds = new Set(polityStocks.map(p => p.polityId));
  if (polityIds.size !== polityStocks.length) errors.push('Duplicate polity stock IDs are not allowed');
  const regionIds = new Set(regions.map(region => region.regionId));
  if (regionIds.size !== regions.length) errors.push('Duplicate region IDs are not allowed');

  // Each region must have a known controller.
  for (const region of regions) {
    if (!polityIds.has(region.controllerId)) {
      errors.push(`Region ${region.regionId} has invalid controller ${region.controllerId}`);
    }
  }

  // Accepted investments must reference a region controlled by that polity.
  for (const stocks of polityStocks) {
    if (stocks.acceptedInvestment) {
      const { targetRegionId, spendMicros } = stocks.acceptedInvestment;
      const region = regions.find(r => r.regionId === targetRegionId);

      if (!region) {
        errors.push(`Accepted investment references non-existent region ${targetRegionId}`);
      } else if (region.controllerId !== stocks.polityId) {
        errors.push(`Accepted investment targets region not controlled by polity ${stocks.polityId}`);
      }
      if (spendMicros <= 0) errors.push(`Accepted investment for ${stocks.polityId} must be positive`);
      if (spendMicros > stocks.treasuryMicros) errors.push(`Accepted investment for ${stocks.polityId} exceeds treasury`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Calculate total population for a polity.
 */
export function calculatePolityPopulation(
  regions: EconomyMvpRegion[],
  polityId: string
): PersonCount {
  economyMvpRegionSchema.array().parse(regions);
  let total = 0;
  for (const region of regions) {
    if (region.controllerId === polityId) total = addExact(total, region.population, `population.${polityId}`);
  }
  return total as PersonCount;
}

/**
 * Calculate total production for a polity by commodity.
 */
export function calculatePolityProduction(
  regions: EconomyMvpRegion[],
  polityId: string
): Record<Commodity, QuantityMicros> {
  economyMvpRegionSchema.array().parse(regions);
  const result: Record<Commodity, QuantityMicros> = {
    food: 0 as QuantityMicros,
    energy: 0 as QuantityMicros,
    materials: 0 as QuantityMicros,
    manufactures: 0 as QuantityMicros
  };

  for (const region of regions) {
    if (region.controllerId === polityId) {
      const output = calculateRegionGrossOutput(region);
      result[region.primaryCommodity] = addExact(result[region.primaryCommodity], output, `production.${polityId}`);
    }
  }

  return result;
}
