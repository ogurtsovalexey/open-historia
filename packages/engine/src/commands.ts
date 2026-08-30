/**
 * Typed player commands — the ONLY input surface for player intent.
 * A future free-text interpreter (LLM) must emit JSON valid against
 * `econCommandSchema`; the engine itself never sees prose and never lets a
 * model set numeric outcomes. Schema-level checks are structural only;
 * semantic acceptance (ownership, treasury, revision) happens in the resolver
 * so every refusal is a typed rejection event, not a parse error.
 */
import { z } from 'zod';
import {
  commandIdSchema,
  gameDateSchema,
  polityIdSchema,
  regionIdSchema,
  worldRevisionIdSchema,
} from '@open-historia/domain';

export const investInRegionCommandSchema = z
  .object({
    kind: z.literal('economy.invest-region'),
    commandId: commandIdSchema,
    actorPolityId: polityIdSchema,
    targetRegionId: regionIdSchema,
    /**
     * Optional in offline fixture files (a static file cannot know a content
     * hash in advance); the pipeline fills in the current revision. Any
     * interactive or LLM-produced command MUST carry it explicitly.
     */
    expectedRevision: worldRevisionIdSchema.optional(),
    effectiveMonth: gameDateSchema,
    /** Whole gold. Positivity is a semantic check → typed rejection. */
    spend: z.number().int(),
  })
  .strict();
export type InvestInRegionCommand = z.infer<typeof investInRegionCommandSchema>;

export const econCommandSchema = z.discriminatedUnion('kind', [
  investInRegionCommandSchema,
]);
export type EconCommand = z.infer<typeof econCommandSchema>;

export const turnCommandsFileSchema = z
  .object({
    commands: z.array(econCommandSchema),
  })
  .strict();
export type TurnCommandsFile = z.infer<typeof turnCommandsFileSchema>;

export const REJECTION_REASONS = [
  'unknown-actor',
  'unknown-region',
  'foreign-target',
  'wrong-month',
  'stale-revision',
  'invalid-amount',
  'insufficient-treasury',
  'command-limit',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface CommandRejection {
  command: EconCommand;
  reason: RejectionReason;
  detail: string;
}

export function parseTurnCommands(raw: unknown): TurnCommandsFile {
  return turnCommandsFileSchema.parse(raw);
}

export const EMPTY_TURN_COMMANDS: TurnCommandsFile = { commands: [] };
