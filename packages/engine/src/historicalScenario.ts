import { z } from 'zod';
import { polityIdSchema, regionIdSchema, scenarioIdSchema, sourceIdSchema } from '@open-historia/domain';
import { ScenarioV2Validator, canonicalStringify } from '@open-historia/data-packs';
import type { ScenarioBundle } from '@open-historia/data-packs';
import { sha256OfString } from './canonical.js';
import { checkMapLink, parseMapLink } from './mapLink.js';
import type { MapLink } from './mapLink.js';
import { parseScenario, RESOURCE_CATALOG } from './scenario.js';
import type { EconScenario } from './scenario.js';

const estimateFields = {
  sourceRefs: z.array(sourceIdSchema).min(1),
  method: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  todo: z.string().min(1),
};

const nationalControlSchema = z.object({
  polityId: polityIdSchema,
  population: z.number().int().nonnegative(),
  workforce: z.number().int().nonnegative(),
  maxMobilizationBp: z.number().int().min(100).max(5000),
  treasury: z.number().int().nonnegative(),
  economicPower: z.number().int().nonnegative(),
  stockpile: z.partialRecord(z.enum(RESOURCE_CATALOG), z.number().int().nonnegative()),
  industrialCapacity: z.number().int().nonnegative(),
  infrastructureCapacity: z.number().int().nonnegative(),
  ...estimateFields,
}).strict();

const regionalControlSchema = z.object({
  regionId: regionIdSchema,
  population: z.number().int().nonnegative(),
  baseMonthlyCapacity: z.number().int().nonnegative(),
  infrastructureBp: z.number().int().min(0).max(10000),
  ...estimateFields,
}).strict();

export const historicalAuthoringSchema = z.object({
  schemaVersion: z.literal('open-historia-historical-authoring/1'),
  scenarioId: scenarioIdSchema,
  horizonDate: z.string().regex(/^\d{4}-\d{2}-01$/),
  nationalControls: z.array(nationalControlSchema).min(2),
  regionalControls: z.array(regionalControlSchema).min(1),
  causalAnchors: z.array(z.object({
    anchorId: z.string().regex(/^anchor:[a-z0-9][a-z0-9._-]*$/),
    polityId: polityIdSchema,
    interest: z.string().min(1),
    threats: z.array(z.string()), obligations: z.array(z.string()), redLines: z.array(z.string()),
    applicability: z.array(z.string()).min(1), invalidators: z.array(z.string()).min(1),
    sourceRefs: z.array(sourceIdSchema).min(1),
  }).strict()),
  milestones: z.array(z.object({
    milestoneId: z.string().regex(/^milestone:[a-z0-9][a-z0-9._-]*$/),
    points: z.number().int().positive(), description: z.string().min(1),
    evidenceKinds: z.array(z.string()).min(1), invalidators: z.array(z.string()).min(1),
  }).strict()),
}).strict();
export type HistoricalAuthoring = z.infer<typeof historicalAuthoringSchema>;

export interface HistoricalProjectionInput {
  bundle: ScenarioBundle;
  authoring: unknown;
  engineScenario: unknown;
  mapLink?: unknown;
}

export interface HistoricalProjection {
  scenario: EconScenario;
  mapLink?: MapLink;
  checksum: string;
}

/** Validates a checked-in projection; it never invents or rounds authored values. */
export function compileHistoricalProjection(input: HistoricalProjectionInput): HistoricalProjection {
  const validated = new ScenarioV2Validator().validateBundle(input.bundle);
  if (!validated.valid) throw new Error(`ScenarioV2 invalid: ${validated.errors.map((entry) => `${entry.path} ${entry.message}`).join('; ')}`);
  const authoring = historicalAuthoringSchema.parse(input.authoring);
  const scenario = parseScenario(input.engineScenario);
  if (scenario.label !== 'historical-projection') throw new Error('historical engine projection must use label historical-projection');
  if (scenario.scenarioId !== input.bundle.scenario.id || authoring.scenarioId !== input.bundle.scenario.id) throw new Error('scenario ids do not match');

  const sourceIds = new Set<string>(input.bundle.sources.map((entry) => entry.id));
  const assertSources = (refs: string[], target: string) => {
    const unknown = refs.filter((entry) => !sourceIds.has(entry));
    if (unknown.length) throw new Error(`${target} references unknown sources: ${unknown.join(', ')}`);
  };
  for (const entry of [...authoring.nationalControls, ...authoring.regionalControls]) assertSources(entry.sourceRefs, 'estimate');
  for (const anchor of authoring.causalAnchors) assertSources(anchor.sourceRefs, anchor.anchorId);

  const v2Polities = new Set(Object.keys(input.bundle.scenario.polities));
  const enginePolities = new Set(scenario.polities.map((entry) => entry.id));
  const controlPolities = new Set(authoring.nationalControls.map((entry) => entry.polityId));
  if (canonicalStringify([...v2Polities].sort()) !== canonicalStringify([...enginePolities].sort())
    || canonicalStringify([...v2Polities].sort()) !== canonicalStringify([...controlPolities].sort())) throw new Error('polity ids do not match');

  const v2Regions = new Set(input.bundle.scenario.regions.map((entry) => entry.id));
  const engineRegions = new Set(scenario.regions.map((entry) => entry.regionId));
  const controlRegions = new Set(authoring.regionalControls.map((entry) => entry.regionId));
  if (canonicalStringify([...v2Regions].sort()) !== canonicalStringify([...engineRegions].sort())
    || canonicalStringify([...v2Regions].sort()) !== canonicalStringify([...controlRegions].sort())) throw new Error('region ids do not match');

  for (const region of scenario.regions) {
    if (input.bundle.scenario.regionAssignments?.[region.regionId] !== region.controllerId) throw new Error(`ownership mismatch for ${region.regionId}`);
    const control = authoring.regionalControls.find((entry) => entry.regionId === region.regionId)!;
    if (control.population !== region.population || control.baseMonthlyCapacity !== region.baseMonthlyCapacity
      || control.infrastructureBp !== region.infrastructureBp) throw new Error(`regional totals mismatch for ${region.regionId}`);
  }
  for (const polity of scenario.polities) {
    const control = authoring.nationalControls.find((entry) => entry.polityId === polity.id)!;
    const regions = scenario.regions.filter((entry) => entry.controllerId === polity.id);
    const population = regions.reduce((sum, entry) => sum + entry.population, 0);
    const workforce = regions.reduce((sum, entry) => sum + Math.floor((entry.population * entry.workforceRateBp) / 10000), 0);
    const industrialCapacity = regions.reduce((sum, entry) => sum + entry.baseMonthlyCapacity, 0);
    const infrastructureCapacity = regions.reduce((sum, entry) => sum + entry.infrastructureBp, 0);
    const stockpile = Object.fromEntries(polity.stockpile.map((entry) => [entry.resource, entry.amount]));
    if (control.population !== population || control.workforce !== workforce || control.treasury !== polity.treasury
      || control.industrialCapacity !== industrialCapacity || control.infrastructureCapacity !== infrastructureCapacity
      || canonicalStringify(control.stockpile) !== canonicalStringify(stockpile)) throw new Error(`national totals mismatch for ${polity.id}`);
    const military = scenario.military?.polities.find((entry) => entry.polityId === polity.id);
    if (military && military.maxMobilizationBp !== control.maxMobilizationBp) throw new Error(`mobilization mismatch for ${polity.id}`);
  }

  const mapLink = input.mapLink === undefined ? undefined : parseMapLink(input.mapLink);
  if (mapLink) {
    const mismatches = checkMapLink(scenario, mapLink);
    if (mismatches.length) throw new Error(`map-link does not match projection: ${canonicalStringify(mismatches)}`);
  }
  return { scenario, ...(mapLink ? { mapLink } : {}), checksum: sha256OfString(canonicalStringify({ scenario, authoring, mapLink })) };
}
