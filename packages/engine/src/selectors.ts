/**
 * Region selectors: how a command addresses *which* regions it acts on.
 *
 * A command may name one region, or describe a group ("every region I control
 * whose activity is coal"). The ENGINE expands a description into concrete ids,
 * deterministically and in id order. That is deliberate: when free-text orders
 * arrive, the model produces a description and never a list of ids it guessed,
 * so a hallucinated region id is impossible by construction
 * (docs/canon/07-ai-boundary.md).
 */
import { z } from 'zod';
import { polityIdSchema, regionIdSchema } from '@open-historia/domain';
import type { PolityId, RegionId } from '@open-historia/domain';
import { activitiesOf, rawResourceIdSchema } from './scenario.js';
import type { EconRegionState, EconWorldState } from './state.js';

export const activityFilterSchema = z.union([
  z.object({ kind: z.literal('extraction'), resource: rawResourceIdSchema }).strict(),
  z.object({ kind: z.literal('processing') }).strict(),
]);
export type ActivityFilter = z.infer<typeof activityFilterSchema>;

export const regionSelectorSchema = z.union([
  z.object({ kind: z.literal('region'), regionId: regionIdSchema }).strict(),
  z
    .object({
      kind: z.literal('query'),
      /** Whose regions: the acting polity, or a named one. */
      controller: z.union([z.literal('self'), polityIdSchema]),
      activity: activityFilterSchema.optional(),
      /** Take at most this many, in region-id order, after filtering. */
      limit: z.number().int().positive().max(1000).optional(),
    })
    .strict(),
]);
export type RegionSelector = z.infer<typeof regionSelectorSchema>;

const matchesActivity = (region: EconRegionState, filter: ActivityFilter): boolean => {
  if (filter.kind === 'processing') return activitiesOf(region).some((entry) => entry.activity.kind === 'processing' && entry.allocationBp > 0);
  return activitiesOf(region).some((entry) => entry.activity.kind === 'extraction' && entry.activity.resource === filter.resource && entry.allocationBp > 0);
};

/**
 * Expand a selector against live state. Always returns regions in id order, so
 * the same selector yields the same ids for the same state — the tick depends
 * on that ordering when a scarce resource is handed out first-come-first-served.
 */
export function expandSelector(
  state: EconWorldState,
  selector: RegionSelector,
  actor: PolityId
): RegionId[] {
  if (selector.kind === 'region') {
    const found = state.regions.find((region) => region.regionId === selector.regionId);
    return found ? [found.regionId] : [];
  }
  const controller = selector.controller === 'self' ? actor : selector.controller;
  const matched = state.regions
    .filter((region) => region.controllerId === controller)
    .filter((region) => (selector.activity ? matchesActivity(region, selector.activity) : true))
    .map((region) => region.regionId);
  // state.regions is already sorted by id (state.ts#initState), and every step
  // above preserves order; sort anyway so the guarantee survives a refactor.
  matched.sort();
  return selector.limit === undefined ? matched : matched.slice(0, selector.limit);
}

/** Human-readable rendering of a selector, for previews and rejection detail. */
export function describeSelector(selector: RegionSelector): string {
  if (selector.kind === 'region') return selector.regionId;
  const whose = selector.controller === 'self' ? 'own' : `${selector.controller}'s`;
  const what =
    selector.activity === undefined
      ? 'regions'
      : selector.activity.kind === 'processing'
        ? 'processing regions'
        : `${selector.activity.resource} regions`;
  const cap = selector.limit === undefined ? '' : ` (first ${selector.limit})`;
  return `${whose} ${what}${cap}`;
}
