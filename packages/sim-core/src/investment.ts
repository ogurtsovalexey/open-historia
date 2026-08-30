import {
  EconomyMvpRegion,
  PolityStocks,
  EconomyScenarioConstants,
  InvestmentPreviewResult,
  QuantityMicros,
  BasisPoints
} from './types.js';

/**
 * Pure investment calculation as defined in spec
 * Both preview and resolution call this same function
 */
export function calculateInvestmentPreview(
  region: EconomyMvpRegion,
  polityStocks: PolityStocks,
  constants: EconomyScenarioConstants,
  spendMicros: QuantityMicros,
  targetRegionId: string,
  actorPolityId: string
): InvestmentPreviewResult {
  // Validate target region belongs to actor
  const isValidTarget = region.controllerId === actorPolityId && region.regionId === targetRegionId;
  const canAfford = polityStocks.treasuryMicros >= spendMicros;

  if (!isValidTarget || !canAfford) {
    return {
      costMicros: spendMicros,
      infrastructureChange: 0,
      estimatedNextMonthOutputDelta: 0 as QuantityMicros,
      affectedNationalCommodityTotal: 0 as QuantityMicros,
      canAfford,
      isValidTarget
    };
  }

  // Calculate infrastructure gain
  const infrastructureGain = Math.floor(
    (spendMicros * constants.infrastructureBpPerMoney) / 1000000
  );
  
  // Apply infrastructure improvement, clamped at max
  const newInfrastructureBp = Math.min(
    region.infrastructureBp + infrastructureGain,
    constants.maxInfrastructureBp
  );
  const infrastructureChange = newInfrastructureBp - region.infrastructureBp;

  // Calculate estimated next month output delta
  const estimatedOutputDelta = calculateRegionOutputDelta(
    region,
    newInfrastructureBp,
    constants
  );

  // Calculate affected national commodity total
  const affectedNationalCommodityTotal = region.baseMonthlyCapacity;

  return {
    costMicros: spendMicros,
    infrastructureChange,
    estimatedNextMonthOutputDelta: estimatedOutputDelta,
    affectedNationalCommodityTotal,
    canAfford: true,
    isValidTarget: true
  };
}

/**
 * Calculate region output delta for given infrastructure change
 */
function calculateRegionOutputDelta(
  region: EconomyMvpRegion,
  newInfrastructureBp: BasisPoints,
  constants: EconomyScenarioConstants
): QuantityMicros {
  // Calculate current output
  const currentOutput = calculateRegionGrossOutput(region);
  
  // Calculate output with new infrastructure
  const regionWithNewInfrastructure = {
    ...region,
    infrastructureBp: newInfrastructureBp
  };
  const newOutput = calculateRegionGrossOutput(regionWithNewInfrastructure);
  
  return (newOutput - currentOutput) as QuantityMicros;
}

/**
 * Calculate region gross output as defined in spec formulas
 */
export function calculateRegionGrossOutput(region: EconomyMvpRegion): QuantityMicros {
  // workforce = population × workforceRateBp / 10000
  const workforce = Math.floor((region.population * region.workforceRateBp) / 10000);
  
  // labour output = workforce × outputPerWorker
  const labourOutput = workforce * region.outputPerWorker;
  
  // usable capacity = min(baseMonthlyCapacity, labour output)
  const usableCapacity = Math.min(region.baseMonthlyCapacity, labourOutput);
  
  // gross output = usable capacity × infrastructureBp / 10000
  let grossOutput = Math.floor((usableCapacity * region.infrastructureBp) / 10000);
  
  // Apply damage: gross output = gross output × (10000 - damageBp) / 10000
  grossOutput = Math.floor((grossOutput * (10000 - region.damageBp)) / 10000);
  
  return Math.max(0, grossOutput) as QuantityMicros;
}

/**
 * Validate investment command parameters
 */
export function validateInvestmentCommand(
  region: EconomyMvpRegion,
  polityStocks: PolityStocks,
  spendMicros: QuantityMicros,
  targetRegionId: string,
  actorPolityId: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (region.controllerId !== actorPolityId) {
    errors.push(`Region ${targetRegionId} is not controlled by polity ${actorPolityId}`);
  }

  if (region.regionId !== targetRegionId) {
    errors.push(`Region ID mismatch: expected ${targetRegionId}, got ${region.regionId}`);
  }

  if (polityStocks.treasuryMicros < spendMicros) {
    errors.push(`Insufficient treasury: ${polityStocks.treasuryMicros} < ${spendMicros}`);
  }

  if (spendMicros <= 0) {
    errors.push(`Spend amount must be positive: ${spendMicros}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}