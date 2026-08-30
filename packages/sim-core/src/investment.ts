import {
  EconomyMvpRegion,
  PolityStocks,
  EconomyScenarioConstants,
  InvestmentPreviewResult,
  QuantityMicros,
  BasisPoints,
  InvestInRegionCommand,
  WorldRevisionId,
  GameDate,
  investInRegionCommandSchema,
  economyMvpRegionSchema,
  polityStocksSchema,
  economyScenarioConstantsSchema,
  investmentPreviewResultSchema
} from './types.js';
import {
  addExact,
  assertSafeInteger,
  multiplyDivideFloor,
  multiplyCapped,
  subtractExact
} from './arithmetic.js';

/**
 * Infrastructure gain for an accepted regional investment.
 *
 * Spec formula (docs/spec/first-economy-mvp.md):
 *   infrastructure gain = accepted spend × infrastructureBpPerMoney
 *
 * `spendMicros` is fixed-point money (1 unit = 1,000,000 micros) and
 * `infrastructureBpPerMoney` is authored basis points per whole money unit,
 * so the micros must be converted before multiplying.
 */
export function calculateInfrastructureGain(
  spendMicros: QuantityMicros,
  constants: EconomyScenarioConstants
): BasisPoints {
  return multiplyDivideFloor(
    [spendMicros, constants.infrastructureBpPerMoney],
    1_000_000,
    'infrastructureGain'
  ) as BasisPoints;
}

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
  actorPolityId: string,
  controlledRegions: EconomyMvpRegion[]
): InvestmentPreviewResult {
  economyMvpRegionSchema.parse(region);
  polityStocksSchema.parse(polityStocks);
  economyScenarioConstantsSchema.parse(constants);
  economyMvpRegionSchema.array().parse(controlledRegions);
  if (new Set(controlledRegions.map((candidate) => candidate.regionId)).size !== controlledRegions.length) {
    throw new Error('Duplicate region IDs are not allowed in an investment preview');
  }

  // Validate target region belongs to actor
  const isValidTarget =
    polityStocks.polityId === actorPolityId &&
    region.controllerId === actorPolityId &&
    region.regionId === targetRegionId &&
    controlledRegions.some((candidate) => candidate.regionId === targetRegionId);
  const isValidAmount = Number.isSafeInteger(spendMicros) && spendMicros > 0;
  const canAfford = isValidAmount && polityStocks.treasuryMicros >= spendMicros;

  if (!isValidTarget || !canAfford || !isValidAmount) {
    return investmentPreviewResultSchema.parse({
      costMicros: Number.isSafeInteger(spendMicros) && spendMicros >= 0 ? spendMicros : 0,
      infrastructureChange: 0,
      estimatedNextMonthOutputDelta: 0 as QuantityMicros,
      affectedNationalCommodityTotal: 0 as QuantityMicros,
      canAfford,
      isValidTarget,
      isValidAmount
    });
  }

  // Calculate infrastructure gain via the shared pure formula.
  const infrastructureGain = calculateInfrastructureGain(spendMicros, constants);

  // Apply infrastructure improvement, clamped at max
  const newInfrastructureBp = Math.min(
    addExact(region.infrastructureBp, infrastructureGain, 'newInfrastructureBp'),
    constants.maxInfrastructureBp
  );
  const infrastructureChange = newInfrastructureBp - region.infrastructureBp;

  // Calculate estimated next month output delta
  const estimatedOutputDelta = calculateRegionOutputDelta(
    region,
    newInfrastructureBp
  );

  // Calculate affected national commodity total
  let affectedNationalCommodityTotal = 0;
  for (const candidate of controlledRegions) {
    if (candidate.controllerId !== actorPolityId || candidate.primaryCommodity !== region.primaryCommodity) continue;
    const output = candidate.regionId === region.regionId
      ? calculateRegionGrossOutput({ ...region, infrastructureBp: newInfrastructureBp })
      : calculateRegionGrossOutput(candidate);
    affectedNationalCommodityTotal = addExact(
      affectedNationalCommodityTotal,
      output,
      'affectedNationalCommodityTotal'
    );
  }

  return investmentPreviewResultSchema.parse({
    costMicros: spendMicros,
    infrastructureChange,
    estimatedNextMonthOutputDelta: estimatedOutputDelta,
    affectedNationalCommodityTotal,
    canAfford: true,
    isValidTarget: true,
    isValidAmount: true
  });
}

/**
 * Calculate region output delta for given infrastructure change
 */
function calculateRegionOutputDelta(
  region: EconomyMvpRegion,
  newInfrastructureBp: BasisPoints
): QuantityMicros {
  // Calculate current output
  const currentOutput = calculateRegionGrossOutput(region);

  // Calculate output with new infrastructure
  const regionWithNewInfrastructure = {
    ...region,
    infrastructureBp: newInfrastructureBp
  };
  const newOutput = calculateRegionGrossOutput(regionWithNewInfrastructure);

  return subtractExact(newOutput, currentOutput, 'investmentOutputDelta') as QuantityMicros;
}

/**
 * Calculate region gross output as defined in spec formulas
 */
export function calculateRegionGrossOutput(region: EconomyMvpRegion): QuantityMicros {
  assertSafeInteger(region.population, 'population', 0);
  assertSafeInteger(region.workforceRateBp, 'workforceRateBp', 0);
  assertSafeInteger(region.outputPerWorker, 'outputPerWorker', 0);
  assertSafeInteger(region.baseMonthlyCapacity, 'baseMonthlyCapacity', 0);
  assertSafeInteger(region.infrastructureBp, 'infrastructureBp', 0);
  assertSafeInteger(region.damageBp, 'damageBp', 0);
  for (const [name, value] of [
    ['workforceRateBp', region.workforceRateBp],
    ['infrastructureBp', region.infrastructureBp],
    ['damageBp', region.damageBp],
  ] as const) {
    if (value > 10_000) throw new RangeError(`${name} cannot exceed 10000`);
  }
  // workforce = population × workforceRateBp / 10000
  const workforce = multiplyDivideFloor([region.population, region.workforceRateBp], 10000, 'workforce');

  // labour output = workforce × outputPerWorker
  // usable capacity = min(baseMonthlyCapacity, workforce × outputPerWorker).
  // The capped multiplication remains exact even when the unused labour
  // product itself would exceed Number.MAX_SAFE_INTEGER.
  const usableCapacity = multiplyCapped(
    workforce,
    region.outputPerWorker,
    region.baseMonthlyCapacity,
    'usableCapacity'
  );

  // gross output = usable capacity × infrastructureBp / 10000
  let grossOutput = multiplyDivideFloor([usableCapacity, region.infrastructureBp], 10000, 'infrastructureOutput');

  // Apply damage: gross output = gross output × (10000 - damageBp) / 10000
  grossOutput = multiplyDivideFloor([grossOutput, 10000 - region.damageBp], 10000, 'damageAdjustedOutput');

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

  if (!Number.isSafeInteger(spendMicros)) {
    errors.push(`Spend amount must be a safe integer: ${spendMicros}`);
  }

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

/**
 * Accepts one typed policy command without mutating the caller's stocks. Stale,
 * foreign, invalid and unaffordable commands throw before any state change.
 */
export function acceptInvestmentCommand(
  regions: EconomyMvpRegion[],
  polityStocks: PolityStocks[],
  commandInput: InvestInRegionCommand,
  currentRevision: WorldRevisionId,
  currentMonth: GameDate
): PolityStocks[] {
  const command = investInRegionCommandSchema.parse(commandInput);
  economyMvpRegionSchema.array().parse(regions);
  polityStocksSchema.array().parse(polityStocks);

  if (new Set(regions.map((region) => region.regionId)).size !== regions.length) {
    throw new Error('Duplicate region IDs are not allowed');
  }
  if (new Set(polityStocks.map((stocks) => stocks.polityId)).size !== polityStocks.length) {
    throw new Error('Duplicate polity stock IDs are not allowed');
  }

  if (command.expectedRevision !== currentRevision) {
    throw new Error(`Stale economy command: expected ${command.expectedRevision}, current ${currentRevision}`);
  }
  if (command.effectiveMonth !== currentMonth) {
    throw new Error(`Investment effective month ${command.effectiveMonth} does not match ${currentMonth}`);
  }
  const region = regions.find((candidate) => candidate.regionId === command.targetRegionId);
  const stocks = polityStocks.find((candidate) => candidate.polityId === command.actorPolityId);
  if (!region || !stocks) throw new Error('Investment references an unknown region or polity');
  const validation = validateInvestmentCommand(
    region,
    stocks,
    command.spend,
    command.targetRegionId,
    command.actorPolityId
  );
  if (!validation.valid) throw new Error(`Invalid investment: ${validation.errors.join(', ')}`);
  if (stocks.acceptedInvestment) throw new Error(`Polity ${stocks.polityId} already has an accepted investment`);

  return polityStocks.map((candidate) => candidate.polityId === stocks.polityId
    ? {
        ...candidate,
        inventory: { ...candidate.inventory },
        acceptedInvestment: {
          targetRegionId: command.targetRegionId,
          spendMicros: command.spend,
          effectiveMonth: command.effectiveMonth
        }
      }
    : {
        ...candidate,
        inventory: { ...candidate.inventory },
        acceptedInvestment: candidate.acceptedInvestment ? { ...candidate.acceptedInvestment } : null
      });
}
