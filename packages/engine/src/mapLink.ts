/**
 * Binding between engine regions and the game map's regions.
 *
 * The app owns map geometry and renders ownership from
 * `regionOwnershipOverrides` — a map region id (GADM style, e.g. `AUT.3_1`)
 * to an owner *name*. The engine owns numbers and speaks branded ids
 * (`region:gadm:AUT.3_1`). This module is the only place that knows both, so
 * neither side has to learn the other's identifiers. See
 * docs/canon/04-economy-slice.md, "Map linkage".
 */
import { z } from 'zod';
import { polityIdSchema, regionIdSchema } from '@open-historia/domain';
import type { PolityId, RegionId } from '@open-historia/domain';
import type { EconScenario } from './scenario.js';

export const MAP_LINK_SCHEMA_VERSION = 'open-historia-engine-map-link/2';
export const LEGACY_MAP_LINK_SCHEMA_VERSION = 'open-historia-engine-map-link/1';

/** Map region ids are opaque to the engine; only the shape is constrained. */
const mapRegionIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/, 'invalid map region id');

const commonMapLinkFields = {
  dataset: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'invalid dataset slug'),
  note: z.string().optional(),
  polityOwnerNames: z.record(polityIdSchema, z.string().min(1)),
};

const legacyMapLinkSchema = z.object({
  schemaVersion: z.literal(LEGACY_MAP_LINK_SCHEMA_VERSION),
  ...commonMapLinkFields,
  regions: z.array(z.object({
    engineRegionId: regionIdSchema,
    mapRegionId: mapRegionIdSchema,
    mapName: z.string().min(1).optional(),
  }).strict()).min(1),
}).strict().superRefine((link, ctx) => {
  const engineIds = new Set<string>();
  const mapIds = new Set<string>();
  for (const [index, entry] of link.regions.entries()) {
    if (engineIds.has(entry.engineRegionId)) ctx.addIssue({ code: 'custom', message: `duplicate engine region ${entry.engineRegionId}`, path: ['regions', index] });
    if (mapIds.has(entry.mapRegionId)) ctx.addIssue({ code: 'custom', message: `duplicate map region ${entry.mapRegionId}`, path: ['regions', index] });
    engineIds.add(entry.engineRegionId); mapIds.add(entry.mapRegionId);
    const expected = `region:${link.dataset}:${entry.mapRegionId}`;
    if (entry.engineRegionId !== expected) ctx.addIssue({ code: 'custom', message: `engine region ${entry.engineRegionId} does not match dataset+map id (${expected})`, path: ['regions', index, 'engineRegionId'] });
  }
  const names = Object.values(link.polityOwnerNames);
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'polity owner names must be unique', path: ['polityOwnerNames'] });
});

export const mapLinkV2Schema = z
  .object({
    schemaVersion: z.literal(MAP_LINK_SCHEMA_VERSION),
    ...commonMapLinkFields,
    regions: z
      .array(
        z
          .object({
            engineRegionId: regionIdSchema,
            mapRegionIds: z.array(mapRegionIdSchema).min(1),
            mapName: z.string().min(1).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict()
  .superRefine((link, ctx) => {
    const engineIds = new Set<string>();
    const mapIds = new Set<string>();
    for (const [index, entry] of link.regions.entries()) {
      if (engineIds.has(entry.engineRegionId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate engine region ${entry.engineRegionId}`, path: ['regions', index] });
      }
      engineIds.add(entry.engineRegionId);
      for (const [mapIndex, mapRegionId] of entry.mapRegionIds.entries()) {
        if (mapIds.has(mapRegionId)) {
          ctx.addIssue({ code: 'custom', message: `duplicate map region ${mapRegionId}`, path: ['regions', index, 'mapRegionIds', mapIndex] });
        }
        mapIds.add(mapRegionId);
      }
    }
    const names = Object.values(link.polityOwnerNames);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', message: 'polity owner names must be unique', path: ['polityOwnerNames'] });
    }
  });
export type MapLink = z.infer<typeof mapLinkV2Schema>;

export const mapLinkSchema = z.union([legacyMapLinkSchema, mapLinkV2Schema]);

export function parseMapLink(raw: unknown): MapLink {
  const parsed = mapLinkSchema.parse(raw);
  if (parsed.schemaVersion === MAP_LINK_SCHEMA_VERSION) return parsed;
  return {
    schemaVersion: MAP_LINK_SCHEMA_VERSION,
    dataset: parsed.dataset,
    ...(parsed.note ? { note: parsed.note } : {}),
    polityOwnerNames: parsed.polityOwnerNames,
    regions: parsed.regions.map((entry) => ({
      engineRegionId: entry.engineRegionId,
      mapRegionIds: [entry.mapRegionId],
      ...(entry.mapName ? { mapName: entry.mapName } : {}),
    })),
  };
}

export interface MapLinkMismatch {
  kind: 'region-not-linked' | 'link-has-unknown-region' | 'polity-not-named';
  id: string;
}

/** Every scenario region must be linked, and every polity must have a map name. */
export function checkMapLink(scenario: EconScenario, link: MapLink): MapLinkMismatch[] {
  const linked = new Set(link.regions.map((entry) => entry.engineRegionId as string));
  const scenarioRegions = new Set(scenario.regions.map((region) => region.regionId as string));
  const mismatches: MapLinkMismatch[] = [];
  for (const region of scenario.regions) {
    if (!linked.has(region.regionId)) mismatches.push({ kind: 'region-not-linked', id: region.regionId });
  }
  for (const entry of link.regions) {
    if (!scenarioRegions.has(entry.engineRegionId)) {
      mismatches.push({ kind: 'link-has-unknown-region', id: entry.engineRegionId });
    }
  }
  for (const polity of scenario.polities) {
    if (!link.polityOwnerNames[polity.id]) mismatches.push({ kind: 'polity-not-named', id: polity.id });
  }
  return mismatches;
}

/**
 * Ownership projection the app can apply directly: map region id -> owner name.
 * Built from live engine state, so it is correct after transfers too.
 */
export function buildOwnershipOverrides(
  link: MapLink,
  regions: ReadonlyArray<{ regionId: RegionId; controllerId: PolityId }>
): Record<string, string> {
  const mapIdsOf = new Map(link.regions.map((entry) => [entry.engineRegionId as string, entry.mapRegionIds]));
  const overrides: Record<string, string> = {};
  for (const region of regions) {
    const mapRegionIds = mapIdsOf.get(region.regionId);
    if (!mapRegionIds) continue;
    const ownerName = link.polityOwnerNames[region.controllerId];
    if (!ownerName) continue;
    for (const mapRegionId of mapRegionIds) overrides[mapRegionId] = ownerName;
  }
  return overrides;
}

/** Reverse lookup for map clicks: map region id -> engine region id. */
export function engineRegionForMapRegion(link: MapLink, mapRegionId: string): RegionId | undefined {
  return link.regions.find((entry) => entry.mapRegionIds.includes(mapRegionId))?.engineRegionId;
}
