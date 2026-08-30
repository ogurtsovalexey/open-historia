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
