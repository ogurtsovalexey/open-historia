import { z } from 'zod';
import type { WorldStateV2 } from '../world/schema.js';
import {
  effectKindSchema,
  processBasisPointsSchema,
  processStableIdSchema,
  type EffectKind,
} from './schema.js';

const evidenceIdSchema = z.string().regex(/^evidence:[a-z0-9][a-z0-9._-]{0,139}$/);
const processIdSchema = z.string().regex(/^process:[a-z0-9][a-z0-9._-]{0,139}$/);

/** AI/semantic resolver may select only a family and grounded target. */
export const semanticEffectSelectionSchema = z.object({
  kind: effectKindSchema,
  targetEntityRef: processStableIdSchema,
}).strict();
export type SemanticEffectSelection = z.infer<typeof semanticEffectSelectionSchema>;

const permanentEffectBaseSchema = z.object({
  targetEntityRef: processStableIdSchema,
  duration: z.literal('permanent'),
  stacking: z.literal('additive'),
  sourceProcessId: processIdSchema,
  sourceEvidenceIds: z.array(evidenceIdSchema).min(1),
  lowerBound: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  upperBound: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  delta: z.number().int().min(-1_000_000_000).max(1_000_000_000),
}).strict();

export const permanentEffectSchema = z.discriminatedUnion('kind', [
  permanentEffectBaseSchema.extend({
    kind: z.literal('capacity.modify'),
    parameter: z.enum(['fiscalBase', 'productiveCapacity']),
  }).strict(),
  permanentEffectBaseSchema.extend({
    kind: z.literal('supply-capacity.modify'),
    parameter: z.literal('supplyCapacity'),
  }).strict(),
]);
export type PermanentEffect = z.infer<typeof permanentEffectSchema>;

export type AppliedPermanentEffect = PermanentEffect & { before: number; after: number };

export class UnsupportedEffectMaterializationError extends Error {
  constructor(kind: EffectKind) {
    super(`Effect family ${kind} has no canonical WorldStateV2 writable input`);
    this.name = 'UnsupportedEffectMaterializationError';
  }
}

export function assertEffectFamiliesAllowed(
  selected: readonly EffectKind[],
  compatible: readonly EffectKind[],
): void {
  const allowed = new Set(compatible);
  for (const kind of selected) {
    if (!allowed.has(kind)) throw new Error(`Effect family ${kind} is not compatible with this process`);
  }
}

/**
 * Build an exact permanent effect from engine-owned values. Unknown families,
 * temporary effects and model-authored quantities never reach this boundary.
 */
export function materializePermanentEffect(input: unknown): PermanentEffect {
  const effect = permanentEffectSchema.parse(input);
  if (effect.lowerBound > effect.upperBound) throw new Error('Effect lowerBound exceeds upperBound');
  return effect;
}

export function applyPermanentEffect(
  state: WorldStateV2,
  input: PermanentEffect,
): { state: WorldStateV2; applied: AppliedPermanentEffect } {
  const effect = permanentEffectSchema.parse(input);
  const evidence = new Set(state.evidence.map((entry) => entry.evidenceId as string));
  for (const evidenceId of effect.sourceEvidenceIds) {
    if (!evidence.has(evidenceId)) throw new Error(`Effect references unknown evidence ${evidenceId}`);
  }
  const regionIndex = state.regions.findIndex((region) => region.regionId === effect.targetEntityRef);
  if (regionIndex < 0) throw new Error(`Effect target ${effect.targetEntityRef} is not a region`);
  const region = state.regions[regionIndex]!;
  const before = region[effect.parameter];
  const unbounded = before + effect.delta;
  if (!Number.isSafeInteger(unbounded)) throw new Error(`Effect ${effect.kind} exceeds safe integer range`);
  const after = Math.min(effect.upperBound, Math.max(effect.lowerBound, unbounded));
  const nextRegion = { ...region, [effect.parameter]: after };
  const regions = [...state.regions];
  regions[regionIndex] = nextRegion;
  return {
    state: { ...state, regions },
    applied: { ...effect, before, after },
  };
}

export function assertEffectFamilyMaterializable(kind: EffectKind): void {
  if (kind !== 'capacity.modify' && kind !== 'supply-capacity.modify') {
    throw new UnsupportedEffectMaterializationError(kind);
  }
}

export interface EffectMagnitudePolicy {
  baseDelta: number;
  minimum: number;
  maximum: number;
  maturityScaleBp: number;
}

/** Exact magnitude is deterministic engine policy, never part of semantic input. */
export function computeEffectDelta(policy: EffectMagnitudePolicy, maturityBp: number): number {
  const maturity = processBasisPointsSchema.parse(maturityBp);
  if (!Number.isSafeInteger(policy.baseDelta) || !Number.isSafeInteger(policy.minimum) || !Number.isSafeInteger(policy.maximum)) {
    throw new Error('Effect magnitude policy must contain safe integers');
  }
  const maturityScale = processBasisPointsSchema.parse(policy.maturityScaleBp);
  if (policy.minimum > policy.maximum) throw new Error('Effect magnitude policy bounds are inverted');
  const scaled = BigInt(policy.baseDelta) * BigInt(Math.min(maturity, maturityScale)) / 10000n;
  const bounded = scaled < BigInt(policy.minimum) ? BigInt(policy.minimum)
    : scaled > BigInt(policy.maximum) ? BigInt(policy.maximum) : scaled;
  const result = Number(bounded);
  if (!Number.isSafeInteger(result)) throw new Error('Computed effect delta exceeds safe integer range');
  return result;
}
