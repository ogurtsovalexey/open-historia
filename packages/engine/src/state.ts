/**
 * Engine world state: the single source of truth for the economy slice.
 * Self-contained (embeds the authored economy parameters) so one state object
 * plus one commands file fully determines the next state — no scenario lookups
 * at tick time and nothing hidden from the revision checksum.
 */
import { z } from 'zod';
import type { PolityId, RegionId, WorldRevisionId } from '@open-historia/domain';
import {
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  scenarioIdSchema,
  worldRevisionIdSchema,
} from '@open-historia/domain';
import type { EconScenario } from './scenario.js';
import {
  economyParamsSchema,
  modulesSchema,
  regionActivitySchema,
  resourceIdSchema,
} from './scenario.js';
import type { ModuleName } from './scenario.js';
import { stateChecksum } from './canonical.js';

const nonNegInt = z.number().int().nonnegative();
const bpSchema = z.number().int().min(0).max(10000);
const displayNameSchema = z.object({ en: z.string().min(1), ru: z.string().min(1) }).strict();

export const econRegionStateSchema = z
  .object({
    regionId: regionIdSchema,
    controllerId: polityIdSchema,
    displayName: displayNameSchema,
    activity: regionActivitySchema,
    population: nonNegInt,
    annualBirthRateBp: bpSchema,
    annualDeathRateBp: bpSchema,
    /** Deterministic division remainders carried between months (§5). */
    birthRemainder: nonNegInt,
    deathRemainder: nonNegInt,
    workforceRateBp: bpSchema,
    infrastructureBp: bpSchema,
    damageBp: bpSchema,
    baseMonthlyCapacity: nonNegInt,
    outputPerWorker: nonNegInt,
    /** Present only when construction can raise this region's capacity. */
    capacityCeiling: nonNegInt.optional(),
  })
  .strict();
export type EconRegionState = z.infer<typeof econRegionStateSchema>;

export const stockEntrySchema = z
  .object({ resource: resourceIdSchema, amount: nonNegInt })
  .strict();
export type StockEntry = z.infer<typeof stockEntrySchema>;

export const econPolityStateSchema = z
  .object({
    id: polityIdSchema,
    displayName: displayNameSchema,
    treasury: nonNegInt,
    /** National Stockpile, sorted by resource id, one entry per active resource. */
    stockpile: z.array(stockEntrySchema),
  })
  .strict();
export type EconPolityState = z.infer<typeof econPolityStateSchema>;

export const ECON_STATE_SCHEMA_VERSION = 'open-historia-engine-econ/1';

export const econWorldStateSchema = z
  .object({
    schemaVersion: z.literal(ECON_STATE_SCHEMA_VERSION),
    scenarioId: scenarioIdSchema,
    label: z.literal('development-test'),
    /** First day of the month this state is valid for (the NEXT month to resolve). */
    month: gameDateSchema,
    /** Number of resolved months since scenario start. */
    turn: nonNegInt,
    activeResources: z.array(resourceIdSchema).min(1),
    /**
     * Absent means every optional mechanic is off. Absence is load-bearing: a
     * scenario that enables nothing serialises exactly as it did before modules
     * existed, so its recorded revisions stay valid.
     */
    modules: modulesSchema.optional(),
    economy: economyParamsSchema,
    /** Sorted by polity id. */
    polities: z.array(econPolityStateSchema).min(2),
    /** Sorted by region id. */
    regions: z.array(econRegionStateSchema).min(1),
    /** Content-addressed: sha256 of the canonical state without this field. */
    revision: worldRevisionIdSchema,
  })
  .strict();
export type EconWorldState = z.infer<typeof econWorldStateSchema>;

export function parseWorldState(raw: unknown): EconWorldState {
  const state = econWorldStateSchema.parse(raw);
  const expected = stateChecksum(state);
  if (state.revision !== expected) {
    throw new Error(
      `world state revision mismatch: recorded ${state.revision}, canonical content hashes to ${expected}`
    );
  }
  return state;
}

function sortedStockpile(entries: StockEntry[], activeResources: string[]): StockEntry[] {
  const byResource = new Map(entries.map((entry) => [entry.resource, entry.amount]));
  return [...activeResources]
    .sort()
    .map((resource) => ({
      resource: resource as StockEntry['resource'],
      amount: byResource.get(resource as StockEntry['resource']) ?? 0,
    }));
}

/** Deterministically build the starting world state from a validated scenario. */
export function initState(scenario: EconScenario): EconWorldState {
  const enabledModules = scenario.modules
    ? Object.fromEntries(
        Object.entries(scenario.modules)
          .filter(([, enabled]) => enabled === true)
          .sort(([left], [right]) => (left < right ? -1 : 1))
      )
    : {};
  const base = {
    schemaVersion: ECON_STATE_SCHEMA_VERSION,
    scenarioId: scenario.scenarioId,
    label: scenario.label,
    month: scenario.startMonth,
    turn: 0,
    activeResources: [...scenario.activeResources].sort(),
    ...(Object.keys(enabledModules).length > 0 ? { modules: enabledModules } : {}),
    economy: {
      ...scenario.economy,
      resourceParams: [...scenario.economy.resourceParams].sort((a, b) =>
        a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0
      ),
    },
    polities: [...scenario.polities]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((polity) => ({
        id: polity.id,
        displayName: polity.displayName,
        treasury: polity.treasury,
        stockpile: sortedStockpile(polity.stockpile, scenario.activeResources),
      })),
    regions: [...scenario.regions]
      .sort((a, b) => (a.regionId < b.regionId ? -1 : 1))
      .map((region) => ({
        ...region,
        birthRemainder: 0,
        deathRemainder: 0,
      })),
  };
  const withRevision = { ...base, revision: 'pending' } as EconWorldState;
  return { ...withRevision, revision: stateChecksum(withRevision) as WorldRevisionId };
}

export function getPolity(state: EconWorldState, id: PolityId): EconPolityState | undefined {
  return state.polities.find((polity) => polity.id === id);
}

export function getRegion(state: EconWorldState, id: RegionId): EconRegionState | undefined {
  return state.regions.find((region) => region.regionId === id);
}

export function getStock(polity: EconPolityState, resource: StockEntry['resource']): number {
  return polity.stockpile.find((entry) => entry.resource === resource)?.amount ?? 0;
}

/** Whether an optional mechanic runs for this world. */
export function moduleEnabled(state: EconWorldState, module: ModuleName): boolean {
  return state.modules?.[module] === true;
}

/** YYYY-MM-DD plus one calendar month, day clamped — no Date object, fully deterministic. */
export function addMonth(date: string): string {
  const [yearText, monthText, dayText] = date.split('-');
  let year = Number(yearText);
  let month = Number(monthText) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = lengths[month - 1];
  const day = Math.min(Number(dayText), maxDay);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}
