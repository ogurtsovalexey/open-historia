import { z } from 'zod';
/**
 * MVP commodity groups
 */
export const commoditySchema = z.enum([
    'food',
    'energy',
    'materials',
    'manufactures'
]);
/**
 * Economy MVP region state as defined in spec
 */
export const economyMvpRegionSchema = z.object({
    regionId: z.string().min(1),
    controllerId: z.string().min(1),
    population: z.number().int().min(0),
    annualBirthRateBp: z.number().int().min(0).max(10000),
    annualDeathRateBp: z.number().int().min(0).max(10000),
    birthRemainder: z.bigint().min(BigInt(0)),
    deathRemainder: z.bigint().min(BigInt(0)),
    workforceRateBp: z.number().int().min(0).max(10000),
    infrastructureBp: z.number().int().min(0).max(10000),
    primaryCommodity: commoditySchema,
    baseMonthlyCapacity: z.number().int().min(0),
    outputPerWorker: z.number().int().min(0),
    damageBp: z.number().int().min(0).max(10000)
}).strict();
/**
 * Polity-level canonical stocks
 */
export const polityStocksSchema = z.object({
    polityId: z.string().min(1),
    treasuryMicros: z.number().int().min(0),
    inventory: z.record(commoditySchema, z.number().int().min(0)),
    // Accepted regional investment for effective month
    acceptedInvestment: z.object({
        targetRegionId: z.string().min(1),
        spendMicros: z.number().int().min(0),
        effectiveMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }).strict().nullable()
}).strict();
/**
 * Scenario constants for economy MVP
 */
export const economyScenarioConstantsSchema = z.object({
    // Basis points per money unit for infrastructure investment
    infrastructureBpPerMoney: z.number().int().min(0).max(10000),
    // Food need per person per month
    foodNeedPerPerson: z.number().int().min(0),
    // Accounting value per commodity (micros per unit)
    accountingValue: z.record(commoditySchema, z.number().int().min(0)),
    // Tax rate in basis points
    taxRateBp: z.number().int().min(0).max(10000),
    // Maximum infrastructure (10000 basis points = 100%)
    maxInfrastructureBp: z.number().int().min(0).max(10000)
}).strict();
/**
 * Regional investment command as defined in spec
 */
export const investInRegionCommandSchema = z.object({
    kind: z.literal('economy.invest-region'),
    commandId: z.string().uuid(),
    actorPolityId: z.string().min(1),
    targetRegionId: z.string().min(1),
    expectedRevision: z.string().min(1),
    effectiveMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    spend: z.number().int().min(0)
}).strict();
/**
 * Regional delta for reporting changes
 */
export const regionalDeltaSchema = z.object({
    regionId: z.string().min(1),
    populationChange: z.number().int(),
    births: z.number().int().min(0),
    deaths: z.number().int().min(0),
    workforceChange: z.number().int(),
    grossOutput: z.number().int().min(0),
    infrastructureChange: z.number().int(),
    damageChange: z.number().int()
}).strict();
/**
 * National contribution ledger
 */
export const nationalContributionLedgerSchema = z.object({
    polityId: z.string().min(1),
    populationContribution: z.number().int().min(0),
    workforceContribution: z.number().int().min(0),
    productionContribution: z.record(commoditySchema, z.number().int().min(0)),
    taxRevenueContribution: z.number().int().min(0),
    foodNeedContribution: z.number().int().min(0),
    foodProductionContribution: z.number().int().min(0)
}).strict();
/**
 * Monthly resolution result
 */
export const monthlyResolutionResultSchema = z.object({
    nextRegions: economyMvpRegionSchema.array(),
    nextPolityStocks: polityStocksSchema.array(),
    regionalDeltas: regionalDeltaSchema.array(),
    nationalLedgers: nationalContributionLedgerSchema.array(),
    foodSurplusOrShortfall: z.record(z.string().min(1), z.number().int()),
    alerts: z.array(z.object({
        polityId: z.string().min(1),
        message: z.string(),
        severity: z.enum(['info', 'warning', 'error'])
    }).strict())
}).strict();
/**
 * Investment preview result
 */
export const investmentPreviewResultSchema = z.object({
    costMicros: z.number().int().min(0),
    infrastructureChange: z.number().int(),
    estimatedNextMonthOutputDelta: z.number().int().min(0),
    affectedNationalCommodityTotal: z.number().int().min(0),
    canAfford: z.boolean(),
    isValidTarget: z.boolean()
}).strict();
/**
 * Region transfer re-aggregation result
 */
export const regionTransferResultSchema = z.object({
    updatedRegions: economyMvpRegionSchema.array(),
    updatedPolityStocks: polityStocksSchema.array(),
    fromPolityLosses: nationalContributionLedgerSchema,
    toPolityGains: nationalContributionLedgerSchema
}).strict();
