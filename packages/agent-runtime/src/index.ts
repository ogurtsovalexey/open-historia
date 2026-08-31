import { z } from 'zod';
import { commandIdSchema, polityIdSchema, worldRevisionIdSchema } from '@open-historia/domain';
import {
  investInRegionCommandSchema,
  potentialOutput,
  runTurn,
  sha256OfString,
  type EconWorldState,
  type InvestInRegionCommand,
  type PolityLedger,
} from '@open-historia/engine';

export const MAX_POLITIES_PER_BATCH = 12;
export const MAX_BATCHES_PER_MONTH = 2;
export const MAX_POLITIES_PER_MONTH = MAX_POLITIES_PER_BATCH * MAX_BATCHES_PER_MONTH;
export const MAX_POLITY_BRIEF_CHARS = 1600;
export const MAX_BATCH_BRIEF_CHARS = 24000;

export const strategyIntentSchema = z.enum([
  'invest-food', 'invest-extraction', 'invest-processing', 'conserve',
]);

export const opponentDecisionSchema = z.object({
  polityId: polityIdSchema,
  intent: strategyIntentSchema,
  rationale: z.string().max(240),
  command: investInRegionCommandSchema.nullable(),
}).strict();
export type OpponentDecision = z.infer<typeof opponentDecisionSchema>;

export const opponentBatchResultSchema = z.object({
  decisions: z.array(opponentDecisionSchema).max(MAX_POLITIES_PER_BATCH),
}).strict();
export type OpponentBatchResult = z.infer<typeof opponentBatchResultSchema>;

export const interpretedActionSchema = z.object({
  actionId: z.string().min(1).max(200),
  summary: z.string().min(1).max(240),
  command: investInRegionCommandSchema.nullable(),
  disposition: z.enum(['command', 'report', 'unsupported', 'ambiguous']),
}).strict().refine(
  (value) => (value.disposition === 'command') === (value.command !== null),
  { message: 'command disposition must carry exactly one command' },
);

export const playerOrderInterpretationSchema = z.object({
  actions: z.array(interpretedActionSchema),
}).strict();
export type PlayerOrderInterpretation = z.infer<typeof playerOrderInterpretationSchema>;

export const playerReportResultSchema = z.object({
  reports: z.array(z.object({
    actionId: z.string().min(1).max(200),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(2400),
  }).strict()).max(16),
}).strict();
export type PlayerReportResult = z.infer<typeof playerReportResultSchema>;

export const agentPolityStateSchema = z.object({
  polityId: polityIdSchema,
  lastDecisionMonth: z.string(),
  lastBriefFingerprint: z.string(),
  intent: strategyIntentSchema,
  rationale: z.string().max(240),
  source: z.enum(['model', 'fallback']),
  lastOutcome: z.enum(['accepted', 'rejected', 'noop']),
  triggerFingerprint: z.string(),
}).strict();

export const agentStateSchema = z.object({
  schemaVersion: z.literal('open-historia-agent-state/1'),
  polities: z.array(agentPolityStateSchema),
  consumedActionIds: z.array(z.string().min(1).max(200)).default([]),
}).strict();
export type AgentState = z.infer<typeof agentStateSchema>;
export const EMPTY_AGENT_STATE: AgentState = {
  schemaVersion: 'open-historia-agent-state/1', polities: [], consumedActionIds: [],
};

export interface InvestmentPreview {
  regionId: string;
  name: string;
  activity: string;
  infrastructureBp: number;
  potential: number;
  taxDelta: number;
  goodsDelta: number;
  foodShortfallReduction: number;
  productionDelta: number;
}

export interface PolityDecisionBrief {
  polityId: string;
  name: string;
  month: string;
  revision: string;
  treasury: number;
  stockpile: Record<string, number>;
  foodShortfall: number;
  limitingInputs: string[];
  scenarioNote: string;
  tags: string[];
  previousStrategy: string;
  candidates: InvestmentPreview[];
}

export interface AgentBatch {
  batchId: string;
  month: string;
  baseRevision: string;
  polityIds: string[];
  briefs: PolityDecisionBrief[];
  characterCount: number;
}

const difficultyCandidates: Record<string, number> = {
  'very-easy': 4, easy: 6, medium: 8, hard: 10, 'very-hard': 12, impossible: 12,
};

export const normalizeAgentDifficulty = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'standard' || !Object.hasOwn(difficultyCandidates, normalized)) return 'medium';
  return normalized;
};

export const commandBudgetFor = (difficulty: string, count: number): number => {
  const normalized = normalizeAgentDifficulty(difficulty);
  if (normalized === 'very-easy') return Math.ceil(count / 3);
  if (normalized === 'easy') return Math.ceil((count * 2) / 3);
  return count;
};

const ledgerFor = (ledger: { polities: PolityLedger[] } | null | undefined, polityId: string) =>
  ledger?.polities.find((entry) => entry.polityId === polityId);

const totals = (ledger: PolityLedger | undefined) => ({
  tax: ledger?.taxTotal ?? 0,
  goods: ledger?.goods?.actual ?? 0,
  foodShortfall: ledger?.food.shortfall ?? 0,
  production: (ledger?.production ?? []).reduce((sum, row) => sum + row.total, 0),
});

const deterministicUuid = (seed: string): string => {
  const hex = sha256OfString(seed).slice('sha256:'.length, 'sha256:'.length + 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16] ?? '0', 16) % 4] ?? '8';
  const raw = hex.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
};

const activityName = (region: EconWorldState['regions'][number]): string =>
  region.activity.kind === 'processing' ? 'processing' : `extraction:${region.activity.resource}`;

export function previewInvestments(
  state: EconWorldState,
  polityId: string,
  lastLedger: { polities: PolityLedger[] } | null | undefined,
  candidateLimit: number,
  spend = 100,
): InvestmentPreview[] {
  const polity = state.polities.find((entry) => entry.id === polityId);
  if (!polity || polity.treasury < spend) return [];
  const baseline = runTurn(state, { commands: [] }).result.ledger;
  const baselineTotals = totals(ledgerFor(baseline, polityId));
  const previews = state.regions
    .filter((region) => region.controllerId === polityId && region.infrastructureBp < 10000)
    .map((region) => {
      const command: InvestInRegionCommand = investInRegionCommandSchema.parse({
        kind: 'economy.invest-region',
        commandId: deterministicUuid(`${state.revision}|${state.month}|${polityId}|${region.regionId}|preview`),
        actorPolityId: polityId,
        targetRegionId: region.regionId,
        expectedRevision: state.revision,
        effectiveMonth: state.month,
        spend,
      });
      const result = runTurn(state, { commands: [command] }).result;
      const candidateTotals = totals(ledgerFor(result.ledger, polityId));
      const workforce = Math.floor((region.population * region.workforceRateBp) / 10000);
      return {
        regionId: region.regionId,
        name: region.displayName.en,
        activity: activityName(region),
        infrastructureBp: region.infrastructureBp,
        potential: potentialOutput(region, workforce),
        taxDelta: candidateTotals.tax - baselineTotals.tax,
        goodsDelta: candidateTotals.goods - baselineTotals.goods,
        foodShortfallReduction: baselineTotals.foodShortfall - candidateTotals.foodShortfall,
        productionDelta: candidateTotals.production - baselineTotals.production,
      };
    });
  previews.sort((left, right) =>
    right.foodShortfallReduction - left.foodShortfallReduction
    || right.goodsDelta - left.goodsDelta
    || right.taxDelta - left.taxDelta
    || right.productionDelta - left.productionDelta
    || left.regionId.localeCompare(right.regionId));
  void lastLedger;
  return previews.slice(0, candidateLimit);
}

const triggerFingerprintFor = (ledger: PolityLedger | undefined, treasury: number): string => {
  const food = (ledger?.food.shortfall ?? 0) > 0 ? 'shortfall' : 'fed';
  const limiting = [...(ledger?.goods?.limitingInputs ?? [])].sort().join(',');
  const affordable = treasury >= 100 ? 'afford' : 'poor';
  return `${food}|${limiting}|${affordable}`;
};

export function selectOpponentPolities(
  state: EconWorldState,
  playerPolityId: string,
  agentState: AgentState,
  lastLedger?: { polities: PolityLedger[] } | null,
): string[] {
  const previous = new Map(agentState.polities.map((entry) => [entry.polityId, entry]));
  const scored = state.polities
    .filter((polity) => polity.id !== playerPolityId)
    .map((polity) => {
      const old = previous.get(polity.id);
      const fingerprint = triggerFingerprintFor(ledgerFor(lastLedger, polity.id), polity.treasury);
      const triggered = !old || old.lastOutcome === 'rejected' || old.source === 'fallback'
        || old.triggerFingerprint !== fingerprint;
      return { id: polity.id, triggered, month: old?.lastDecisionMonth ?? '' };
    });
  scored.sort((left, right) => Number(right.triggered) - Number(left.triggered)
    || left.month.localeCompare(right.month)
    || left.id.localeCompare(right.id));
  return scored.slice(0, MAX_POLITIES_PER_MONTH).map((entry) => entry.id);
}

export function buildPolityBrief(
  state: EconWorldState,
  polityId: string,
  options: {
    difficulty?: string;
    lastLedger?: { polities: PolityLedger[] } | null;
    agentState?: AgentState;
    scenarioNote?: string;
    tags?: string[];
  } = {},
): PolityDecisionBrief {
  const polity = state.polities.find((entry) => entry.id === polityId);
  if (!polity) throw new Error(`unknown polity ${polityId}`);
  const ledger = ledgerFor(options.lastLedger, polityId);
  const previous = options.agentState?.polities.find((entry) => entry.polityId === polityId);
  const candidateLimit = difficultyCandidates[normalizeAgentDifficulty(options.difficulty ?? 'medium')] ?? 8;
  const brief: PolityDecisionBrief = {
    polityId,
    name: polity.displayName.en,
    month: state.month,
    revision: state.revision,
    treasury: polity.treasury,
    stockpile: Object.fromEntries(polity.stockpile.map((entry) => [entry.resource, entry.amount])),
    foodShortfall: ledger?.food.shortfall ?? 0,
    limitingInputs: [...(ledger?.goods?.limitingInputs ?? [])].sort(),
    scenarioNote: String(options.scenarioNote ?? '').slice(0, 320),
    tags: [...(options.tags ?? [])].sort().slice(0, 12),
    previousStrategy: previous ? `${previous.intent}: ${previous.rationale}`.slice(0, 300) : '',
    candidates: previewInvestments(state, polityId, options.lastLedger, candidateLimit),
  };
  const serialized = JSON.stringify(brief);
  if (serialized.length > MAX_POLITY_BRIEF_CHARS) {
    brief.scenarioNote = brief.scenarioNote.slice(0, 80);
    brief.previousStrategy = brief.previousStrategy.slice(0, 80);
    while (JSON.stringify(brief).length > MAX_POLITY_BRIEF_CHARS && brief.candidates.length > 1) brief.candidates.pop();
  }
  if (JSON.stringify(brief).length > MAX_POLITY_BRIEF_CHARS) throw new Error(`brief for ${polityId} exceeds character budget`);
  return brief;
}

export function buildOpponentBatches(
  state: EconWorldState,
  polityIds: string[],
  build: (polityId: string) => PolityDecisionBrief,
): AgentBatch[] {
  const selected = polityIds.slice(0, MAX_POLITIES_PER_MONTH);
  const batches: AgentBatch[] = [];
  for (let index = 0; index < selected.length; index += MAX_POLITIES_PER_BATCH) {
    const ids = selected.slice(index, index + MAX_POLITIES_PER_BATCH);
    const briefs = ids.map(build);
    const characterCount = JSON.stringify(briefs).length;
    if (characterCount > MAX_BATCH_BRIEF_CHARS) throw new Error('opponent batch exceeds character budget');
    batches.push({
      batchId: sha256OfString(`${state.revision}|${state.month}|${ids.join('|')}`),
      month: state.month,
      baseRevision: state.revision,
      polityIds: ids,
      briefs,
      characterCount,
    });
  }
  return batches;
}

export function validateOpponentBatch(
  raw: unknown,
  batch: AgentBatch,
  difficulty = 'medium',
): OpponentBatchResult {
  const parsed = opponentBatchResultSchema.parse(raw);
  const expected = [...batch.polityIds].sort();
  const actual = parsed.decisions.map((entry) => entry.polityId).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('batch must decide every and only requested polity');
  const commandCount = parsed.decisions.filter((entry) => entry.command !== null).length;
  if (commandCount > commandBudgetFor(difficulty, parsed.decisions.length)) throw new Error('difficulty command budget exceeded');
  const briefById = new Map(batch.briefs.map((entry) => [entry.polityId, entry]));
  for (const decision of parsed.decisions) {
    if (!decision.command) continue;
    const brief = briefById.get(decision.polityId)!;
    if (decision.command.actorPolityId !== decision.polityId) throw new Error('opponent command actor mismatch');
    if (decision.command.expectedRevision !== batch.baseRevision || decision.command.effectiveMonth !== batch.month) {
      throw new Error('opponent command revision or month mismatch');
    }
    if (!brief.candidates.some((entry) => entry.regionId === decision.command?.targetRegionId)) {
      throw new Error('opponent command target was not in its bounded brief');
    }
  }
  return parsed;
}

export function buildFallbackBatch(state: EconWorldState, batch: AgentBatch): OpponentBatchResult {
  return {
    decisions: batch.briefs.map((brief) => {
      const candidate = brief.candidates.find((entry) =>
        entry.foodShortfallReduction > 0 || entry.goodsDelta > 0 || entry.taxDelta > 0 || entry.productionDelta > 0);
      const command = candidate ? investInRegionCommandSchema.parse({
        kind: 'economy.invest-region',
        commandId: commandIdSchema.parse(deterministicUuid(`${state.revision}|${state.month}|${brief.polityId}|fallback`)),
        actorPolityId: brief.polityId,
        targetRegionId: candidate.regionId,
        expectedRevision: worldRevisionIdSchema.parse(state.revision),
        effectiveMonth: state.month,
        spend: 100,
      }) : null;
      return {
        polityId: polityIdSchema.parse(brief.polityId),
        intent: command ? 'invest-extraction' as const : 'conserve' as const,
        rationale: command ? 'Deterministic preview fallback selected the strongest immediate improvement.' : 'No positive affordable preview was available.',
        command,
      };
    }),
  };
}
