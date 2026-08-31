import { z } from 'zod';
import { commandIdSchema, polityIdSchema, worldRevisionIdSchema } from '@open-historia/domain';
import {
  investInRegionCommandSchema,
  diplomacyCommandSchema,
  statecraftCommandSchema,
  politicsCommandSchema,
  potentialOutput,
  runTurn,
  sha256OfString,
  type EconWorldState,
  type InvestInRegionCommand,
  type PolityLedger,
} from '@open-historia/engine';
import type { DiplomacyCommand } from '@open-historia/engine';
import type { StatecraftCommand } from '@open-historia/engine';
import type { PoliticsCommand } from '@open-historia/engine';

export const MAX_POLITIES_PER_BATCH = 12;
export const MAX_BATCHES_PER_MONTH = 2;
export const MAX_POLITIES_PER_MONTH = MAX_POLITIES_PER_BATCH * MAX_BATCHES_PER_MONTH;
export const MAX_POLITY_BRIEF_CHARS = 1600;
export const MAX_BATCH_BRIEF_CHARS = 24000;
export const MAX_STRATEGIC_POLITIES = 6;

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

export const opponentDiplomacyDecisionSchema = z.object({
  polityId: polityIdSchema,
  intent: z.enum(['propose', 'counter', 'accept', 'reject', 'terminate', 'set-policy', 'issue-bonds', 'restructure', 'start-project', 'update-project', 'cancel-project', 'concede', 'repress', 'refuse', 'hold']),
  rationale: z.string().max(320),
  command: z.union([diplomacyCommandSchema, statecraftCommandSchema, politicsCommandSchema]).nullable(),
}).strict().superRefine((decision, ctx) => {
  const expectedKind = decision.intent === 'propose' ? 'diplomacy.propose'
    : decision.intent === 'counter' ? 'diplomacy.counter'
      : decision.intent === 'accept' || decision.intent === 'reject' ? 'diplomacy.respond'
        : decision.intent === 'terminate' ? 'diplomacy.terminate-agreement'
          : decision.intent === 'set-policy' ? 'finance.set-policy'
            : decision.intent === 'issue-bonds' ? 'finance.issue-bonds'
              : decision.intent === 'restructure' ? 'finance.restructure'
                : decision.intent === 'start-project' ? 'project.start'
                  : decision.intent === 'update-project' ? 'project.update'
                    : decision.intent === 'cancel-project' ? 'project.cancel'
                      : decision.intent === 'concede' || decision.intent === 'repress' || decision.intent === 'refuse' ? 'politics.respond'
                      : null;
  if ((decision.command?.kind ?? null) !== expectedKind) {
    ctx.addIssue({ code: 'custom', path: ['command'], message: 'intent and diplomacy command must match' });
  }
  if (decision.command?.kind === 'diplomacy.respond' && decision.command.response !== decision.intent) {
    ctx.addIssue({ code: 'custom', path: ['command', 'response'], message: 'response and intent must match' });
  }
});

export const opponentDiplomacyBatchResultSchema = z.object({
  decisions: z.array(opponentDiplomacyDecisionSchema).max(MAX_STRATEGIC_POLITIES),
}).strict();
export type OpponentDiplomacyBatchResult = z.infer<typeof opponentDiplomacyBatchResultSchema>;

export interface DiplomacyPolityBrief {
  polityId: string;
  name: string;
  month: string;
  revision: string;
  treasury: number;
  stockpile: Record<string, number>;
  relations: Array<{ polityId: string; opinion: number; trust: number; threat: number }>;
  proposals: Array<Record<string, unknown>>;
  agreements: Array<Record<string, unknown>>;
  allowedAgreementTypes: string[];
  allowedTradeResources: string[];
  finance: Record<string, unknown> | null;
  capacities: Record<string, unknown> | null;
  projects: Array<Record<string, unknown>>;
  projectTemplates: Array<Record<string, unknown>>;
  projectRegionCandidates: Array<{ regionId: string; name: string }>;
  knownFacts: Array<Record<string, unknown>>;
  intelligenceTargetPolityIds: string[];
  politics: Record<string, unknown> | null;
  factions: Array<Record<string, unknown>>;
}

export interface DiplomacyBatch {
  batchId: string;
  month: string;
  baseRevision: string;
  polityIds: string[];
  briefs: DiplomacyPolityBrief[];
  characterCount: number;
}

export function buildDiplomacyBatch(state: EconWorldState, playerPolityId: string): DiplomacyBatch | null {
  if (state.modules?.diplomacy !== true || !state.diplomacy) return null;
  const polityIds = state.polities.filter((entry) => entry.id !== playerPolityId)
    .map((entry) => entry.id).sort().slice(0, MAX_STRATEGIC_POLITIES);
  const briefs = polityIds.map((polityId): DiplomacyPolityBrief => {
    const polity = state.polities.find((entry) => entry.id === polityId)!;
    const relations = state.diplomacy!.relations.filter((entry) => entry.polities.includes(polityId)).map((entry) => ({
      polityId: entry.polities.find((id) => id !== polityId)!, opinion: entry.opinion, trust: entry.trust, threat: entry.threat,
    })).sort((left, right) => left.polityId.localeCompare(right.polityId));
    const proposals = state.diplomacy!.proposals.filter((entry) => entry.proposerId === polityId || entry.recipientId === polityId)
      .map((entry) => ({ proposalId: entry.proposalId, proposerId: entry.proposerId, recipientId: entry.recipientId, terms: entry.terms }));
    const agreements = state.diplomacy!.agreements.filter((entry) =>
      entry.terms.fromPolityId === polityId || entry.terms.toPolityId === polityId)
      .map((entry) => ({ agreementId: entry.agreementId, terms: entry.terms }));
    return {
      polityId, name: polity.displayName.en, month: state.month, revision: state.revision,
      treasury: polity.treasury,
      stockpile: Object.fromEntries(polity.stockpile.map((entry) => [entry.resource, entry.amount])),
      relations, proposals, agreements,
      allowedAgreementTypes: ['non-aggression', 'defensive-alliance', 'guarantee', 'military-access'],
      allowedTradeResources: [...state.activeResources].sort(),
      finance: state.finance?.polities.find((entry) => entry.polityId === polityId) ?? null,
      capacities: state.projects?.capacities.find((entry) => entry.polityId === polityId) ?? null,
      projects: (state.projects?.projects ?? []).filter((entry) => entry.actorPolityId === polityId),
      projectTemplates: state.projects?.templates ?? [],
      projectRegionCandidates: state.regions.filter((entry) => entry.controllerId === polityId)
        .sort((a, b) => a.regionId.localeCompare(b.regionId)).slice(0, 3)
        .map((entry) => ({ regionId: entry.regionId, name: entry.displayName.en })),
      // A single strategic batch contains several autonomous actors. Private
      // knowledge cannot be co-located in that shared prompt without leaking
      // it across actors, so P3c keeps the batch on public state only.
      knownFacts: [],
      intelligenceTargetPolityIds: state.polities.filter((entry) => entry.id !== polityId).map((entry) => entry.id).sort(),
      politics: (() => {
        const row = state.politics?.polities.find((entry) => entry.polityId === polityId);
        return row ? { polityId: row.polityId, legitimacyBp: row.legitimacyBp, stabilityBp: row.stabilityBp,
          unrestBp: row.unrestBp, successionLaw: row.successionLaw, governmentChanges: row.governmentChanges } : null;
      })(),
      factions: (state.politics?.factions ?? []).filter((entry) => entry.polityId === polityId).map((entry) => ({
        factionId: entry.factionId, powerBp: entry.powerBp, supportBp: entry.supportBp,
        idealTaxBurdenBp: entry.idealTaxBurdenBp, preferredBudgetCategory: entry.preferredBudgetCategory,
        foreignPolicy: entry.foreignPolicy, ideology: entry.ideology, traditionalismBp: entry.traditionalismBp, escalation: entry.escalation,
      })),
    };
  });
  const characterCount = briefs.reduce((sum, brief) => sum + JSON.stringify(brief).length, 0);
  if (characterCount > MAX_BATCH_BRIEF_CHARS) throw new Error(`diplomacy batch exceeds ${MAX_BATCH_BRIEF_CHARS} characters`);
  return {
    batchId: `diplomacy:${state.month}:${state.revision.slice(-12)}`,
    month: state.month, baseRevision: state.revision, polityIds, briefs, characterCount,
  };
}

export function validateDiplomacyBatch(raw: unknown, batch: DiplomacyBatch): OpponentDiplomacyBatchResult {
  const parsed = opponentDiplomacyBatchResultSchema.parse(raw);
  const expected = [...batch.polityIds].sort();
  const actual = parsed.decisions.map((entry) => entry.polityId).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('strategic batch must decide every and only requested polity');
  const known = new Set(batch.briefs.map((entry) => entry.polityId));
  for (const decision of parsed.decisions) {
    const command = decision.command as DiplomacyCommand | StatecraftCommand | PoliticsCommand | null;
    if (!command) continue;
    if (command.actorPolityId !== decision.polityId) throw new Error('diplomacy command actor mismatch');
    if (command.expectedRevision !== batch.baseRevision || command.effectiveMonth !== batch.month) throw new Error('diplomacy command is stale or for the wrong month');
    if (command.kind === 'diplomacy.propose' && !known.has(command.recipientPolityId) && !batch.briefs.some((brief) =>
      brief.relations.some((relation) => relation.polityId === command.recipientPolityId))) {
      throw new Error('diplomacy proposal names an unknown recipient');
    }
    const brief = batch.briefs.find((entry) => entry.polityId === decision.polityId)!;
    if (command.kind === 'project.start') {
      if (!brief.projectTemplates.some((entry) => entry.templateId === command.templateId)) throw new Error('project command names an unknown template');
      if (command.targetPolityId && !brief.intelligenceTargetPolityIds.includes(command.targetPolityId)) throw new Error('project command names an unknown target polity');
      if (command.targetRegionId && !brief.projectRegionCandidates.some((entry) => entry.regionId === command.targetRegionId)) throw new Error('project command names a region outside the bounded candidates');
      if (command.targetFactId) throw new Error('strategic batch may not receive a hidden intelligence fact id');
    }
    if ((command.kind === 'project.update' || command.kind === 'project.cancel')
      && !brief.projects.some((entry) => entry.projectId === command.projectId)) throw new Error('project command names another polity project');
    if (command.kind === 'politics.respond') {
      const faction = brief.factions.find((entry) => entry.factionId === command.factionId);
      if (!faction) throw new Error('politics command names another polity faction');
      if (faction.escalation === 'calm') throw new Error('politics command answers an inactive faction');
      if (command.response !== decision.intent) throw new Error('politics response and intent must match');
    }
    if (command.kind === 'politics.appoint' || command.kind === 'politics.abdicate' || command.kind === 'character.create') {
      throw new Error('shared strategic batch may not manipulate private character choices');
    }
  }
  return parsed;
}

export const interpretedActionSchema = z.object({
  actionId: z.string().min(1).max(200),
  summary: z.string().min(1).max(240),
  command: z.union([investInRegionCommandSchema, politicsCommandSchema]).nullable(),
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
