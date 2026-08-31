/**
 * Scenario schema for the headless economy slice (dev fixture format).
 * Intentionally separate from ScenarioV2 (@open-historia/data-packs): the V2
 * bundle carries provenance machinery this synthetic fixture does not need.
 * Merging the formats is an open question in docs/canon/05-scenario-format.md.
 */
import { z } from 'zod';
import {
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  scenarioIdSchema,
} from '@open-historia/domain';
import { authoredStatecraftSchema } from './statecraft.js';

/** Game resource catalog per regional-resource-economy.md §2. Engine-owned. */
export const RESOURCE_CATALOG = [
  'food',
  'wood',
  'stone',
  'iron',
  'coal',
  'oil',
  'fibers',
  'gold',
  'building_materials',
  'steel',
  'fuel',
  'chemicals',
  'cloth',
  'goods',
  'machines',
  'weapons',
  'ammo',
  'medicine',
  'electricity',
] as const;

export const resourceIdSchema = z.enum(RESOURCE_CATALOG);
export type ResourceId = z.infer<typeof resourceIdSchema>;

export const RAW_RESOURCES = ['food', 'wood', 'stone', 'iron', 'coal', 'oil', 'fibers'] as const;
export const rawResourceIdSchema = z.enum(RAW_RESOURCES);
export type RawResourceId = z.infer<typeof rawResourceIdSchema>;

/** The only processing recipe accepted in this MVP: 1 Coal + 1 Iron -> 1 Goods. */
export const BASIC_GOODS_RECIPE = {
  activity: 'basic_goods',
  inputs: [
    { resource: 'coal', perUnit: 1 },
    { resource: 'iron', perUnit: 1 },
  ],
  output: 'goods',
} as const;

const displayNameSchema = z
  .object({ en: z.string().min(1), ru: z.string().min(1) })
  .strict();

const nonNegInt = z.number().int().nonnegative();
const bpSchema = z.number().int().min(0).max(10000);

export const regionActivitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('extraction'), resource: rawResourceIdSchema }).strict(),
  z.object({ kind: z.literal('processing'), activity: z.literal('basic_goods') }).strict(),
]);
export type RegionActivity = z.infer<typeof regionActivitySchema>;

export const scenarioRegionSchema = z
  .object({
    regionId: regionIdSchema,
    controllerId: polityIdSchema,
    displayName: displayNameSchema,
    activity: regionActivitySchema,
    population: nonNegInt,
    annualBirthRateBp: bpSchema,
    annualDeathRateBp: bpSchema,
    workforceRateBp: bpSchema,
    infrastructureBp: bpSchema,
    damageBp: bpSchema,
    baseMonthlyCapacity: nonNegInt,
    outputPerWorker: nonNegInt,
    /**
     * Upper bound construction may raise `baseMonthlyCapacity` to. Required
     * when the projects module is on; absent means capacity cannot grow.
     */
    capacityCeiling: nonNegInt.optional(),
  })
  .strict();
export type ScenarioRegion = z.infer<typeof scenarioRegionSchema>;

export const scenarioPolitySchema = z
  .object({
    id: polityIdSchema,
    displayName: displayNameSchema,
    treasury: nonNegInt,
    stockpile: z
      .array(z.object({ resource: resourceIdSchema, amount: nonNegInt }).strict()),
  })
  .strict();
export type ScenarioPolity = z.infer<typeof scenarioPolitySchema>;

export const resourceParamsSchema = z
  .object({
    resource: resourceIdSchema,
    /** Gold per whole resource unit (authored accounting value). */
    accountingValue: nonNegInt,
    taxRateBp: bpSchema,
  })
  .strict();
export type ResourceParams = z.infer<typeof resourceParamsSchema>;

export const economyParamsSchema = z
  .object({
    /**
     * Monthly food need in thousandths of a unit per person:
     * need = population * foodNeedPerPersonMilli / 1000 (floored).
     * The spec's `foodNeedPerPerson` made integer-friendly; recorded in canon 04.
     */
    foodNeedPerPersonMilli: nonNegInt,
    /** Infrastructure basis points gained per gold of accepted investment. */
    infrastructureBpPerMoney: nonNegInt,
    resourceParams: z.array(resourceParamsSchema).min(1),
  })
  .strict();
export type EconomyParams = z.infer<typeof economyParamsSchema>;

/**
 * Optional mechanics, per canon 00 "Modular mechanics". A module that is absent
 * or false is completely absent from the tick, the state and the UI — which is
 * also what keeps an older scenario's canonical state byte-identical.
 */
export const modulesSchema = z
  .object({
    diplomacy: z.boolean().optional(),
    finance: z.boolean().optional(),
    intelligence: z.boolean().optional(),
    projects: z.boolean().optional(),
    budget: z.boolean().optional(),
    trade: z.boolean().optional(),
    shortages: z.boolean().optional(),
    unrest: z.boolean().optional(),
  })
  .strict();
export type Modules = z.infer<typeof modulesSchema>;

export const MODULE_NAMES = ['diplomacy', 'finance', 'intelligence', 'projects', 'budget', 'trade', 'shortages', 'unrest'] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

export const authoredRelationSchema = z.object({
  polities: z.tuple([polityIdSchema, polityIdSchema]),
  opinion: z.number().int().min(-10000).max(10000),
  trust: bpSchema,
  threat: bpSchema,
}).strict();

export const authoredTradeRouteSchema = z.object({
  polities: z.tuple([polityIdSchema, polityIdSchema]),
  monthlyCapacity: z.number().int().positive(),
}).strict();

export const authoredDiplomacySchema = z.object({
  relations: z.array(authoredRelationSchema),
  tradeRoutes: z.array(authoredTradeRouteSchema),
}).strict();

export const econScenarioSchema = z
  .object({
    schemaVersion: z.literal('open-historia-engine-scenario/1'),
    scenarioId: scenarioIdSchema,
    /** The fixture must be visibly labelled as synthetic (first-economy-mvp §2). */
    label: z.literal('development-test'),
    displayName: displayNameSchema,
    /** First day of the starting month. */
    startMonth: gameDateSchema.refine((d) => d.endsWith('-01'), {
      message: 'startMonth must be the first day of a month (YYYY-MM-01)',
    }),
    /** Reserved for future seeded mechanics; the MVP tick uses no randomness. */
    rngSeed: z.number().int().nonnegative().optional(),
    activeResources: z.array(resourceIdSchema).min(1),
    /** Omit to run the base economy exactly as before. */
    modules: modulesSchema.optional(),
    /** Required only by scenarios that enable executable diplomacy. */
    diplomacy: authoredDiplomacySchema.optional(),
    /** Authored catalogs and seeds for finance/projects/intelligence. */
    statecraft: authoredStatecraftSchema.optional(),
    economy: economyParamsSchema,
    polities: z.array(scenarioPolitySchema).min(2),
    regions: z.array(scenarioRegionSchema).min(1),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    const polityIds = new Set<string>();
    for (const polity of scenario.polities) {
      if (polityIds.has(polity.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate polity id ${polity.id}`, path: ['polities'] });
      }
      polityIds.add(polity.id);
    }
    if (scenario.modules?.diplomacy === true && !scenario.diplomacy) {
      ctx.addIssue({ code: 'custom', message: 'diplomacy module requires authored diplomacy inputs', path: ['diplomacy'] });
    }
    if ((scenario.modules?.finance === true || scenario.modules?.intelligence === true) && !scenario.statecraft) {
      ctx.addIssue({ code: 'custom', message: 'finance/intelligence modules require authored statecraft inputs', path: ['statecraft'] });
    }
    if (scenario.statecraft) {
      const unique = (values: string[], path: (string | number)[]) => {
        const seen = new Set<string>();
        for (const value of values) {
          if (seen.has(value)) ctx.addIssue({ code: 'custom', message: `duplicate statecraft id ${value}`, path });
          seen.add(value);
        }
      };
      unique(scenario.statecraft.finance.map((entry) => entry.polityId), ['statecraft', 'finance']);
      unique(scenario.statecraft.capacities.map((entry) => entry.polityId), ['statecraft', 'capacities']);
      unique(scenario.statecraft.projectTemplates.map((entry) => entry.templateId), ['statecraft', 'projectTemplates']);
      unique(scenario.statecraft.intelligenceFacts.map((entry) => entry.factId), ['statecraft', 'intelligenceFacts']);
      if (scenario.modules?.finance === true && scenario.statecraft.finance.length !== polityIds.size) {
        ctx.addIssue({ code: 'custom', message: 'finance module requires exactly one finance row per polity', path: ['statecraft', 'finance'] });
      }
      if (scenario.modules?.projects === true && scenario.statecraft.capacities.length !== polityIds.size) {
        ctx.addIssue({ code: 'custom', message: 'projects module requires exactly one capacity row per polity', path: ['statecraft', 'capacities'] });
      }
      for (const [index, entry] of scenario.statecraft.finance.entries()) {
        if (!polityIds.has(entry.polityId)) ctx.addIssue({ code: 'custom', message: `unknown finance polity ${entry.polityId}`, path: ['statecraft', 'finance', index, 'polityId'] });
      }
      for (const [index, entry] of scenario.statecraft.capacities.entries()) {
        if (!polityIds.has(entry.polityId)) ctx.addIssue({ code: 'custom', message: `unknown capacity polity ${entry.polityId}`, path: ['statecraft', 'capacities', index, 'polityId'] });
      }
      const factIds = new Set(scenario.statecraft.intelligenceFacts.map((entry) => entry.factId));
      for (const [index, fact] of scenario.statecraft.intelligenceFacts.entries()) {
        if (!polityIds.has(fact.subjectPolityId)) ctx.addIssue({ code: 'custom', message: `unknown intelligence subject ${fact.subjectPolityId}`, path: ['statecraft', 'intelligenceFacts', index, 'subjectPolityId'] });
      }
      for (const [index, seed] of scenario.statecraft.knowledgeSeeds.entries()) {
        if (!polityIds.has(seed.observerPolityId) || !factIds.has(seed.factId)) {
          ctx.addIssue({ code: 'custom', message: 'knowledge seed must reference a known observer and fact', path: ['statecraft', 'knowledgeSeeds', index] });
        }
        const fact = scenario.statecraft.intelligenceFacts.find((entry) => entry.factId === seed.factId);
        if (fact && fact.evidenceId !== seed.evidenceId) {
          ctx.addIssue({ code: 'custom', message: 'knowledge seed evidence must match authored fact evidence', path: ['statecraft', 'knowledgeSeeds', index, 'evidenceId'] });
        }
      }
    }
    if (scenario.diplomacy) {
      const relationPairs = new Set<string>();
      for (const [index, relation] of scenario.diplomacy.relations.entries()) {
        const [left, right] = relation.polities;
        if (left >= right || !polityIds.has(left) || !polityIds.has(right)) {
          ctx.addIssue({ code: 'custom', message: 'relation pair must contain two known polities in ascending order', path: ['diplomacy', 'relations', index, 'polities'] });
        }
        const key = `${left}|${right}`;
        if (relationPairs.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate relation pair ${key}`, path: ['diplomacy', 'relations', index] });
        relationPairs.add(key);
      }
      const routePairs = new Set<string>();
      for (const [index, route] of scenario.diplomacy.tradeRoutes.entries()) {
        const [left, right] = route.polities;
        if (left >= right || !polityIds.has(left) || !polityIds.has(right)) {
          ctx.addIssue({ code: 'custom', message: 'trade route pair must contain two known polities in ascending order', path: ['diplomacy', 'tradeRoutes', index, 'polities'] });
        }
        const key = `${left}|${right}`;
        if (routePairs.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate trade route pair ${key}`, path: ['diplomacy', 'tradeRoutes', index] });
        routePairs.add(key);
      }
    }
    const active = new Set<string>(scenario.activeResources);
    if (active.size !== scenario.activeResources.length) {
      ctx.addIssue({ code: 'custom', message: 'activeResources must be unique', path: ['activeResources'] });
    }
    const withParams = new Set(scenario.economy.resourceParams.map((p) => p.resource));
    for (const resource of active) {
      if (!withParams.has(resource as ResourceId)) {
        ctx.addIssue({
          code: 'custom',
          message: `active resource ${resource} has no authored accounting value / tax rate`,
          path: ['economy', 'resourceParams'],
        });
      }
    }
    const regionIds = new Set<string>();
    for (const [index, region] of scenario.regions.entries()) {
      if (regionIds.has(region.regionId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate region id ${region.regionId}`, path: ['regions', index] });
      }
      regionIds.add(region.regionId);
      if (!polityIds.has(region.controllerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} controller ${region.controllerId} is not a scenario polity`,
          path: ['regions', index, 'controllerId'],
        });
      }
      if (region.capacityCeiling !== undefined && region.capacityCeiling < region.baseMonthlyCapacity) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} capacityCeiling ${region.capacityCeiling} is below its starting capacity ${region.baseMonthlyCapacity}`,
          path: ['regions', index, 'capacityCeiling'],
        });
      }
      if (scenario.modules?.projects === true && region.capacityCeiling === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} needs a capacityCeiling because the projects module is enabled`,
          path: ['regions', index, 'capacityCeiling'],
        });
      }
      if (region.activity.kind === 'extraction' && !active.has(region.activity.resource)) {
        ctx.addIssue({
          code: 'custom',
          message: `region ${region.regionId} extracts ${region.activity.resource} which is not an active resource`,
          path: ['regions', index, 'activity'],
        });
      }
      if (region.activity.kind === 'processing') {
        for (const input of BASIC_GOODS_RECIPE.inputs) {
          if (!active.has(input.resource)) {
            ctx.addIssue({
              code: 'custom',
              message: `basic_goods input ${input.resource} is not an active resource`,
              path: ['regions', index, 'activity'],
            });
          }
        }
        if (!active.has(BASIC_GOODS_RECIPE.output)) {
          ctx.addIssue({
            code: 'custom',
            message: `basic_goods output ${BASIC_GOODS_RECIPE.output} is not an active resource`,
            path: ['regions', index, 'activity'],
          });
        }
      }
    }
    for (const [index, polity] of scenario.polities.entries()) {
      const seen = new Set<string>();
      for (const entry of polity.stockpile) {
        if (seen.has(entry.resource)) {
          ctx.addIssue({
            code: 'custom',
            message: `polity ${polity.id} stockpile lists ${entry.resource} twice`,
            path: ['polities', index, 'stockpile'],
          });
        }
        seen.add(entry.resource);
        if (!active.has(entry.resource)) {
          ctx.addIssue({
            code: 'custom',
            message: `polity ${polity.id} stockpile has inactive resource ${entry.resource}`,
            path: ['polities', index, 'stockpile'],
          });
        }
      }
    }
  });
export type EconScenario = z.infer<typeof econScenarioSchema>;

export function parseScenario(raw: unknown): EconScenario {
  return econScenarioSchema.parse(raw);
}
