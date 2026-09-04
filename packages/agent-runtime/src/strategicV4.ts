import { z } from 'zod';
import {
  actualController,
  currentPoliticalStrategy,
  politicalIdentitySchema as enginePoliticalIdentitySchema,
  runTurn,
  sha256OfString,
  type EconCommand,
  type EconWorldState,
} from '@open-historia/engine';
import {
  buildStrategicBriefV3,
  expandStrategicAffordancesV3,
  mapStrategicActionToCommandsUncheckedV3,
  type StrategicActionV2,
  type StrategicBriefV3,
  type StrategicContextV3,
  type StrategicPreviewV3,
} from './strategic.js';

export const STRATEGIC_INPUT_TOKEN_LIMIT = 25_000;
export const STRATEGIC_NORMAL_ACTION_LIMIT = 5;
export const STRATEGIC_TRIGGER_ACTION_LIMIT = 10;
export const STRATEGIC_MAX_CONCURRENCY = 4;

const toolSchema = z.enum([
  'invest', 'reallocate-production', 'conserve', 'negotiate-trade', 'external-import',
  'propose-agreement', 'apply-diplomatic-pressure', 'respond-proposal', 'change-policy',
  'respond-faction', 'start-project', 'mobilize', 'declare-war', 'issue-order', 'negotiate-peace',
]);

export const strategicInvocationReasonSchema = z.enum([
  'scheduled-quarter', 'war', 'proposal', 'crisis', 'government-change', 'occupation',
  'peace', 'default', 'resource-emergency', 'pending-trigger', 'transport-coverage',
]);

export const politicalIdentitySchema = enginePoliticalIdentitySchema;
export type PoliticalIdentity = z.infer<typeof politicalIdentitySchema>;

export const strategicLeaderCardSchema = z.object({
  characterId: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['head-of-state', 'head-of-government', 'decision-authority']),
  historical: z.boolean(),
  factCard: z.array(z.string().min(1).max(180)).min(1).max(8),
  knowledgePolicy: z.enum(['authored-card-plus-pre-scenario-prior', 'scenario-only']),
  sourceRefs: z.array(z.string().min(1)).min(1),
}).strict();
export type StrategicLeaderCard = z.infer<typeof strategicLeaderCardSchema>;

export const strategicTriggerV4Schema = z.object({
  triggerId: z.string().min(1),
  kind: strategicInvocationReasonSchema,
  summary: z.string().min(1).max(240),
  mandatory: z.boolean(),
  compatibleTools: z.array(toolSchema).min(1),
  evidenceIds: z.array(z.string().min(1)).max(12),
}).strict();
export type StrategicTriggerV4 = z.infer<typeof strategicTriggerV4Schema>;

export interface StrategicChoiceV4 {
  choiceId: string;
  evidenceId: string;
  family: StrategicActionV2['tool'];
  action: StrategicActionV2;
  preview: StrategicPreviewV3;
  context: Record<string, unknown> | null;
}

export interface CandidateAuditV4 {
  family: StrategicActionV2['tool'];
  considered: number;
  published: number;
  disposition: 'published' | 'excluded-not-relevant' | 'excluded-no-legal-choice';
  reason: string;
}

export interface StrategicBriefV4 {
  schemaVersion: 'open-historia-strategic-brief/4';
  decisionSchemaVersion: 'open-historia-strategic-decision/3';
  promptContract: 'StrategicBriefV4+StrategicDecisionV3';
  actor: { id: string; name: string };
  month: string;
  revision: string;
  role: string;
  successCriterion: string;
  invocation: { reason: z.infer<typeof strategicInvocationReasonSchema>; detail: string };
  decisionHierarchy: string[];
  triggers: StrategicTriggerV4[];
  goals: Array<Record<string, unknown>>;
  redLines: string[];
  political: {
    identity: PoliticalIdentity;
    headOfState: StrategicLeaderCard;
    headOfGovernment: StrategicLeaderCard;
    decisionAuthority: StrategicLeaderCard;
    rulingGroup: string;
    currentConstraints: string[];
  };
  publicData: {
    economy: StrategicBriefV3['economy'];
    commitments: string[];
    fronts: Array<{
      warId: string;
      ownRegion: { id: string; name: string };
      hostileRegion: { id: string; name: string };
      hostilePolity: { id: string; name: string };
      supplyCapacity: number;
      ownForceBand: 'none' | 'limited' | 'substantial' | 'massed';
      hostileForceBand: 'none' | 'limited' | 'substantial' | 'massed';
    }>;
  };
  ownIntelligence: Array<{ evidenceId: string; summary: string }>;
  durablePlan: { objective: string; futureSteps: string[]; commitments: string[] } | null;
  changesSinceLastDecision: string[];
  choices: StrategicChoiceV4[];
  candidateAudit: CandidateAuditV4[];
  inputTokenCount: number;
  tokenCountMethod: 'provider' | 'utf8-upper-bound';
}

/** Builds the private political section from canonical engine state only. */
export function buildStrategicPoliticsFromState(state: EconWorldState, polityId: string): StrategicBriefV4['political'] {
  if (!state.politics) throw new Error(`politics state missing for ${polityId}`);
  const profile = currentPoliticalStrategy(state.politics, polityId);
  const leader = (character: typeof profile.headOfState, role: StrategicLeaderCard['role']): StrategicLeaderCard => {
    if (!character.leaderCard) throw new Error(`leader card missing for ${character.characterId}`);
    return strategicLeaderCardSchema.parse({
      characterId: character.characterId,
      name: character.displayName.en,
      role,
      ...character.leaderCard,
    });
  };
  return {
    identity: politicalIdentitySchema.parse(profile.identity),
    headOfState: leader(profile.headOfState, 'head-of-state'),
    headOfGovernment: leader(profile.headOfGovernment, 'head-of-government'),
    decisionAuthority: leader(profile.decisionAuthority, 'decision-authority'),
    rulingGroup: profile.rulingFaction.displayName.en,
    currentConstraints: profile.currentConstraints.slice(0, 3),
  };
}

const selectedChoiceSchema = z.object({
  choiceId: z.string().min(1),
  purpose: z.string().min(1).max(240),
  evidenceIds: z.array(z.string().min(1)).min(1).max(12),
  expectedConsequence: z.string().min(1).max(320),
}).strict();

export const strategicDecisionV3Schema = z.object({
  polityId: z.string().min(1),
  revision: z.string().min(1),
  objective: z.object({
    domain: z.enum(['economy', 'diplomacy', 'politics', 'military', 'statecraft', 'campaign']),
    summary: z.string().min(1).max(320),
    horizon: z.enum(['short', 'medium', 'long']),
  }).strict(),
  selectedChoices: z.array(selectedChoiceSchema).max(STRATEGIC_TRIGGER_ACTION_LIMIT),
  triggerCoverage: z.array(z.object({
    triggerId: z.string().min(1),
    choiceIds: z.array(z.string().min(1)).length(1),
  }).strict()).max(32),
  rejectedChoices: z.array(z.object({ choiceId: z.string().min(1), reason: z.string().min(1).max(240) }).strict()).max(3),
  durablePlan: z.object({
    objective: z.string().min(1).max(320),
    futureSteps: z.array(z.string().min(1).max(240)).max(8),
    commitments: z.array(z.string().min(1).max(240)).max(8),
  }).strict(),
  contingency: z.string().min(1).max(500),
  hold: z.object({
    reason: z.enum(['no-legal-action', 'waiting-response', 'insufficient-resources', 'plan-sequencing', 'risk-too-high', 'mandatory-overflow', 'stale']),
    detail: z.string().min(1).max(320),
    revisitAfterMonths: z.number().int().min(1).max(12),
  }).strict().nullable(),
}).strict();
export type StrategicDecisionV3 = z.infer<typeof strategicDecisionV3Schema>;

export type StrategicResolutionV4 =
  | { status: 'accepted'; commands: EconCommand[]; decision: StrategicDecisionV3; pendingTriggerIds: [] }
  | { status: 'hold'; commands: []; decision: StrategicDecisionV3 | null; pendingTriggerIds: string[]; reason: string }
  | { status: 'terminal'; commands: []; decision: null; pendingTriggerIds: string[]; reason: string };

export const strategicRunManifestV4Schema = z.object({
  schemaVersion: z.literal('open-historia-strategic-run/3'),
  scenarioId: z.string().min(1),
  scenarioContentVersion: z.string().regex(/^[1-9]\d*\.\d+\.\d+$/),
  promptContract: z.literal('StrategicBriefV4+StrategicDecisionV3'),
  provider: z.string().min(1), model: z.string().min(1), effort: z.string().min(1),
  preflightChecksum: z.string().min(1),
}).strict();
export type StrategicRunManifestV4 = z.infer<typeof strategicRunManifestV4Schema>;

export function assertStrategicRunCompatible(raw: unknown, expected: StrategicRunManifestV4): StrategicRunManifestV4 {
  const parsed = strategicRunManifestV4Schema.safeParse(raw);
  if (!parsed.success) throw new Error('incompatible strategic run: V1/V2/V3 runs cannot resume under StrategicBriefV4+StrategicDecisionV3');
  for (const key of ['scenarioId', 'scenarioContentVersion', 'promptContract', 'provider', 'model', 'effort', 'preflightChecksum'] as const) {
    if (parsed.data[key] !== expected[key]) throw new Error(`incompatible strategic run: frozen ${key} changed`);
  }
  return parsed.data;
}

export interface StrategicMemoryV4 {
  polityId: string;
  durablePlan: StrategicDecisionV3['durablePlan'] | null;
  lastDecisionRevision: string | null;
}

/** Plan and selected actions become durable only as one accepted package. */
export function commitStrategicMemory(previous: StrategicMemoryV4, resolution: StrategicResolutionV4): StrategicMemoryV4 {
  if (resolution.status !== 'accepted') return structuredClone(previous);
  return { polityId: previous.polityId, durablePlan: structuredClone(resolution.decision.durablePlan),
    lastDecisionRevision: resolution.decision.revision };
}

const ALL_FAMILIES = toolSchema.options;
const choiceKey = (revision: string, actorId: string, action: StrategicActionV2) =>
  `choice:${sha256OfString(`${revision}|${actorId}|${JSON.stringify(action)}`).slice(7, 31)}`;

const entityRef = (state: EconWorldState, id: string, kind: 'polity' | 'region') => ({ id,
  name: kind === 'polity' ? state.polities.find((entry) => entry.id === id)?.displayName.en ?? id
    : state.regions.find((entry) => entry.regionId === id)?.displayName.en ?? id });

const proposalContext = (state: EconWorldState, terms: Record<string, unknown>): Record<string, unknown> => {
  if (terms.kind === 'territorial-settlement' && typeof terms.fromPolityId === 'string' && typeof terms.toPolityId === 'string'
    && Array.isArray(terms.regionIds) && terms.regionIds.every((entry) => typeof entry === 'string')) {
    return { kind: terms.kind, fromPolity: entityRef(state, terms.fromPolityId, 'polity'),
      toPolity: entityRef(state, terms.toPolityId, 'polity'),
      regions: terms.regionIds.map((entry) => entityRef(state, entry, 'region')) };
  }
  if (terms.kind === 'agreement' && typeof terms.fromPolityId === 'string' && typeof terms.toPolityId === 'string') {
    return { kind: terms.kind, agreementType: terms.agreementType,
      fromPolity: entityRef(state, terms.fromPolityId, 'polity'), toPolity: entityRef(state, terms.toPolityId, 'polity') };
  }
  return structuredClone(terms);
};

/** A bounded, public adjacency summary. The full map and enemy force state stay out of the prompt. */
const publicFrontsFor = (state: EconWorldState, polityId: string): StrategicBriefV4['publicData']['fronts'] => {
  if (!state.military) return [];
  const forceBand = (regionId: string, ownerId: string): 'none' | 'limited' | 'substantial' | 'massed' => {
    const manpower = state.military!.formations.filter((entry) => entry.polityId === ownerId && entry.locationRegionId === regionId
      && !['demobilized', 'destroyed'].includes(entry.status)).reduce((sum, entry) => sum + entry.manpower, 0);
    return manpower === 0 ? 'none' : manpower < 50_000 ? 'limited' : manpower < 150_000 ? 'substantial' : 'massed';
  };
  const rows: StrategicBriefV4['publicData']['fronts'] = [];
  for (const war of state.military.wars.filter((entry) => entry.status === 'active').sort((a, b) => a.warId.localeCompare(b.warId))) {
    const opponents = war.attackers.includes(polityId as never) ? war.defenders
      : war.defenders.includes(polityId as never) ? war.attackers : [];
    if (!opponents.length) continue;
    for (const link of state.military.supplyLinks) {
      const [left, right] = link.regions;
      const leftRegion = state.regions.find((entry) => entry.regionId === left);
      const rightRegion = state.regions.find((entry) => entry.regionId === right);
      const leftController = leftRegion ? actualController(state.military, left, leftRegion.controllerId) : undefined;
      const rightController = rightRegion ? actualController(state.military, right, rightRegion.controllerId) : undefined;
      const ownRegionId = leftController === polityId && rightController && opponents.includes(rightController as never) ? left
        : rightController === polityId && leftController && opponents.includes(leftController as never) ? right : null;
      const hostileRegionId = ownRegionId === left ? right : ownRegionId === right ? left : null;
      const hostilePolityId = hostileRegionId === left ? leftController : hostileRegionId === right ? rightController : null;
      if (!ownRegionId || !hostileRegionId || !hostilePolityId) continue;
      rows.push({ warId: war.warId, ownRegion: entityRef(state, ownRegionId, 'region'),
        hostileRegion: entityRef(state, hostileRegionId, 'region'), hostilePolity: entityRef(state, hostilePolityId, 'polity'),
        supplyCapacity: link.capacity, ownForceBand: forceBand(ownRegionId, polityId),
        hostileForceBand: forceBand(hostileRegionId, hostilePolityId) });
    }
  }
  return rows.sort((a, b) => a.warId.localeCompare(b.warId) || a.ownRegion.id.localeCompare(b.ownRegion.id)
    || a.hostileRegion.id.localeCompare(b.hostileRegion.id)).slice(0, 6);
};

export interface StrategicBriefV4Options {
  invocation: { reason: z.infer<typeof strategicInvocationReasonSchema>; detail: string };
  triggers?: StrategicTriggerV4[];
  relevantFamilies?: StrategicActionV2['tool'][];
  strategicContext?: Partial<StrategicContextV3>;
  externalSupplierPolityIds?: string[];
  political?: StrategicBriefV4['political'];
  ownIntelligence?: StrategicBriefV4['ownIntelligence'];
  durablePlan?: StrategicBriefV4['durablePlan'];
  changesSinceLastDecision?: string[];
  systemText?: string;
  /** Production providers may supply their exact tokenizer. Without one, one
   * UTF-8 byte is counted as one token, a deliberately conservative bound. */
  countTokens?: (text: string) => number;
}

type StrategicPromptSourceV4 = Omit<StrategicBriefV4, 'inputTokenCount' | 'tokenCountMethod'>;

/** The sole production serializer for provider calls and prompt-lab snapshots. */
export function renderStrategicPromptV4(brief: StrategicPromptSourceV4 | StrategicBriefV4, systemText = ''): string {
  const lines = [
    systemText.trim(),
    '[TASK]',
    brief.role,
    `Success: ${brief.successCriterion}`,
    `Decision hierarchy: ${brief.decisionHierarchy.join(' > ')}`,
    '[CHECKPOINT]',
    JSON.stringify({ actor: brief.actor, month: brief.month, revision: brief.revision, invocation: brief.invocation, triggers: brief.triggers }),
    '[GOALS_AND_RED_LINES]',
    JSON.stringify({ goals: brief.goals, redLines: brief.redLines }),
    '[CURRENT_LEADERSHIP]',
    JSON.stringify(brief.political),
    '[PUBLIC_STATE_AND_OWN_EVIDENCE]',
    JSON.stringify({ publicData: brief.publicData, ownIntelligence: brief.ownIntelligence }),
    '[DURABLE_PLAN_AND_CHANGES]',
    JSON.stringify({ durablePlan: brief.durablePlan, changesSinceLastDecision: brief.changesSinceLastDecision }),
    '[FROZEN_CHOICES]',
    JSON.stringify(brief.choices),
    '[CANDIDATE_AUDIT]',
    JSON.stringify(brief.candidateAudit),
    '[OUTPUT]',
    'Return exactly one StrategicDecisionV3 JSON object for this actor and revision. Select only published choiceId values; map every mandatory trigger exactly once to compatible selected choiceIds. Use evidence IDs from this prompt, state qualitative expected consequences only, and invent no IDs, hidden facts, numeric effects, or completed outcomes. Return no prose or markdown.',
  ];
  return `${lines.filter((line, index) => index > 0 || line.length > 0).join('\n')}\n`;
}

/** Builds one private session payload for exactly one polity. */
export function buildStrategicBriefV4(state: EconWorldState, polityId: string, options: StrategicBriefV4Options): StrategicBriefV4 {
  const triggers = strategicTriggerV4Schema.array().parse(options.triggers ?? []);
  const v3 = buildStrategicBriefV3(state, polityId, {
    strategicContext: options.strategicContext,
    externalSupplierPolityIds: options.externalSupplierPolityIds,
  });
  const allActions = expandStrategicAffordancesV3(v3);
  const relevant = new Set<StrategicActionV2['tool']>();
  const relevanceReasons = new Map<StrategicActionV2['tool'], Set<string>>();
  const include = (families: StrategicActionV2['tool'][], reason: string) => {
    for (const family of families) {
      relevant.add(family);
      const reasons = relevanceReasons.get(family) ?? new Set<string>();
      reasons.add(reason);
      relevanceReasons.set(family, reasons);
    }
  };
  if (options.relevantFamilies === undefined) include(ALL_FAMILIES, 'Complete legal surface requested.');
  else include(options.relevantFamilies, 'Explicit checkpoint relevance input.');
  include(['conserve'], 'A typed hold is always legal.');
  for (const trigger of triggers) include(trigger.compatibleTools, `Compatible with trigger ${trigger.triggerId}.`);

  for (const goal of v3.goals) {
    if (goal.status !== 'active') continue;
    if (goal.kind === 'secure-alliance') include(['propose-agreement'], `Required by active goal ${String(goal.goalId)}.`);
    else if (goal.kind === 'control-region') include(['apply-diplomatic-pressure', 'declare-war'], `Required by active goal ${String(goal.goalId)}.`);
    else if (goal.kind === 'unlock-capability') include(['start-project'], `Required by active goal ${String(goal.goalId)}.`);
    else if (goal.kind === 'stabilize-government') include(['change-policy', 'respond-faction'], `Required by active goal ${String(goal.goalId)}.`);
  }
  const invocationFamilies: Partial<Record<z.infer<typeof strategicInvocationReasonSchema>, StrategicActionV2['tool'][]>> = {
    proposal: ['respond-proposal'],
    war: ['mobilize', 'issue-order', 'negotiate-peace'],
    occupation: ['mobilize', 'issue-order', 'negotiate-peace'],
    peace: ['issue-order', 'negotiate-peace'],
    crisis: ['change-policy', 'respond-faction', 'mobilize'],
    'government-change': ['change-policy', 'respond-faction'],
    default: ['change-policy', 'start-project', 'negotiate-trade', 'external-import'],
    'resource-emergency': ['invest', 'reallocate-production', 'negotiate-trade', 'external-import'],
  };
  if (triggers.length === 0) include(invocationFamilies[options.invocation.reason] ?? [], `Required by ${options.invocation.reason} checkpoint.`);
  if (v3.economy.foodShortfall > 0 || v3.economy.limitingInputs.length > 0
    || v3.economy.resources.some((entry) => entry.runwayMonths !== null && entry.runwayMonths <= 3)) {
    include(['negotiate-trade', 'external-import'], 'Required by a material resource deficit.');
  }
  if (options.durablePlan) include(ALL_FAMILIES, 'Durable plan and commitments require a complete legal surface.');
  const choices = allActions.filter((action) => relevant.has(action.tool)).map((action) => {
    let preview: StrategicPreviewV3 | undefined;
    let context: Record<string, unknown> | null = null;
    for (const affordance of v3.affordances) {
      const serialized = JSON.stringify(action);
      const visit = (candidate: { action: StrategicActionV2; preview: StrategicPreviewV3 }, candidateContext: Record<string, unknown> | null = null) => {
        if (JSON.stringify(candidate.action) === serialized) { preview = candidate.preview; context = candidateContext; }
      };
      if (affordance.tool === 'conserve') visit(affordance.choice);
      else if (affordance.tool === 'invest') affordance.regions.flatMap((entry) => entry.scales).forEach((entry) => visit(entry));
      else if (affordance.tool === 'reallocate-production') affordance.regions.flatMap((entry) => entry.priorities.flatMap((priority) => priority.scales)).forEach((entry) => visit(entry));
      else if (affordance.tool === 'negotiate-trade' || affordance.tool === 'external-import') affordance.partners.flatMap((entry) => entry.resources.flatMap((resource) => resource.choices)).forEach((entry) => visit(entry));
      else if (affordance.tool === 'propose-agreement') affordance.partners.flatMap((entry) => entry.choices).forEach((entry) => visit(entry));
      else if (affordance.tool === 'apply-diplomatic-pressure') affordance.partners.flatMap((entry) => entry.choices).forEach((entry) => visit(entry));
      else if (affordance.tool === 'respond-proposal') affordance.proposals.forEach((entry) => entry.choices.forEach((choice) => visit(choice, {
        kind: 'proposal', proposal: entry.proposal, proposer: entry.proposer, createdMonth: entry.createdMonth,
        terms: proposalContext(state, entry.terms),
      })));
      else if (affordance.tool === 'change-policy') affordance.choices.forEach((entry) => visit(entry));
      else if (affordance.tool === 'respond-faction') affordance.factions.flatMap((entry) => entry.choices).forEach((entry) => visit(entry));
      else if (affordance.tool === 'start-project') affordance.projects.flatMap((entry) => entry.choices).forEach((entry) => visit(entry));
      else if (affordance.tool === 'mobilize') affordance.plans.forEach((entry) => entry.choices.forEach((choice) => {
        const result = choice.preview.deltas.find((delta) => delta.path === 'military.mobilizationPlan')?.after as {
          equipmentCoverageBp?: number;
        } | undefined;
        visit(choice, { kind: 'mobilization-plan', label: entry.label,
          regionNames: entry.deployments.map((deployment) => deployment.region.name),
          equipmentCoverageBp: result?.equipmentCoverageBp ?? 0 });
      }));
      else if (affordance.tool === 'declare-war') affordance.defenders.flatMap((entry) => entry.reasons.map((reason) => reason.choice)).forEach((entry) => visit(entry));
      else if (affordance.tool === 'issue-order') affordance.formations.flatMap((entry) => entry.choices).forEach((entry) => visit(entry));
      else if (affordance.tool === 'negotiate-peace') affordance.wars.flatMap((entry) => entry.choices).forEach((entry) => visit(entry));
    }
    if (!preview) throw new Error(`missing preview for ${action.tool}`);
    const choiceId = choiceKey(state.revision, polityId, action);
    return { choiceId, evidenceId: `evidence:${choiceId.slice('choice:'.length)}`, family: action.tool, action, preview, context };
  });
  const candidateAudit = ALL_FAMILIES.map((family): CandidateAuditV4 => {
    const considered = allActions.filter((entry) => entry.tool === family).length;
    const published = choices.filter((entry) => entry.family === family).length;
    return { family, considered, published,
      disposition: published ? 'published' : considered ? 'excluded-not-relevant' : 'excluded-no-legal-choice',
      reason: published ? `${[...(relevanceReasons.get(family) ?? [])].join(' ')} Engine dry run accepted.`
        : considered ? 'Not selected by current relevance inputs.'
          : 'No legal choice at this revision.' };
  });
  const politicalInput = options.political ?? buildStrategicPoliticsFromState(state, polityId);
  const political = {
    ...politicalInput,
    identity: politicalIdentitySchema.parse(politicalInput.identity),
    headOfState: strategicLeaderCardSchema.parse(politicalInput.headOfState),
    headOfGovernment: strategicLeaderCardSchema.parse(politicalInput.headOfGovernment),
    decisionAuthority: strategicLeaderCardSchema.parse(politicalInput.decisionAuthority),
    currentConstraints: politicalInput.currentConstraints.slice(0, 3),
  };
  const draft: Omit<StrategicBriefV4, 'inputTokenCount' | 'tokenCountMethod'> = {
    schemaVersion: 'open-historia-strategic-brief/4', decisionSchemaVersion: 'open-historia-strategic-decision/3',
    promptContract: 'StrategicBriefV4+StrategicDecisionV3', actor: v3.polity, month: state.month, revision: state.revision,
    role: `You are the strategic controller of ${v3.polity.name}, acting for its current leadership and only in its national interest.`,
    successCriterion: 'Resolve mandatory triggers and protect sovereignty before pursuing ranked goals, commitments, and material opportunities.',
    invocation: options.invocation,
    decisionHierarchy: ['mandatory triggers and red lines', 'survival and sovereignty', 'authored goals', 'commitments and durable plan', 'material opportunities adjusted by leadership risk attitude'],
    triggers, goals: v3.goals, redLines: [...(options.strategicContext?.redLines ?? [])].slice(0, 8), political,
    publicData: { economy: v3.economy, commitments: [...(options.strategicContext?.obligations ?? [])].slice(0, 8),
      fronts: publicFrontsFor(state, polityId) },
    ownIntelligence: (options.ownIntelligence ?? []).slice(0, 12), durablePlan: options.durablePlan ?? null,
    changesSinceLastDecision: (options.changesSinceLastDecision ?? []).slice(0, 12), choices, candidateAudit,
  };
  const promptText = renderStrategicPromptV4(draft, options.systemText);
  const inputTokenCount = options.countTokens ? options.countTokens(promptText) : Buffer.byteLength(promptText, 'utf8');
  if (!Number.isSafeInteger(inputTokenCount) || inputTokenCount < 0) throw new Error('strategic V4 token counter returned an invalid value');
  if (inputTokenCount > STRATEGIC_INPUT_TOKEN_LIMIT) throw new Error(`strategic V4 input exceeds ${STRATEGIC_INPUT_TOKEN_LIMIT} tokens (${inputTokenCount})`);
  return { ...draft, inputTokenCount, tokenCountMethod: options.countTokens ? 'provider' : 'utf8-upper-bound' };
}

const compatible = (trigger: StrategicTriggerV4, choice: StrategicChoiceV4) =>
  choice.family === 'conserve' || trigger.compatibleTools.includes(choice.family);

const exclusiveTarget = (action: StrategicActionV2): string | null => {
  if (action.tool === 'respond-proposal') return `proposal:${action.proposalId}`;
  if (action.tool === 'respond-faction') return `faction:${action.factionId}`;
  if (action.tool === 'reallocate-production' || action.tool === 'invest') return `region:${action.targetRegionId}`;
  if (action.tool === 'issue-order') return `formation:${action.formationId}`;
  if (action.tool === 'negotiate-peace') return `war:${action.warId}`;
  return null;
};

/** Validates IDs against the frozen brief and performs one atomic final dry run. */
export function materializeStrategicDecisionV4(state: EconWorldState, raw: unknown, brief: StrategicBriefV4): StrategicResolutionV4 {
  const pending = brief.triggers.filter((entry) => entry.mandatory).map((entry) => entry.triggerId).sort();
  const parsed = strategicDecisionV3Schema.safeParse(raw);
  if (!parsed.success) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending,
    reason: `schema-failure: ${parsed.error.issues[0]?.message ?? 'invalid decision'}` };
  const decision = parsed.data;
  if (brief.revision !== state.revision || decision.revision !== state.revision || brief.month !== state.month) {
    return { status: 'hold', commands: [], decision, pendingTriggerIds: pending, reason: 'stale strategic choice; retry at a new checkpoint' };
  }
  if (decision.polityId !== brief.actor.id) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'cross-actor decision' };
  const choices = new Map(brief.choices.map((entry) => [entry.choiceId, entry]));
  const selectedIds = decision.selectedChoices.map((entry) => entry.choiceId);
  if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !choices.has(id))) {
    return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'invented or duplicate choiceId' };
  }
  const allowedEvidenceIds = new Set([
    ...brief.triggers.flatMap((entry) => [entry.triggerId, ...entry.evidenceIds]),
    ...brief.ownIntelligence.map((entry) => entry.evidenceId),
    ...brief.choices.map((entry) => entry.evidenceId),
  ]);
  if (decision.selectedChoices.some((entry) => entry.evidenceIds.some((id) => !allowedEvidenceIds.has(id)))) {
    return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'invented evidence reference' };
  }
  const triggerMap = new Map(brief.triggers.map((entry) => [entry.triggerId, entry]));
  const coverageCount = new Map<string, number>();
  for (const coverage of decision.triggerCoverage) {
    const trigger = triggerMap.get(coverage.triggerId);
    if (!trigger || new Set(coverage.choiceIds).size !== coverage.choiceIds.length) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'unknown trigger or duplicate trigger choice' };
    if (coverageCount.has(coverage.triggerId)) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'duplicate trigger coverage' };
    coverageCount.set(coverage.triggerId, 1);
    for (const id of coverage.choiceIds) {
      const choice = choices.get(id);
      if (!choice || !selectedIds.includes(id) || !compatible(trigger, choice)) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'trigger coverage references an incompatible or unselected choice' };
    }
  }
  if (brief.triggers.some((trigger) => trigger.mandatory && coverageCount.get(trigger.triggerId) !== 1)) {
    return { status: 'hold', commands: [], decision, pendingTriggerIds: pending, reason: 'mandatory trigger coverage incomplete' };
  }
  const materialIds = selectedIds.filter((id) => choices.get(id)?.family !== 'conserve');
  const limit = pending.length > STRATEGIC_NORMAL_ACTION_LIMIT ? STRATEGIC_TRIGGER_ACTION_LIMIT : STRATEGIC_NORMAL_ACTION_LIMIT;
  if (materialIds.length > limit) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: `action limit ${limit} exceeded` };
  if (materialIds.length > STRATEGIC_NORMAL_ACTION_LIMIT) {
    const mandatoryChoiceIds = new Set(decision.triggerCoverage.filter((entry) => triggerMap.get(entry.triggerId)?.mandatory).flatMap((entry) => entry.choiceIds));
    if (materialIds.some((id) => !mandatoryChoiceIds.has(id))) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'optional action used an expanded mandatory slot' };
  }
  const rejected = decision.rejectedChoices.map((entry) => entry.choiceId);
  if (new Set(rejected).size !== rejected.length || rejected.some((id) => !choices.has(id) || selectedIds.includes(id))) {
    return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'invalid rejected choice reference' };
  }
  if (brief.choices.length > 1 && rejected.length === 0) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'at least one rejected choice is required' };
  if (decision.hold !== null || materialIds.length === 0) return { status: 'hold', commands: [], decision, pendingTriggerIds: pending, reason: decision.hold?.detail ?? 'no material choice' };
  const actions = materialIds.map((id) => choices.get(id)!.action);
  if (new Set(actions.map((entry) => entry.tool)).size !== actions.length) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'duplicate tool selection' };
  const targets = actions.map(exclusiveTarget).filter((entry): entry is string => entry !== null);
  if (new Set(targets).size !== targets.length) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'duplicate exclusive target' };
  const warTargets = actions.filter((entry): entry is Extract<StrategicActionV2, { tool: 'declare-war' }> => entry.tool === 'declare-war').map((entry) => entry.defender);
  const negotiationTargets = actions.flatMap((entry) => ['negotiate-trade', 'external-import', 'propose-agreement', 'apply-diplomatic-pressure'].includes(entry.tool)
    ? [(entry as Extract<StrategicActionV2, { partner: string }>).partner] : []);
  if (warTargets.some((target) => negotiationTargets.includes(target))) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'war and negotiation target conflict' };
  const expanded = actions.map((action) => mapStrategicActionToCommandsUncheckedV3(state, brief.actor.id, action));
  if (expanded.some((entry) => entry.length === 0)) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'deterministic expansion failed' };
  const commands = expanded.flat();
  const finalDryRun = runTurn(state, { commands }).result;
  if (finalDryRun.rejections.length) return { status: 'terminal', commands: [], decision: null, pendingTriggerIds: pending, reason: 'atomic package rejected' };
  return { status: 'accepted', commands, decision, pendingTriggerIds: [] };
}

const monthIndex = (month: string) => {
  const [year, value] = month.split('-').map(Number);
  return year! * 12 + value! - 1;
};

const monthFromIndex = (index: number) => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`;

export function pendingTriggerRetryMonth(month: string): string {
  return monthFromIndex(monthIndex(month) + 1);
}

export function isQuarterlyCheckpoint(startMonth: string, month: string): boolean {
  const elapsed = monthIndex(month) - monthIndex(startMonth);
  return elapsed >= 0 && elapsed % 3 === 0;
}

export function strategicCallBudget(actorCount: number, startMonth: string, horizonMonth: string, urgentReserve: number): number {
  const months = Math.max(0, monthIndex(horizonMonth) - monthIndex(startMonth));
  return actorCount * (Math.floor(months / 3) + 1) + Math.max(0, urgentReserve);
}

export function dispatchStrategicSessions(polityIds: string[]): string[][] {
  const sorted = [...new Set(polityIds)].sort();
  const waves: string[][] = [];
  for (let index = 0; index < sorted.length; index += STRATEGIC_MAX_CONCURRENCY) waves.push(sorted.slice(index, index + STRATEGIC_MAX_CONCURRENCY));
  return waves;
}

export function stableStrategicCommitOrder<T extends { polityId: string }>(results: T[]): T[] {
  return [...results].sort((left, right) => left.polityId.localeCompare(right.polityId));
}
