import { z } from 'zod';
import {
  econCommandSchema,
  actualController,
  polityIdentityEffects,
  relationKey,
  runTurn,
  sha256OfString,
  type EconCommand,
  type EconWorldState,
  type PolityLedger,
  type ResourceId,
} from '@open-historia/engine';

const horizonSchema = z.enum(['short', 'medium', 'long']);
const scaleSchema = z.enum(['small', 'medium', 'large']);
const runwaySchema = z.enum(['short', 'medium', 'long']);
const budgetAttitudeSchema = z.enum(['cautious', 'balanced', 'urgent']);

const investActionSchema = z.object({
  tool: z.literal('invest'), targetRegionId: z.string(), scale: scaleSchema,
}).strict();
const reallocateActionSchema = z.object({
  tool: z.literal('reallocate-production'), targetRegionId: z.string(), priority: z.enum(['food', 'raw-materials', 'industry']), scale: scaleSchema,
}).strict();
const conserveActionSchema = z.object({ tool: z.literal('conserve') }).strict();
const tradeActionSchema = z.object({
  tool: z.literal('negotiate-trade'), partner: z.string(), resource: z.string(), desiredRunway: runwaySchema, budgetAttitude: budgetAttitudeSchema,
}).strict();
const importActionSchema = z.object({
  tool: z.literal('external-import'), partner: z.string(), resource: z.string(), desiredRunway: runwaySchema, budgetAttitude: budgetAttitudeSchema,
}).strict();
const agreementActionSchema = z.object({
  tool: z.literal('propose-agreement'), partner: z.string(), agreementType: z.enum(['non-aggression', 'defensive-alliance', 'guarantee', 'military-access']),
}).strict();
const pressureActionSchema = z.object({
  tool: z.literal('apply-diplomatic-pressure'), partner: z.string(), demand: z.enum(['territorial-concession', 'policy-change', 'military-access']),
  targetRegionId: z.string().optional(), pressure: scaleSchema,
}).strict();
const proposalResponseActionSchema = z.object({
  tool: z.literal('respond-proposal'), proposalId: z.string(), response: z.enum(['accept', 'reject']),
}).strict();
const policyActionSchema = z.object({
  tool: z.literal('change-policy'), taxStance: z.enum(['relieve', 'steady', 'raise']), budgetPriority: z.enum(['administration', 'science', 'industry', 'security', 'military']),
}).strict();
const factionActionSchema = z.object({
  tool: z.literal('respond-faction'), factionId: z.string(), response: z.enum(['concede', 'repress', 'refuse']),
}).strict();
const projectActionSchema = z.object({
  tool: z.literal('start-project'), templateId: z.string(), scale: scaleSchema, targetRegionId: z.string().optional(), targetPolityId: z.string().optional(),
}).strict();
const mobilizeActionSchema = z.object({
  tool: z.literal('mobilize'), locationRegionId: z.string(), scale: scaleSchema, commanderId: z.string().nullable().optional(),
}).strict();
const warActionSchema = z.object({
  tool: z.literal('declare-war'), defender: z.string(), reason: z.enum(['claim', 'defense', 'guarantee', 'rivalry', 'none']),
}).strict();
const orderActionSchema = z.object({
  tool: z.literal('issue-order'), formationId: z.string(), posture: z.enum(['hold', 'defend', 'advance', 'withdraw']), targetRegionId: z.string().nullable(),
}).strict();
const peaceActionSchema = z.object({
  tool: z.literal('negotiate-peace'), warId: z.string(), approach: z.enum(['status-quo', 'limited-concessions', 'press-claims']),
}).strict();

export const strategicActionV2Schema = z.discriminatedUnion('tool', [
  investActionSchema, reallocateActionSchema, conserveActionSchema, tradeActionSchema, importActionSchema,
  agreementActionSchema, pressureActionSchema, proposalResponseActionSchema, policyActionSchema,
  factionActionSchema, projectActionSchema, mobilizeActionSchema, warActionSchema, orderActionSchema, peaceActionSchema,
]);
export type StrategicActionV2 = z.infer<typeof strategicActionV2Schema>;

const holdSchema = z.object({
  reason: z.enum(['no-legal-action', 'waiting-response', 'insufficient-resources', 'plan-sequencing', 'risk-too-high']),
  detail: z.string().min(1).max(320),
  revisit: z.object({ afterMonths: z.number().int().min(1).max(12), triggers: z.array(z.enum([
    'resource-deficit', 'diplomatic-response', 'war', 'occupation', 'peace', 'crisis', 'government-change', 'default',
  ])).min(1).max(8) }).strict(),
}).strict();

export const strategicDecisionV2Schema = z.object({
  polityId: z.string(),
  objective: z.object({ domain: z.enum(['economy', 'diplomacy', 'politics', 'military', 'statecraft', 'campaign']), summary: z.string().min(1).max(320), horizon: horizonSchema }).strict(),
  actions: z.array(strategicActionV2Schema).max(3),
  futurePlan: z.array(z.object({ summary: z.string().min(1).max(240), condition: z.string().min(1).max(240) }).strict()).max(8),
  contingency: z.string().min(1).max(500),
  rationale: z.string().min(1).max(800),
  intendedOutcome: z.string().max(500).optional(),
  hold: holdSchema.nullable(),
}).strict().superRefine((decision, ctx) => {
  const material = decision.actions.filter((entry) => entry.tool !== 'conserve');
  if ((material.length === 0) !== (decision.hold !== null)) ctx.addIssue({ code: 'custom', path: ['hold'], message: 'hold is required exactly when no material action is selected' });
  if (decision.actions.some((entry) => entry.tool === 'conserve') && decision.actions.length > 1) ctx.addIssue({ code: 'custom', path: ['actions'], message: 'conserve cannot be combined with material actions' });
});
export type StrategicDecisionV2 = z.infer<typeof strategicDecisionV2Schema>;

export const strategicDecisionBatchV2Schema = z.object({ decisions: z.array(strategicDecisionV2Schema).max(6) }).strict();
export type StrategicDecisionBatchV2 = z.infer<typeof strategicDecisionBatchV2Schema>;

export interface StrategicEntityRefV3 { id: string; name: string }
export interface StrategicPreviewV3 {
  summary: string;
  commandKinds: string[];
  deltas: Array<{ path: string; before: unknown; after: unknown }>;
}
export interface StrategicChoiceV3<A extends StrategicActionV2 = StrategicActionV2> {
  action: A;
  preview: StrategicPreviewV3;
}

type ActionOf<T extends StrategicActionV2['tool']> = Extract<StrategicActionV2, { tool: T }>;
export type StrategicAffordanceV3 =
  | { tool: 'conserve'; choice: StrategicChoiceV3<ActionOf<'conserve'>> }
  | { tool: 'invest'; regions: Array<{ region: StrategicEntityRefV3; scales: Array<StrategicChoiceV3<ActionOf<'invest'>>> }> }
  | { tool: 'reallocate-production'; regions: Array<{ region: StrategicEntityRefV3; priorities: Array<{ priority: ActionOf<'reallocate-production'>['priority']; scales: Array<StrategicChoiceV3<ActionOf<'reallocate-production'>>> }> }> }
  | { tool: 'negotiate-trade' | 'external-import'; description: string; partners: Array<{ partner: StrategicEntityRefV3; routeCapacity: number; resources: Array<{ resource: string; actorBalance: number; actorRunwayMonths: number | null; choices: Array<StrategicChoiceV3<ActionOf<'negotiate-trade'> | ActionOf<'external-import'>>> }> }> }
  | { tool: 'propose-agreement'; partners: Array<{ partner: StrategicEntityRefV3; relation: Record<string, unknown> | null; activeAgreements: string[]; choices: Array<StrategicChoiceV3<ActionOf<'propose-agreement'>>> }> }
  | { tool: 'apply-diplomatic-pressure'; partners: Array<{ partner: StrategicEntityRefV3; choices: Array<StrategicChoiceV3<ActionOf<'apply-diplomatic-pressure'>>> }> }
  | { tool: 'respond-proposal'; proposals: Array<{ proposal: StrategicEntityRefV3; proposer: StrategicEntityRefV3; terms: Record<string, unknown>; createdMonth: string; choices: Array<StrategicChoiceV3<ActionOf<'respond-proposal'>>> }> }
  | { tool: 'change-policy'; current: { taxBurdenBp: number; exemptionBp: number; priorities: Record<string, number> }; choices: Array<StrategicChoiceV3<ActionOf<'change-policy'>>> }
  | { tool: 'respond-faction'; factions: Array<{ faction: StrategicEntityRefV3; escalation: string; supportBp: number; powerBp: number; preferredPolicy: Record<string, unknown>; foreignPolicy: string; choices: Array<StrategicChoiceV3<ActionOf<'respond-faction'>>> }> }
  | { tool: 'start-project'; projects: Array<{ template: StrategicEntityRefV3; kind: string; cost: number; durationMonths: number; capacity: Record<string, unknown>; effectSummary: string; familiarityBp: number; targetMode: 'none' | 'owned-region' | 'foreign-polity'; targets: StrategicEntityRefV3[]; choices: Array<StrategicChoiceV3<ActionOf<'start-project'>>> }> }
  | { tool: 'mobilize'; regions: Array<{ region: StrategicEntityRefV3; availableManpower: number; availableEquipment: number; commanders: Array<StrategicEntityRefV3 | null>; choices: Array<StrategicChoiceV3<ActionOf<'mobilize'>>> }> }
  | { tool: 'declare-war'; defenders: Array<{ defender: StrategicEntityRefV3; reasons: Array<{ reason: ActionOf<'declare-war'>['reason']; evidenceRef: string | null; choice: StrategicChoiceV3<ActionOf<'declare-war'>> }> }> }
  | { tool: 'issue-order'; formations: Array<{ formation: StrategicEntityRefV3; status: string; location: StrategicEntityRefV3; home: StrategicEntityRefV3; posture: string; forceBand: string; choices: Array<StrategicChoiceV3<ActionOf<'issue-order'>>> }> }
  | { tool: 'negotiate-peace'; wars: Array<{ war: StrategicEntityRefV3; opposingLeader: StrategicEntityRefV3; occupations: StrategicEntityRefV3[]; pendingOffer: boolean; choices: Array<StrategicChoiceV3<ActionOf<'negotiate-peace'>>> }> };

export interface StrategicContextV3 {
  interests: string[];
  threats: string[];
  obligations: string[];
  redLines: string[];
  causalAnchors: Array<{ anchorId: string; interest: string; applicability: string[]; invalidators: string[] }>;
  memory: string[];
}

export interface StrategicBriefV3 {
  schemaVersion: 'open-historia-strategic-brief/3';
  decisionSchemaVersion: 'open-historia-strategic-decision/2';
  polity: StrategicEntityRefV3;
  month: string;
  revision: string;
  economy: StrategicBriefV2['economy'];
  goals: Array<Record<string, unknown>>;
  context: StrategicContextV3;
  affordances: StrategicAffordanceV3[];
  unsupportedMechanics: string[];
}

export interface StrategicBatchV3 {
  schemaVersion: 'open-historia-strategic-batch/3';
  promptContract: 'StrategicBriefV3+StrategicDecisionV2';
  batchId: string;
  month: string;
  baseRevision: string;
  polityIds: string[];
  briefs: StrategicBriefV3[];
  characterCount: number;
}

export interface StrategicResourceFlowV2 {
  resource: string;
  stockpile: number;
  monthlyProduction: number;
  monthlyConsumption: number;
  monthlyBalance: number;
  runwayMonths: number | null;
}

export interface StrategicBriefV2 {
  schemaVersion: 'open-historia-strategic-brief/2';
  polityId: string;
  name: string;
  month: string;
  revision: string;
  economy: { treasury: number; resources: StrategicResourceFlowV2[]; limitingInputs: string[]; foodShortfall: number; macro: { realOutputProxy: number; indexBp: number; contributions: Array<{ cause: string; amount: number }> } };
  goals: Array<Record<string, unknown>>;
  threats: string[];
  relations: Array<Record<string, unknown>>;
  obligations: Array<Record<string, unknown>>;
  memory: string[];
  entities: { polities: string[]; regions: string[]; routes: string[]; resources: string[]; factions: string[]; formations: string[] };
  tools: Array<{ tool: StrategicActionV2['tool']; allowed: Record<string, unknown> }>;
  previews: Array<{ tool: string; summary: string; evidence: Record<string, unknown> }>;
  unsupportedMechanics: string[];
}

const polityLedger = (ledger: { polities: PolityLedger[] }, polityId: string) => ledger.polities.find((entry) => entry.polityId === polityId);
const stockRecord = (state: EconWorldState, polityId: string) => Object.fromEntries(state.polities.find((entry) => entry.id === polityId)!.stockpile.map((entry) => [entry.resource, entry.amount]));

export function buildStrategicBriefV2(state: EconWorldState, polityId: string, options: {
  strategicContext?: { threats?: string[]; obligations?: string[]; memory?: string[] };
  baselineOutput?: number;
} = {}): StrategicBriefV2 {
  const polity = state.polities.find((entry) => entry.id === polityId);
  if (!polity) throw new Error(`unknown polity ${polityId}`);
  const preview = runTurn(state, { commands: [] }).result;
  const ledger = polityLedger(preview.ledger, polityId);
  if (!ledger) throw new Error(`missing ledger for ${polityId}`);
  const before = stockRecord(state, polityId);
  const after = stockRecord(preview.state, polityId);
  const production = new Map(ledger.production.map((entry) => [entry.resource, entry.total]));
  const resources = state.activeResources.map((resource) => {
    const monthlyProduction = production.get(resource) ?? 0;
    const monthlyBalance = (after[resource] ?? 0) - (before[resource] ?? 0);
    const monthlyConsumption = Math.max(0, monthlyProduction - monthlyBalance);
    const runwayMonths = monthlyBalance < 0 ? Math.floor((before[resource] ?? 0) / -monthlyBalance) : null;
    return { resource, stockpile: before[resource] ?? 0, monthlyProduction, monthlyConsumption, monthlyBalance, runwayMonths };
  });
  const realOutputProxy = ledger.production.reduce((sum, entry) => sum + entry.total, 0);
  const baseline = Math.max(1, options.baselineOutput ?? realOutputProxy);
  const relations = (state.diplomacy?.relations ?? []).filter((entry) => entry.polities.includes(polityId as never)).map((entry) => ({
    polityId: entry.polities.find((id) => id !== polityId), opinion: entry.opinion, trust: entry.trust, threat: entry.threat,
  })).sort((a, b) => String(a.polityId).localeCompare(String(b.polityId)));
  const regions = state.regions.filter((entry) => entry.controllerId === polityId).map((entry) => entry.regionId).sort();
  const routes = (state.trade?.routes ?? []).filter((entry) => entry.polities.includes(polityId as never)).map((entry) => relationKey(...entry.polities)).sort();
  const proposals = (state.diplomacy?.proposals ?? []).filter((entry) => entry.proposerId === polityId || entry.recipientId === polityId);
  const agreements = (state.diplomacy?.agreements ?? []).filter((entry) => entry.terms.fromPolityId === polityId || entry.terms.toPolityId === polityId);
  const factions = (state.politics?.factions ?? []).filter((entry) => entry.polityId === polityId).map((entry) => entry.factionId).sort();
  const formations = (state.military?.formations ?? []).filter((entry) => entry.polityId === polityId && !['destroyed', 'demobilized'].includes(entry.status)).map((entry) => entry.formationId).sort();
  const polityIds = state.polities.map((entry) => entry.id).sort();
  const routePartners = (state.trade?.routes ?? []).filter((entry) => entry.polities.includes(polityId as never)).map((entry) => entry.polities.find((id) => id !== polityId)!).sort();
  const tool = (name: StrategicActionV2['tool'], allowed: Record<string, unknown>) => ({ tool: name, allowed });
  const tools: StrategicBriefV2['tools'] = [
    tool('conserve', {}), tool('invest', { targetRegionId: regions, scale: scaleSchema.options }),
    tool('reallocate-production', { targetRegionId: state.regions.filter((entry) => entry.controllerId === polityId && (entry.activities?.length ?? 0) > 1).map((entry) => entry.regionId).sort(), priority: ['food', 'raw-materials', 'industry'], scale: scaleSchema.options }),
    ...(state.modules?.trade ? [tool('negotiate-trade', { partner: routePartners, resource: state.activeResources, desiredRunway: runwaySchema.options, budgetAttitude: budgetAttitudeSchema.options }),
      tool('external-import', { partner: routePartners.filter((id) => /soviet-union|united-states/.test(id)), resource: state.activeResources, desiredRunway: runwaySchema.options, budgetAttitude: budgetAttitudeSchema.options })] : []),
    ...(state.modules?.diplomacy ? [tool('propose-agreement', { partner: polityIds.filter((id) => id !== polityId), agreementType: ['non-aggression', 'defensive-alliance', 'guarantee', 'military-access'] }),
      tool('respond-proposal', { proposalId: proposals.filter((entry) => entry.recipientId === polityId).map((entry) => entry.proposalId), response: ['accept', 'reject'] }),
      tool('apply-diplomatic-pressure', { partner: polityIds.filter((id) => id !== polityId), demand: ['territorial-concession', 'policy-change', 'military-access'], targetRegionId: state.regions.filter((entry) => entry.controllerId !== polityId).map((entry) => entry.regionId).slice(0, 12), pressure: scaleSchema.options })] : []),
    ...(state.finance ? [tool('change-policy', { taxStance: ['relieve', 'steady', 'raise'], budgetPriority: ['administration', 'science', 'industry', 'security', 'military'] })] : []),
    ...(factions.length ? [tool('respond-faction', { factionId: factions, response: ['concede', 'repress', 'refuse'] })] : []),
    ...(state.projects ? [tool('start-project', { templateId: state.projects.templates.map((entry) => entry.templateId), targetRegionId: regions, targetPolityId: polityIds, scale: scaleSchema.options })] : []),
    ...(state.military ? [tool('mobilize', { locationRegionId: regions, scale: scaleSchema.options, commanderId: state.military.commanders.filter((entry) => entry.polityId === polityId).map((entry) => entry.commanderId) }),
      tool('declare-war', { defender: polityIds.filter((id) => id !== polityId), reason: ['claim', 'defense', 'guarantee', 'rivalry', 'none'] }),
      tool('issue-order', { formationId: formations, posture: ['hold', 'defend', 'advance', 'withdraw'] }),
      tool('negotiate-peace', { warId: state.military.wars.filter((entry) => entry.status === 'active' && [...entry.attackers, ...entry.defenders].includes(polityId as never)).map((entry) => entry.warId), approach: ['status-quo', 'limited-concessions', 'press-claims'] })] : []),
  ];
  return {
    schemaVersion: 'open-historia-strategic-brief/2', polityId, name: polity.displayName.en, month: state.month, revision: state.revision,
    economy: { treasury: polity.treasury, resources, limitingInputs: [...(ledger.goods?.limitingInputs ?? [])].sort(), foodShortfall: ledger.food.shortfall,
      macro: { realOutputProxy, indexBp: Math.floor(realOutputProxy * 10000 / baseline), contributions: [
        { cause: 'regional-production', amount: realOutputProxy },
        { cause: 'background-productivity-bp', amount: (state.economy.backgroundProductivityBpMonthly ?? 0) * state.turn },
        { cause: 'resource-shortages', amount: -(ledger.goods?.potential ?? 0) + (ledger.goods?.actual ?? 0) },
      ] } },
    goals: (state.campaign?.goals ?? []).filter((entry) => entry.polityId === polityId).slice(0, 6),
    threats: [...(options.strategicContext?.threats ?? [])].slice(0, 8), relations,
    obligations: [...agreements, ...(options.strategicContext?.obligations ?? []).map((summary) => ({ summary }))].slice(0, 8),
    memory: [...(options.strategicContext?.memory ?? [])].slice(-12),
    entities: { polities: polityIds, regions, routes, resources: [...state.activeResources], factions, formations },
    tools, previews: resources.filter((entry) => entry.runwayMonths !== null).map((entry) => ({ tool: 'resource-response', summary: `${entry.resource} exhausts in about ${entry.runwayMonths} months at the previewed flow.`, evidence: { resource: entry.resource, runwayMonths: entry.runwayMonths, monthlyBalance: entry.monthlyBalance } })),
    unsupportedMechanics: ['model-authored numeric effects', 'direct annexation', 'unsourced demographic consequences'],
  };
}

const uuid = (seed: string): string => {
  const hex = sha256OfString(seed).slice(7, 39).split(''); hex[12] = '4'; hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16] ?? '0', 16) % 4] ?? '8';
  const raw = hex.join(''); return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
};
const stableToken = (seed: string) => sha256OfString(seed).slice(7, 23);
const scaleValue = (scale: z.infer<typeof scaleSchema>, values: readonly [number, number, number]) => values[scale === 'small' ? 0 : scale === 'medium' ? 1 : 2];
const shared = (state: EconWorldState, actor: string, actionIndex: number) => ({
  commandId: uuid(`${state.revision}|${actor}|${actionIndex}`), actorPolityId: actor, expectedRevision: state.revision, effectiveMonth: state.month,
});

export interface StrategicMaterializationV2 {
  commands: EconCommand[];
  unsupportedResidual: string[];
  rejected: Array<{ actionIndex: number; reason: string }>;
}

export function materializeStrategicDecisionV2(state: EconWorldState, raw: unknown, context: { expectedRevision?: string; effectiveMonth?: string } = {}): StrategicMaterializationV2 {
  const decision = strategicDecisionV2Schema.parse(raw);
  if (context.expectedRevision !== undefined && context.expectedRevision !== state.revision) {
    return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: `stale-revision: expected ${context.expectedRevision}, world at ${state.revision}` }] };
  }
  if (context.effectiveMonth !== undefined && context.effectiveMonth !== state.month) {
    return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: `wrong-month: expected ${context.effectiveMonth}, world at ${state.month}` }] };
  }
  const actor = state.polities.find((entry) => entry.id === decision.polityId);
  if (!actor) throw new Error(`unknown strategic actor ${decision.polityId}`);
  const brief = buildStrategicBriefV2(state, decision.polityId);
  const allowedByTool = new Map(brief.tools.map((entry) => [entry.tool, entry.allowed]));
  const commands: EconCommand[] = [];
  const unsupportedResidual: string[] = [];
  const rejected: Array<{ actionIndex: number; reason: string }> = [];
  const requireTool = (tool: StrategicActionV2['tool'], index: number) => {
    if (!allowedByTool.has(tool)) { rejected.push({ actionIndex: index, reason: `tool ${tool} is disabled` }); return false; }
    return true;
  };
  const add = (value: unknown, index: number) => {
    const parsed = econCommandSchema.safeParse(value);
    if (parsed.success) commands.push(parsed.data);
    else rejected.push({ actionIndex: index, reason: parsed.error.issues[0]?.message ?? 'invalid materialized command' });
  };
  for (const [index, action] of decision.actions.entries()) {
    if (!requireTool(action.tool, index) || action.tool === 'conserve') continue;
    const ids = shared(state, decision.polityId, index);
    if (action.tool === 'invest') {
      const spend = Math.min(actor.treasury, scaleValue(action.scale, [100, 250, 500]));
      add({ kind: 'economy.invest-region', ...ids, targetRegionId: action.targetRegionId, spend }, index);
    } else if (action.tool === 'reallocate-production') {
      const region = state.regions.find((entry) => entry.regionId === action.targetRegionId && entry.controllerId === decision.polityId);
      if (!region?.activities || region.activities.length < 2) { rejected.push({ actionIndex: index, reason: 'target has no reallocatable authored activities' }); continue; }
      const matches = (entry: (typeof region.activities)[number]) => action.priority === 'food'
        ? entry.activity.kind === 'extraction' && entry.activity.resource === 'food'
        : action.priority === 'industry' ? entry.activity.kind === 'processing'
          : entry.activity.kind === 'extraction' && entry.activity.resource !== 'food';
      const selected = region.activities.findIndex(matches);
      if (selected < 0) { rejected.push({ actionIndex: index, reason: `target has no ${action.priority} activity` }); continue; }
      const delta = Math.min(scaleValue(action.scale, [1000, 2500, 5000]), 10000 - region.activities[selected]!.allocationBp);
      const allocations = region.activities.map((entry) => ({ activity: { ...entry.activity }, allocationBp: entry.allocationBp }));
      allocations[selected]!.allocationBp += delta;
      let remaining = delta;
      for (const candidate of allocations.map((entry, candidateIndex) => ({ entry, candidateIndex })).filter((entry) => entry.candidateIndex !== selected)
        .sort((left, right) => right.entry.allocationBp - left.entry.allocationBp || left.candidateIndex - right.candidateIndex)) {
        const taken = Math.min(candidate.entry.allocationBp, remaining); candidate.entry.allocationBp -= taken; remaining -= taken;
        if (remaining === 0) break;
      }
      add({ kind: 'economy.reallocate-production', ...ids, targetRegionId: action.targetRegionId, allocations }, index);
    } else if (action.tool === 'negotiate-trade' || action.tool === 'external-import') {
      const flow = brief.economy.resources.find((entry) => entry.resource === action.resource);
      const route = state.trade?.routes.find((entry) => relationKey(...entry.polities) === relationKey(decision.polityId, action.partner));
      if (!flow || !route) { rejected.push({ actionIndex: index, reason: 'resource or authored trade route is unavailable' }); continue; }
      if (action.tool === 'external-import' && !/soviet-union|united-states/.test(action.partner)) { rejected.push({ actionIndex: index, reason: 'external import requires a scenario-authored external supplier' }); continue; }
      if (actor.treasury <= 0) { rejected.push({ actionIndex: index, reason: 'insufficient treasury for a priced import proposal' }); continue; }
      const months = action.desiredRunway === 'short' ? 3 : action.desiredRunway === 'medium' ? 6 : 12;
      const deficit = Math.max(1, -flow.monthlyBalance);
      const quantity = Math.max(1, Math.min(route.monthlyCapacity, deficit));
      const value = state.economy.resourceParams.find((entry) => entry.resource === action.resource)?.accountingValue ?? 1;
      const premiumBp = action.budgetAttitude === 'cautious' ? 10000 : action.budgetAttitude === 'balanced' ? 11000 : 12500;
      const price = Math.max(1, Math.min(actor.treasury, Math.floor(quantity * value * premiumBp / 10000)));
      const proposalId = `proposal:${stableToken(`${state.revision}|trade|${decision.polityId}|${index}`)}`;
      add({ kind: 'diplomacy.propose', ...ids, proposalId, recipientPolityId: action.partner, terms: { kind: 'trade', fromPolityId: action.partner,
        toPolityId: decision.polityId, fromLeg: { kind: 'resource', resource: action.resource as ResourceId, amount: quantity },
        toLeg: { kind: 'treasury', amount: price }, cadence: 'monthly', durationMonths: Math.max(2, months), earlyTerminationPenalty: Math.floor(price / 2) } }, index);
    } else if (action.tool === 'propose-agreement') {
      add({ kind: 'diplomacy.propose', ...ids, proposalId: `proposal:${stableToken(`${state.revision}|agreement|${decision.polityId}|${index}`)}`,
        recipientPolityId: action.partner, terms: { kind: 'agreement', agreementType: action.agreementType, fromPolityId: decision.polityId, toPolityId: action.partner } }, index);
    } else if (action.tool === 'apply-diplomatic-pressure') {
      if (action.demand === 'territorial-concession' && action.targetRegionId) {
        if (!state.regions.some((entry) => entry.regionId === action.targetRegionId && entry.controllerId === action.partner)) {
          rejected.push({ actionIndex: index, reason: 'territorial pressure target is not controlled by the named partner' }); continue;
        }
        add({ kind: 'diplomacy.propose', ...ids, proposalId: `proposal:${stableToken(`${state.revision}|pressure|${decision.polityId}|${index}`)}`,
          recipientPolityId: action.partner, terms: { kind: 'territorial-settlement', fromPolityId: action.partner, toPolityId: decision.polityId, regionIds: [action.targetRegionId] } }, index);
      } else if (action.demand === 'military-access') {
        add({ kind: 'diplomacy.propose', ...ids, proposalId: `proposal:${stableToken(`${state.revision}|access|${decision.polityId}|${index}`)}`,
          recipientPolityId: action.partner, terms: { kind: 'agreement', agreementType: 'military-access', fromPolityId: action.partner, toPolityId: decision.polityId } }, index);
      } else unsupportedResidual.push(`diplomatic-pressure:${action.partner}:${action.demand}`);
    } else if (action.tool === 'respond-proposal') {
      add({ kind: 'diplomacy.respond', ...ids, proposalId: action.proposalId, response: action.response }, index);
    } else if (action.tool === 'change-policy') {
      const current = state.finance?.polities.find((entry) => entry.polityId === decision.polityId);
      if (!current) { rejected.push({ actionIndex: index, reason: 'finance state unavailable' }); continue; }
      const priorities = { administration: 1250, science: 1250, industry: 1250, security: 1250, military: 1250 };
      priorities[action.budgetPriority] = 5000;
      add({ kind: 'finance.set-policy', ...ids, taxBurdenBp: action.taxStance === 'relieve' ? 8500 : action.taxStance === 'raise' ? 11500 : 10000,
        exemptionBp: current.exemptionBp, priorities }, index);
    } else if (action.tool === 'respond-faction') {
      add({ kind: 'politics.respond', ...ids, factionId: action.factionId, response: action.response }, index);
    } else if (action.tool === 'start-project') {
      const template = state.projects?.templates.find((entry) => entry.templateId === action.templateId);
      if (!template) { rejected.push({ actionIndex: index, reason: 'unknown project template' }); continue; }
      const monthlyFunding = Math.max(1, Math.min(actor.treasury, Math.ceil(template.totalCost / scaleValue(action.scale, [12, 6, 3]))));
      add({ kind: 'project.start', ...ids, projectId: `project:${stableToken(`${state.revision}|${decision.polityId}|${index}`)}`,
        templateId: action.templateId, ...(action.targetRegionId ? { targetRegionId: action.targetRegionId } : {}),
        ...(action.targetPolityId ? { targetPolityId: action.targetPolityId } : {}), monthlyFunding, priority: scaleValue(action.scale, [2, 3, 5]) }, index);
    } else if (action.tool === 'mobilize') {
      const military = state.military?.polities.find((entry) => entry.polityId === decision.polityId);
      if (!military) { rejected.push({ actionIndex: index, reason: 'military state unavailable' }); continue; }
      const divisor = scaleValue(action.scale, [10, 4, 2]);
      const manpower = Math.floor(military.manpowerPool / divisor); const equipment = Math.min(military.equipmentReserve, manpower);
      add({ kind: 'military.mobilize', ...ids, formationId: `formation:${stableToken(`${state.revision}|${decision.polityId}|${index}`)}`,
        locationRegionId: action.locationRegionId, manpower, equipment, commanderId: action.commanderId ?? null }, index);
    } else if (action.tool === 'declare-war') {
      add({ kind: 'war.declare', ...ids, warId: `war:${stableToken(`${state.revision}|${decision.polityId}|${action.defender}`)}`,
        defenderPolityId: action.defender, reason: action.reason }, index);
    } else if (action.tool === 'issue-order') {
      add({ kind: 'military.order', ...ids, formationId: action.formationId, posture: action.posture, targetRegionId: action.targetRegionId }, index);
    } else if (action.tool === 'negotiate-peace') {
      const war = state.military?.wars.find((entry) => entry.warId === action.warId && entry.status === 'active');
      if (!war) { rejected.push({ actionIndex: index, reason: 'unknown active war' }); continue; }
      const opponent = war.attackers.includes(decision.polityId as never) ? (war.primaryDefenderPolityId ?? war.defenders[0]) : war.declaredByPolityId;
      const candidates = (state.military?.occupations ?? []).filter((entry) => entry.warId === war.warId && entry.actualControllerId === decision.polityId);
      const regionTransfers = action.approach === 'status-quo' ? [] : candidates.slice(0, action.approach === 'limited-concessions' ? 1 : 3).map((entry) => ({ regionId: entry.regionId, toPolityId: decision.polityId }));
      add({ kind: 'peace.propose', ...ids, offerId: `peace:${stableToken(`${state.revision}|${decision.polityId}|${index}`)}`, warId: war.warId,
        recipientPolityId: opponent, regionTransfers, reparation: null }, index);
    }
  }
  if (rejected.length) return { commands: [], unsupportedResidual, rejected };
  const incompatible = commands.filter((entry) => entry.kind === 'war.declare').some((war) => commands.some((entry) =>
    entry.kind === 'diplomacy.propose' && entry.recipientPolityId === war.defenderPolityId));
  if (incompatible) return { commands: [], unsupportedResidual, rejected: [{ actionIndex: -1, reason: 'cannot negotiate with and declare war on the same polity in one checkpoint' }] };
  const dryRun = runTurn(state, { commands });
  if (dryRun.result.rejections.length) return { commands: [], unsupportedResidual, rejected: dryRun.result.rejections.map((entry) => ({ actionIndex: commands.findIndex((command) => command.commandId === entry.command.commandId), reason: `${entry.reason}: ${entry.detail}` })) };
  if (decision.intendedOutcome && unsupportedResidual.length) unsupportedResidual.push(`intended-outcome:${decision.intendedOutcome}`);
  return { commands, unsupportedResidual, rejected: [] };
}

export interface StrategicBatchV2 {
  schemaVersion: 'open-historia-strategic-batch/2';
  batchId: string;
  month: string;
  baseRevision: string;
  polityIds: string[];
  briefs: StrategicBriefV2[];
  characterCount: number;
}

export function buildStrategicBatchesV2(state: EconWorldState, playerPolityId: string, options: {
  strategicContextByPolity?: Record<string, { threats?: string[]; obligations?: string[]; memory?: string[] }>;
  requestedPolityIds?: string[];
} = {}): StrategicBatchV2[] {
  const allowed = new Set<string>(state.polities.filter((entry) => entry.id !== playerPolityId).map((entry) => entry.id));
  const polityIds = (options.requestedPolityIds ?? [...allowed]).filter((entry) => allowed.has(entry)).sort();
  const batches: StrategicBatchV2[] = [];
  for (let index = 0; index < polityIds.length; index += 6) {
    const ids = polityIds.slice(index, index + 6);
    const briefs = ids.map((polityId) => buildStrategicBriefV2(state, polityId, { strategicContext: options.strategicContextByPolity?.[polityId] }));
    const characterCount = JSON.stringify(briefs).length;
    if (characterCount > 40000) throw new Error('strategic V2 batch exceeds character budget');
    batches.push({ schemaVersion: 'open-historia-strategic-batch/2', batchId: sha256OfString(`${state.revision}|strategic-v2|${ids.join('|')}`),
      month: state.month, baseRevision: state.revision, polityIds: ids, briefs, characterCount });
  }
  return batches;
}

export function validateStrategicBatchV2(raw: unknown, batch: StrategicBatchV2): StrategicDecisionBatchV2 {
  const parsed = strategicDecisionBatchV2Schema.parse(raw);
  const expected = [...batch.polityIds].sort();
  const actual = parsed.decisions.map((entry) => entry.polityId).sort();
  if (new Set(actual).size !== actual.length || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('strategic V2 batch must decide every and only requested polity');
  return parsed;
}

export function materializeStrategicBatchV2(state: EconWorldState, raw: unknown, batch: StrategicBatchV2): StrategicMaterializationV2 {
  const parsed = validateStrategicBatchV2(raw, batch);
  if (batch.baseRevision !== state.revision || batch.month !== state.month) {
    return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: batch.baseRevision !== state.revision ? 'stale-revision' : 'wrong-month' }] };
  }
  const results = parsed.decisions.map((entry) => materializeStrategicDecisionV2(state, entry, { expectedRevision: batch.baseRevision, effectiveMonth: batch.month }));
  const rejected = results.flatMap((entry) => entry.rejected);
  if (rejected.length) return { commands: [], unsupportedResidual: results.flatMap((entry) => entry.unsupportedResidual), rejected };
  const commands = results.flatMap((entry) => entry.commands).sort((a, b) => `${a.actorPolityId}|${a.commandId}`.localeCompare(`${b.actorPolityId}|${b.commandId}`));
  const dryRun = runTurn(state, { commands });
  if (dryRun.result.rejections.length) return { commands: [], unsupportedResidual: results.flatMap((entry) => entry.unsupportedResidual),
    rejected: dryRun.result.rejections.map((entry) => ({ actionIndex: -1, reason: `${entry.reason}: ${entry.detail}` })) };
  return { commands, unsupportedResidual: results.flatMap((entry) => entry.unsupportedResidual), rejected: [] };
}

const V3_LIMIT = 40000;
const budgetCategories = ['administration', 'science', 'industry', 'security', 'military'] as const;
type BudgetCategory = typeof budgetCategories[number];
type V3Options = {
  strategicContext?: Partial<StrategicContextV3>;
  baselineOutput?: number;
  externalSupplierPolityIds?: string[];
  requestedTools?: StrategicActionV2['tool'][];
  maxMaterialToolAffordances?: number;
};

const ref = (id: string, name: string): StrategicEntityRefV3 => ({ id, name });
const polityRef = (state: EconWorldState, id: string): StrategicEntityRefV3 =>
  ref(id, state.polities.find((entry) => entry.id === id)?.displayName.en ?? id);
const regionRef = (state: EconWorldState, id: string): StrategicEntityRefV3 =>
  ref(id, state.regions.find((entry) => entry.regionId === id)?.displayName.en ?? id);
const optionKey = (action: StrategicActionV2): string => JSON.stringify(action);
const actualControllerV3 = (state: EconWorldState, regionId: string): string | undefined => {
  const region = state.regions.find((entry) => entry.regionId === regionId);
  return region ? actualController(state.military, regionId, region.controllerId) : undefined;
};
const relationV3 = (state: EconWorldState, left: string, right: string) => state.diplomacy?.relations.find((entry) =>
  relationKey(...entry.polities) === relationKey(left, right));
const activeWarBetween = (state: EconWorldState, left: string, right: string) => state.military?.wars.find((war) => war.status === 'active'
  && ((war.attackers.includes(left as never) && war.defenders.includes(right as never))
    || (war.defenders.includes(left as never) && war.attackers.includes(right as never))));
const partiesMatch = (terms: { fromPolityId: string; toPolityId: string }, left: string, right: string) =>
  relationKey(terms.fromPolityId, terms.toPolityId) === relationKey(left, right);
const equivalentAgreement = (state: EconWorldState, left: string, right: string, agreementType: string) =>
  (state.diplomacy?.agreements ?? []).some((entry) => entry.terms.kind === 'agreement' && entry.terms.agreementType === agreementType
    && partiesMatch(entry.terms, left, right))
  || (state.diplomacy?.proposals ?? []).some((entry) => entry.terms.kind === 'agreement' && entry.terms.agreementType === agreementType
    && partiesMatch(entry.terms, left, right));

const reallocationFor = (state: EconWorldState, action: ActionOf<'reallocate-production'>) => {
  const target = state.regions.find((entry) => entry.regionId === action.targetRegionId);
  if (!target?.activities || target.activities.length < 2) return null;
  const matches = (entry: (typeof target.activities)[number]) => action.priority === 'food'
    ? entry.activity.kind === 'extraction' && entry.activity.resource === 'food'
    : action.priority === 'industry' ? entry.activity.kind === 'processing'
      : entry.activity.kind === 'extraction' && entry.activity.resource !== 'food';
  const selected = target.activities.findIndex(matches);
  if (selected < 0) return null;
  const delta = Math.min(scaleValue(action.scale, [1000, 2500, 5000]), 10000 - target.activities[selected]!.allocationBp);
  if (delta <= 0) return null;
  const allocations = target.activities.map((entry) => ({ activity: { ...entry.activity }, allocationBp: entry.allocationBp }));
  allocations[selected]!.allocationBp += delta;
  let remaining = delta;
  for (const candidate of allocations.map((entry, index) => ({ entry, index })).filter((entry) => entry.index !== selected)
    .sort((a, b) => b.entry.allocationBp - a.entry.allocationBp || a.index - b.index)) {
    const taken = Math.min(candidate.entry.allocationBp, remaining);
    candidate.entry.allocationBp -= taken;
    remaining -= taken;
    if (remaining === 0) break;
  }
  return remaining === 0 ? allocations : null;
};

const redistributedPriorities = (current: Record<BudgetCategory, number>, emphasized: BudgetCategory): Record<BudgetCategory, number> => {
  const result = { ...current };
  const wanted = Math.min(1500, 10000 - result[emphasized]);
  const donors = budgetCategories.filter((entry) => entry !== emphasized && result[entry] > 0);
  const total = donors.reduce((sum, entry) => sum + result[entry], 0);
  if (wanted === 0 || total === 0) return result;
  const shares = donors.map((entry) => {
    const numerator = wanted * result[entry];
    return { entry, amount: Math.floor(numerator / total), remainder: numerator % total };
  });
  let assigned = shares.reduce((sum, entry) => sum + entry.amount, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.entry.localeCompare(b.entry))) {
    if (assigned >= wanted) break;
    share.amount += 1;
    assigned += 1;
  }
  for (const share of shares) result[share.entry] -= share.amount;
  result[emphasized] += assigned;
  return result;
};

/** Pure structural mapper. It deliberately performs no affordance matching or engine legality checks. */
export function mapStrategicActionToCommandsUncheckedV3(state: EconWorldState, actorId: string, action: StrategicActionV2): EconCommand[] {
  if (action.tool === 'conserve') return [];
  const actor = state.polities.find((entry) => entry.id === actorId);
  if (!actor) return [];
  const ids = { commandId: uuid(`${state.revision}|v3|${actorId}|${optionKey(action)}`), actorPolityId: actorId,
    expectedRevision: state.revision, effectiveMonth: state.month };
  if (action.tool === 'invest') {
    return econCommandSchema.array().parse([{ kind: 'economy.invest-region', ...ids, targetRegionId: action.targetRegionId,
      spend: Math.min(actor.treasury, scaleValue(action.scale, [100, 250, 500])) }]);
  }
  if (action.tool === 'reallocate-production') {
    const allocations = reallocationFor(state, action);
    return allocations ? econCommandSchema.array().parse([{ kind: 'economy.reallocate-production', ...ids, targetRegionId: action.targetRegionId, allocations }]) : [];
  }
  if (action.tool === 'negotiate-trade' || action.tool === 'external-import') {
    const brief = buildEconomyV3(state, actorId);
    const flow = brief.resources.find((entry) => entry.resource === action.resource);
    const route = state.trade?.routes.find((entry) => relationKey(...entry.polities) === relationKey(actorId, action.partner));
    if (!flow || !route || actor.treasury <= 0) return [];
    const months = action.desiredRunway === 'short' ? 3 : action.desiredRunway === 'medium' ? 6 : 12;
    const quantity = Math.max(1, Math.min(route.monthlyCapacity, Math.max(1, -flow.monthlyBalance)));
    const value = state.economy.resourceParams.find((entry) => entry.resource === action.resource)?.accountingValue ?? 1;
    const premiumBp = action.budgetAttitude === 'cautious' ? 10000 : action.budgetAttitude === 'balanced' ? 11000 : 12500;
    const price = Math.max(1, Math.min(actor.treasury, Math.floor(quantity * value * premiumBp / 10000)));
    return econCommandSchema.array().parse([{ kind: 'diplomacy.propose', ...ids,
      proposalId: `proposal:${stableToken(`${state.revision}|v3|trade|${actorId}|${optionKey(action)}`)}`, recipientPolityId: action.partner,
      terms: { kind: 'trade', fromPolityId: action.partner, toPolityId: actorId,
        fromLeg: { kind: 'resource', resource: action.resource as ResourceId, amount: quantity }, toLeg: { kind: 'treasury', amount: price },
        cadence: 'monthly', durationMonths: Math.max(2, months), earlyTerminationPenalty: Math.floor(price / 2) } }]);
  }
  if (action.tool === 'propose-agreement') return econCommandSchema.array().parse([{ kind: 'diplomacy.propose', ...ids,
    proposalId: `proposal:${stableToken(`${state.revision}|v3|agreement|${actorId}|${optionKey(action)}`)}`, recipientPolityId: action.partner,
    terms: { kind: 'agreement', agreementType: action.agreementType, fromPolityId: actorId, toPolityId: action.partner } }]);
  if (action.tool === 'apply-diplomatic-pressure') {
    if (action.demand === 'territorial-concession' && action.targetRegionId) return econCommandSchema.array().parse([{ kind: 'diplomacy.propose', ...ids,
      proposalId: `proposal:${stableToken(`${state.revision}|v3|pressure|${actorId}|${optionKey(action)}`)}`, recipientPolityId: action.partner,
      terms: { kind: 'territorial-settlement', fromPolityId: action.partner, toPolityId: actorId, regionIds: [action.targetRegionId] } }]);
    if (action.demand === 'military-access') return econCommandSchema.array().parse([{ kind: 'diplomacy.propose', ...ids,
      proposalId: `proposal:${stableToken(`${state.revision}|v3|access|${actorId}|${optionKey(action)}`)}`, recipientPolityId: action.partner,
      terms: { kind: 'agreement', agreementType: 'military-access', fromPolityId: action.partner, toPolityId: actorId } }]);
    return [];
  }
  if (action.tool === 'respond-proposal') return econCommandSchema.array().parse([{ kind: 'diplomacy.respond', ...ids,
    proposalId: action.proposalId, response: action.response }]);
  if (action.tool === 'change-policy') {
    const current = state.finance?.polities.find((entry) => entry.polityId === actorId);
    if (!current) return [];
    const taxBurdenBp = Math.max(5000, Math.min(15000, current.taxBurdenBp + (action.taxStance === 'relieve' ? -1500 : action.taxStance === 'raise' ? 1500 : 0)));
    return econCommandSchema.array().parse([{ kind: 'finance.set-policy', ...ids, taxBurdenBp, exemptionBp: current.exemptionBp,
      priorities: redistributedPriorities(current.priorities, action.budgetPriority) }]);
  }
  if (action.tool === 'respond-faction') return econCommandSchema.array().parse([{ kind: 'politics.respond', ...ids,
    factionId: action.factionId, response: action.response }]);
  if (action.tool === 'start-project') {
    const template = state.projects?.templates.find((entry) => entry.templateId === action.templateId);
    if (!template) return [];
    const monthlyFunding = Math.max(1, Math.min(actor.treasury, Math.ceil(template.totalCost / scaleValue(action.scale, [12, 6, 3]))));
    return econCommandSchema.array().parse([{ kind: 'project.start', ...ids,
      projectId: `project:${stableToken(`${state.revision}|v3|${actorId}|${optionKey(action)}`)}`, templateId: action.templateId,
      ...(action.targetRegionId ? { targetRegionId: action.targetRegionId } : {}), ...(action.targetPolityId ? { targetPolityId: action.targetPolityId } : {}),
      monthlyFunding, priority: scaleValue(action.scale, [2, 3, 5]) }]);
  }
  if (action.tool === 'mobilize') {
    const military = state.military?.polities.find((entry) => entry.polityId === actorId);
    if (!military) return [];
    const identityAvailable = Math.max(0, Math.floor(military.manpowerCeiling * polityIdentityEffects(state.identity, state.regions, actorId).recruitmentMultiplierBp / 10000)
      - military.mobilized - military.casualties);
    const available = Math.min(military.manpowerPool, identityAvailable);
    const manpower = Math.floor(available / scaleValue(action.scale, [10, 4, 2]));
    const equipment = Math.min(military.equipmentReserve, manpower);
    if (manpower <= 0 || equipment <= 0) return [];
    return econCommandSchema.array().parse([{ kind: 'military.mobilize', ...ids,
      formationId: `formation:${stableToken(`${state.revision}|v3|${actorId}|${optionKey(action)}`)}`, locationRegionId: action.locationRegionId,
      manpower, equipment, commanderId: action.commanderId ?? null }]);
  }
  if (action.tool === 'declare-war') return econCommandSchema.array().parse([{ kind: 'war.declare', ...ids,
    warId: `war:${stableToken(`${state.revision}|v3|${actorId}|${optionKey(action)}`)}`, defenderPolityId: action.defender, reason: action.reason }]);
  if (action.tool === 'issue-order') return econCommandSchema.array().parse([{ kind: 'military.order', ...ids,
    formationId: action.formationId, posture: action.posture, targetRegionId: action.targetRegionId }]);
  const war = state.military?.wars.find((entry) => entry.warId === action.warId && entry.status === 'active');
  if (!war) return [];
  const opponent = war.attackers.includes(actorId as never) ? (war.primaryDefenderPolityId ?? war.defenders[0]!) : war.declaredByPolityId;
  const candidates = (state.military?.occupations ?? []).filter((entry) => entry.warId === war.warId && entry.actualControllerId === actorId)
    .sort((a, b) => a.regionId.localeCompare(b.regionId));
  const regionTransfers = action.approach === 'status-quo' ? [] : candidates.slice(0, action.approach === 'limited-concessions' ? 1 : 3)
    .map((entry) => ({ regionId: entry.regionId, toPolityId: actorId }));
  return econCommandSchema.array().parse([{ kind: 'peace.propose', ...ids,
    offerId: `peace:${stableToken(`${state.revision}|v3|${actorId}|${optionKey(action)}`)}`, warId: war.warId,
    recipientPolityId: opponent, regionTransfers, reparation: null }]);
}

const buildEconomyV3 = (state: EconWorldState, polityId: string, baselineOutput?: number): StrategicBriefV2['economy'] => {
  const polity = state.polities.find((entry) => entry.id === polityId)!;
  const preview = runTurn(state, { commands: [] }).result;
  const ledger = polityLedger(preview.ledger, polityId)!;
  const before = stockRecord(state, polityId);
  const after = stockRecord(preview.state, polityId);
  const production = new Map(ledger.production.map((entry) => [entry.resource, entry.total]));
  const resources = state.activeResources.map((resource) => {
    const monthlyProduction = production.get(resource) ?? 0;
    const monthlyBalance = (after[resource] ?? 0) - (before[resource] ?? 0);
    return { resource, stockpile: before[resource] ?? 0, monthlyProduction,
      monthlyConsumption: Math.max(0, monthlyProduction - monthlyBalance), monthlyBalance,
      runwayMonths: monthlyBalance < 0 ? Math.floor((before[resource] ?? 0) / -monthlyBalance) : null };
  });
  const realOutputProxy = ledger.production.reduce((sum, entry) => sum + entry.total, 0);
  return { treasury: polity.treasury, resources, limitingInputs: [...(ledger.goods?.limitingInputs ?? [])].sort(), foodShortfall: ledger.food.shortfall,
    macro: { realOutputProxy, indexBp: Math.floor(realOutputProxy * 10000 / Math.max(1, baselineOutput ?? realOutputProxy)), contributions: [
      { cause: 'regional-production', amount: realOutputProxy },
      { cause: 'background-productivity-bp', amount: (state.economy.backgroundProductivityBpMonthly ?? 0) * state.turn },
      { cause: 'resource-shortages', amount: -(ledger.goods?.potential ?? 0) + (ledger.goods?.actual ?? 0),
      } ] } };
};

const previewFor = (state: EconWorldState, actorId: string, action: StrategicActionV2, commands: EconCommand[], after: EconWorldState): StrategicPreviewV3 => {
  const deltas: StrategicPreviewV3['deltas'] = [];
  const beforePolity = state.polities.find((entry) => entry.id === actorId)!;
  const afterPolity = after.polities.find((entry) => entry.id === actorId)!;
  if (beforePolity.treasury !== afterPolity.treasury) deltas.push({ path: `polities.${actorId}.treasury`, before: beforePolity.treasury, after: afterPolity.treasury });
  const command = commands[0];
  if (command?.kind === 'economy.invest-region') {
    const before = state.regions.find((entry) => entry.regionId === command.targetRegionId)!.infrastructureBp;
    const value = after.regions.find((entry) => entry.regionId === command.targetRegionId)!.infrastructureBp;
    deltas.push({ path: `regions.${command.targetRegionId}.infrastructureBp`, before, after: value });
  } else if (command?.kind === 'economy.reallocate-production') {
    const before = state.regions.find((entry) => entry.regionId === command.targetRegionId)?.activities ?? [];
    const changed = command.allocations.map((entry, index) => ({ index, beforeBp: before[index]?.allocationBp, afterBp: entry.allocationBp }))
      .filter((entry) => entry.beforeBp !== entry.afterBp);
    deltas.push({ path: `regions.${command.targetRegionId}.allocationBp`, before: changed.map((entry) => [entry.index, entry.beforeBp]),
      after: changed.map((entry) => [entry.index, entry.afterBp]) });
  } else if (command?.kind === 'finance.set-policy') {
    const current = state.finance!.polities.find((entry) => entry.polityId === actorId)!;
    deltas.push({ path: `finance.${actorId}.taxBurdenBp`, before: current.taxBurdenBp, after: command.taxBurdenBp });
    deltas.push({ path: `finance.${actorId}.priorities`, before: current.priorities, after: command.priorities });
  } else if (command?.kind === 'diplomacy.propose') {
    deltas.push({ path: 'diplomacy.pendingProposal', before: null, after: command.terms });
    if (action.tool === 'apply-diplomatic-pressure') deltas.push({ path: 'diplomacy.pressureRiskBand', before: null, after: action.pressure });
  } else if (command?.kind === 'military.mobilize') {
    deltas.push({ path: 'military.newFormation', before: null, after: { manpower: command.manpower, equipment: command.equipment,
      readyMonth: after.military?.formations.find((entry) => entry.formationId === command.formationId)?.readyMonth ?? null } });
  } else if (command?.kind === 'peace.propose') deltas.push({ path: 'military.pendingPeacePackage', before: null, after: command.regionTransfers });
  else deltas.push({ path: `${action.tool}.engineResult`, before: null, after: 'accepted in isolated dry run' });
  return { summary: 'Accepted by isolated engine dry run.',
    commandKinds: commands.map((entry) => entry.kind), deltas };
};

const compileChoice = <A extends StrategicActionV2>(state: EconWorldState, actorId: string, action: A): StrategicChoiceV3<A> | null => {
  try {
    const commands = mapStrategicActionToCommandsUncheckedV3(state, actorId, action);
    if (commands.length === 0) return null;
    const dry = runTurn(state, { commands }).result;
    if (dry.rejections.length) return null;
    return { action, preview: previewFor(state, actorId, action, commands, dry.state) };
  } catch { return null; }
};

export function expandStrategicAffordancesV3(brief: StrategicBriefV3): StrategicActionV2[] {
  const actions: StrategicActionV2[] = [];
  for (const affordance of brief.affordances) {
    if (affordance.tool === 'conserve') actions.push(affordance.choice.action);
    else if (affordance.tool === 'invest') actions.push(...affordance.regions.flatMap((entry) => entry.scales.map((choice) => choice.action)));
    else if (affordance.tool === 'reallocate-production') actions.push(...affordance.regions.flatMap((entry) => entry.priorities.flatMap((priority) => priority.scales.map((choice) => choice.action))));
    else if (affordance.tool === 'negotiate-trade' || affordance.tool === 'external-import') actions.push(...affordance.partners.flatMap((entry) => entry.resources.flatMap((resource) => resource.choices.map((choice) => choice.action))));
    else if (affordance.tool === 'propose-agreement') actions.push(...affordance.partners.flatMap((entry) => entry.choices.map((choice) => choice.action)));
    else if (affordance.tool === 'apply-diplomatic-pressure') actions.push(...affordance.partners.flatMap((entry) => entry.choices.map((choice) => choice.action)));
    else if (affordance.tool === 'respond-proposal') actions.push(...affordance.proposals.flatMap((entry) => entry.choices.map((choice) => choice.action)));
    else if (affordance.tool === 'change-policy') actions.push(...affordance.choices.map((choice) => choice.action));
    else if (affordance.tool === 'respond-faction') actions.push(...affordance.factions.flatMap((entry) => entry.choices.map((choice) => choice.action)));
    else if (affordance.tool === 'start-project') actions.push(...affordance.projects.flatMap((entry) => entry.choices.map((choice) => choice.action)));
    else if (affordance.tool === 'mobilize') actions.push(...affordance.regions.flatMap((entry) => entry.choices.map((choice) => choice.action)));
    else if (affordance.tool === 'declare-war') actions.push(...affordance.defenders.flatMap((entry) => entry.reasons.map((reason) => reason.choice.action)));
    else if (affordance.tool === 'issue-order') actions.push(...affordance.formations.flatMap((entry) => entry.choices.map((choice) => choice.action)));
    else if (affordance.tool === 'negotiate-peace') actions.push(...affordance.wars.flatMap((entry) => entry.choices.map((choice) => choice.action)));
  }
  return actions;
}

export function buildStrategicBriefV3(state: EconWorldState, polityId: string, options: V3Options = {}): StrategicBriefV3 {
  const polity = state.polities.find((entry) => entry.id === polityId);
  if (!polity) throw new Error(`unknown polity ${polityId}`);
  const economy = buildEconomyV3(state, polityId, options.baselineOutput);
  const affordances: StrategicAffordanceV3[] = [{ tool: 'conserve', choice: { action: { tool: 'conserve' },
    preview: { summary: 'Take no material command at this checkpoint.', commandKinds: [], deltas: [] } } }];
  const controlled = state.regions.filter((entry) => entry.controllerId === polityId).sort((a, b) => a.regionId.localeCompare(b.regionId));
  const actuallyControlled = controlled.filter((entry) => actualControllerV3(state, entry.regionId) === polityId);
  const scales = scaleSchema.options;

  const investRegions = controlled.filter((entry) => entry.infrastructureBp < 10000)
    .sort((a, b) => a.infrastructureBp - b.infrastructureBp || a.regionId.localeCompare(b.regionId)).slice(0, 1).map((region) => ({
    region: regionRef(state, region.regionId), scales: scales.map((scale) => compileChoice(state, polityId,
      { tool: 'invest', targetRegionId: region.regionId, scale })).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  })).filter((entry) => entry.scales.length);
  if (investRegions.length) affordances.push({ tool: 'invest', regions: investRegions });

  const priorityValues = ['food', 'raw-materials', 'industry'] as const;
  const reallocRegions = controlled.filter((entry) => (entry.activities?.length ?? 0) > 1).slice(0, 1).map((region) => ({
    region: regionRef(state, region.regionId), priorities: priorityValues.map((priority) => ({ priority,
      scales: scales.map((scale) => compileChoice(state, polityId, { tool: 'reallocate-production', targetRegionId: region.regionId, priority, scale }))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    })).filter((entry) => entry.scales.length),
  })).filter((entry) => entry.priorities.length);
  if (reallocRegions.length) affordances.push({ tool: 'reallocate-production', regions: reallocRegions });

  if (state.modules?.trade && polity.treasury > 0) {
    const external = new Set(options.externalSupplierPolityIds ?? []);
    const routes = (state.trade?.routes ?? []).filter((entry) => entry.polities.includes(polityId as never))
      .map((entry) => ({ route: entry, partner: entry.polities.find((id) => id !== polityId)! }))
      .sort((a, b) => b.route.monthlyCapacity - a.route.monthlyCapacity || a.partner.localeCompare(b.partner));
    const tradeAffordance = (tool: 'negotiate-trade' | 'external-import', selected: typeof routes) => {
      const partners = selected.map(({ route, partner }) => ({ partner: polityRef(state, partner), routeCapacity: route.monthlyCapacity,
        resources: [...economy.resources].sort((a, b) => Number(a.monthlyBalance >= 0) - Number(b.monthlyBalance >= 0)
          || a.monthlyBalance - b.monthlyBalance || a.resource.localeCompare(b.resource)).slice(0, 1)
          .map((flow) => ({ resource: flow.resource, actorBalance: flow.monthlyBalance, actorRunwayMonths: flow.runwayMonths,
          choices: ([['short', 'cautious'], ['medium', 'balanced'], ['long', 'urgent']] as const).map(([desiredRunway, budgetAttitude]) => compileChoice(state, polityId,
            { tool, partner, resource: flow.resource, desiredRunway, budgetAttitude } as ActionOf<typeof tool>))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        })).filter((entry) => entry.choices.length),
      })).filter((entry) => entry.resources.length);
      if (partners.length) affordances.push({ tool, description: 'Import proposal into the acting polity. Route capacity is authored; supplier fulfillment is not guaranteed without current state evidence.', partners } as StrategicAffordanceV3);
    };
    tradeAffordance('negotiate-trade', routes.filter((entry) => !external.has(entry.partner)).slice(0, 1));
    tradeAffordance('external-import', routes.filter((entry) => external.has(entry.partner)).slice(0, 1));
  }

  if (state.modules?.diplomacy && state.diplomacy) {
    const partners = state.polities.filter((entry) => entry.id !== polityId).sort((a, b) => {
      const ar = relationV3(state, polityId, a.id); const br = relationV3(state, polityId, b.id);
      return (br?.threat ?? 0) - (ar?.threat ?? 0) || a.id.localeCompare(b.id);
    }).slice(0, 2);
    const agreementPartners = partners.map((partner) => {
      const activeOpponent = Boolean(activeWarBetween(state, polityId, partner.id));
      const choices = (['non-aggression', 'defensive-alliance', 'guarantee', 'military-access'] as const)
        .filter((agreementType) => !activeOpponent && !equivalentAgreement(state, polityId, partner.id, agreementType))
        .map((agreementType) => compileChoice(state, polityId, { tool: 'propose-agreement', partner: partner.id, agreementType }))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const relation = relationV3(state, polityId, partner.id);
      return { partner: polityRef(state, partner.id), relation: relation ? { opinion: relation.opinion, trust: relation.trust, threat: relation.threat } : null,
        activeAgreements: state.diplomacy!.agreements.filter((entry) => entry.terms.kind === 'agreement' && partiesMatch(entry.terms, polityId, partner.id))
          .map((entry) => entry.terms.kind === 'agreement' ? entry.terms.agreementType : '').sort(), choices };
    }).filter((entry) => entry.choices.length);
    if (agreementPartners.length) affordances.push({ tool: 'propose-agreement', partners: agreementPartners });

    const pressurePartners = partners.slice(0, 1).map((partner) => {
      const choices: Array<StrategicChoiceV3<ActionOf<'apply-diplomatic-pressure'>>> = [];
      for (const region of state.regions.filter((entry) => entry.controllerId === partner.id).sort((a, b) => a.regionId.localeCompare(b.regionId)).slice(0, 1)) {
        for (const pressure of ['medium'] as const) {
          const choice = compileChoice(state, polityId, { tool: 'apply-diplomatic-pressure', partner: partner.id,
            demand: 'territorial-concession', targetRegionId: region.regionId, pressure });
          if (choice) choices.push(choice);
        }
      }
      if (!equivalentAgreement(state, polityId, partner.id, 'military-access')) for (const pressure of ['medium'] as const) {
        const choice = compileChoice(state, polityId, { tool: 'apply-diplomatic-pressure', partner: partner.id, demand: 'military-access', pressure });
        if (choice) choices.push(choice);
      }
      return { partner: polityRef(state, partner.id), choices };
    }).filter((entry) => entry.choices.length);
    if (pressurePartners.length) affordances.push({ tool: 'apply-diplomatic-pressure', partners: pressurePartners });

    const proposalOptions = state.diplomacy.proposals.filter((entry) => entry.recipientId === polityId)
      .sort((a, b) => b.createdMonth.localeCompare(a.createdMonth) || a.proposalId.localeCompare(b.proposalId)).slice(0, 8).map((proposal) => {
        const choices = (['accept', 'reject'] as const).map((response) => compileChoice(state, polityId,
          { tool: 'respond-proposal', proposalId: proposal.proposalId, response })).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        return { proposal: ref(proposal.proposalId, `Proposal from ${polityRef(state, proposal.proposerId).name}`), proposer: polityRef(state, proposal.proposerId),
          terms: structuredClone(proposal.terms) as unknown as Record<string, unknown>, createdMonth: proposal.createdMonth, choices };
      }).filter((entry) => entry.choices.length);
    if (proposalOptions.length) affordances.push({ tool: 'respond-proposal', proposals: proposalOptions });
  }

  const finance = state.finance?.polities.find((entry) => entry.polityId === polityId);
  if (finance && state.modules?.finance) {
    const primaryBudget = [...budgetCategories].sort((a, b) => finance.priorities[b] - finance.priorities[a] || a.localeCompare(b))[0]!;
    const policyPairs = [
      ...budgetCategories.map((budgetPriority) => ['steady', budgetPriority] as const),
      ['relieve', primaryBudget] as const, ['raise', primaryBudget] as const,
    ];
    const choices = policyPairs.map(([taxStance, budgetPriority]) => compileChoice(state, polityId, { tool: 'change-policy', taxStance, budgetPriority }))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (choices.length) affordances.push({ tool: 'change-policy', current: { taxBurdenBp: finance.taxBurdenBp,
      exemptionBp: finance.exemptionBp, priorities: { ...finance.priorities } }, choices });
  }

  if (state.modules?.politics && state.politics) {
    const factions = state.politics.factions.filter((entry) => entry.polityId === polityId && entry.escalation !== 'calm' && entry.lastResponseMonth !== state.month)
      .sort((a, b) => a.factionId.localeCompare(b.factionId)).slice(0, 2).map((faction) => ({
        faction: ref(faction.factionId, faction.displayName.en), escalation: faction.escalation, supportBp: faction.supportBp, powerBp: faction.powerBp,
        preferredPolicy: { idealTaxBurdenBp: faction.idealTaxBurdenBp, budgetCategory: faction.preferredBudgetCategory }, foreignPolicy: faction.foreignPolicy,
        choices: (['concede', 'repress', 'refuse'] as const).map((response) => compileChoice(state, polityId,
          { tool: 'respond-faction', factionId: faction.factionId, response })).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      })).filter((entry) => entry.choices.length);
    if (factions.length) affordances.push({ tool: 'respond-faction', factions });
  }

  if (state.modules?.projects && state.projects && state.projects.projects.filter((entry) => entry.actorPolityId === polityId && entry.status === 'active').length < 8) {
    const unlocked = new Set((state.capabilities?.unlocked ?? []).filter((entry) => entry.polityId === polityId).map((entry) => entry.capabilityId));
    const known = new Set((state.intelligence?.knownFacts ?? []).filter((entry) => entry.observerPolityId === polityId).map((entry) => entry.factId));
    const projects = state.projects.templates.filter((template) => {
      if (template.effect.kind !== 'unlock-capability') return true;
      if (!state.modules?.technology || !state.capabilities || unlocked.has(template.effect.capabilityId)) return false;
      const capabilityId = template.effect.capabilityId;
      const definition = state.capabilities.catalog.find((entry) => entry.capabilityId === capabilityId);
      return Boolean(definition?.prerequisiteIds.every((entry) => unlocked.has(entry)))
        && !state.projects!.projects.some((entry) => entry.actorPolityId === polityId && entry.status === 'active'
          && state.projects!.templates.find((candidate) => candidate.templateId === entry.templateId)?.effect.kind === 'unlock-capability'
          && (state.projects!.templates.find((candidate) => candidate.templateId === entry.templateId)?.effect as { capabilityId?: string }).capabilityId === capabilityId);
    }).sort((a, b) => a.templateId.localeCompare(b.templateId)).slice(0, 2).map((template) => {
      const targetMode = template.effect.kind === 'infrastructure' ? 'owned-region' as const : template.effect.kind === 'reveal-intelligence' ? 'foreign-polity' as const : 'none' as const;
      const targets = targetMode === 'owned-region' ? controlled.slice(0, 8).map((entry) => regionRef(state, entry.regionId))
        : targetMode === 'foreign-polity' && state.modules?.intelligence ? state.polities.filter((entry) => entry.id !== polityId
          && (state.intelligence?.truths ?? []).some((fact) => fact.subjectPolityId === entry.id && !known.has(fact.factId)))
          .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 12).map((entry) => polityRef(state, entry.id)) : [];
      const targetRows: Array<StrategicEntityRefV3 | null> = targetMode === 'none' ? [null] : targets;
      const choices = targetRows.flatMap((target) => scales.map((scale) => compileChoice(state, polityId, {
        tool: 'start-project', templateId: template.templateId, scale,
        ...(targetMode === 'owned-region' && target ? { targetRegionId: target.id } : {}),
        ...(targetMode === 'foreign-polity' && target ? { targetPolityId: target.id } : {}),
      }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return { template: ref(template.templateId, template.displayName.en), kind: template.kind, cost: template.totalCost,
        durationMonths: template.durationMonths, capacity: { ...template.capacity }, effectSummary: JSON.stringify(template.effect),
        familiarityBp: state.projects!.familiarity.find((entry) => entry.polityId === polityId && entry.templateId === template.templateId)?.familiarityBp ?? 0,
        targetMode, targets, choices };
    }).filter((entry) => entry.choices.length);
    if (projects.length) affordances.push({ tool: 'start-project', projects });
  }

  if (state.modules?.armedForces && state.military) {
    const military = state.military.polities.find((entry) => entry.polityId === polityId);
    if (military) {
      const identityAvailable = Math.max(0, Math.floor(military.manpowerCeiling * polityIdentityEffects(state.identity, state.regions, polityId).recruitmentMultiplierBp / 10000)
        - military.mobilized - military.casualties);
      const availableManpower = Math.min(military.manpowerPool, identityAvailable);
      const commanders: Array<StrategicEntityRefV3 | null> = [null, ...state.military.commanders.filter((entry) => entry.polityId === polityId)
        .sort((a, b) => a.commanderId.localeCompare(b.commanderId)).slice(0, 1).map((entry) => ref(entry.commanderId, entry.displayName.en))];
      const regions = actuallyControlled.slice(0, 1).map((region) => ({ region: regionRef(state, region.regionId), availableManpower,
        availableEquipment: military.equipmentReserve, commanders,
        choices: commanders.flatMap((commander) => scales.map((scale) => compileChoice(state, polityId,
          { tool: 'mobilize', locationRegionId: region.regionId, scale, commanderId: commander?.id ?? null })))
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      })).filter((entry) => entry.choices.length);
      if (regions.length) affordances.push({ tool: 'mobilize', regions });
    }

    const defenders = state.polities.filter((entry) => entry.id !== polityId && !activeWarBetween(state, polityId, entry.id)
      && !(state.diplomacy?.agreements ?? []).some((agreement) => agreement.terms.kind === 'agreement'
        && ['non-aggression', 'defensive-alliance'].includes(agreement.terms.agreementType) && partiesMatch(agreement.terms, polityId, entry.id)))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2).map((defender) => {
        const reasons: Array<{ reason: ActionOf<'declare-war'>['reason']; evidenceRef: string | null }> = [{ reason: 'none', evidenceRef: null }];
        const claim = (state.campaign?.goals ?? []).find((goal) => goal.polityId === polityId && goal.kind === 'control-region'
          && ['active', 'candidate'].includes(goal.status) && state.regions.some((region) => region.regionId === goal.regionId && region.controllerId === defender.id));
        if (claim) reasons.push({ reason: 'claim', evidenceRef: claim.goalId });
        const relation = relationV3(state, polityId, defender.id);
        if (relation && (relation.threat >= 5000 || relation.opinion <= -2000)) reasons.push({ reason: 'rivalry', evidenceRef: `relation:${relationKey(polityId, defender.id)}` });
        for (const agreement of state.diplomacy?.agreements ?? []) if (agreement.terms.kind === 'agreement'
          && ['guarantee', 'defensive-alliance'].includes(agreement.terms.agreementType)) {
          const beneficiary = agreement.terms.fromPolityId === polityId ? agreement.terms.toPolityId : agreement.terms.toPolityId === polityId ? agreement.terms.fromPolityId : null;
          if (beneficiary && activeWarBetween(state, beneficiary, defender.id)) reasons.push({ reason: agreement.terms.agreementType === 'guarantee' ? 'guarantee' : 'defense', evidenceRef: agreement.agreementId });
        }
        return { defender: polityRef(state, defender.id), reasons: reasons.map((reason) => {
          const choice = compileChoice(state, polityId, { tool: 'declare-war', defender: defender.id, reason: reason.reason });
          return choice ? { ...reason, choice } : null;
        }).filter((entry): entry is NonNullable<typeof entry> => entry !== null) };
      }).filter((entry) => entry.reasons.length);
    if (defenders.length) affordances.push({ tool: 'declare-war', defenders });

    const formations = state.military.formations.filter((entry) => entry.polityId === polityId && entry.status === 'active')
      .sort((a, b) => a.formationId.localeCompare(b.formationId)).slice(0, 3).map((formation) => {
        const actions: ActionOf<'issue-order'>[] = [
          { tool: 'issue-order', formationId: formation.formationId, posture: 'hold', targetRegionId: null },
          { tool: 'issue-order', formationId: formation.formationId, posture: 'defend', targetRegionId: null },
        ];
        if (actualControllerV3(state, formation.homeRegionId) === polityId) actions.push({ tool: 'issue-order', formationId: formation.formationId, posture: 'withdraw', targetRegionId: null });
        const links = state.military!.supplyLinks.filter((entry) => entry.regions.includes(formation.locationRegionId as never) && entry.capacity > 0)
          .map((entry) => entry.regions.find((id) => id !== formation.locationRegionId)!).sort().slice(0, 6);
        for (const targetRegionId of links) {
          const controller = actualControllerV3(state, targetRegionId);
          if (controller && activeWarBetween(state, polityId, controller)) actions.push({ tool: 'issue-order', formationId: formation.formationId, posture: 'advance', targetRegionId });
        }
        const choices = actions.map((action) => compileChoice(state, polityId, action)).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        const band = formation.manpower < 10000 ? 'small' : formation.manpower < 50000 ? 'medium' : 'large';
        return { formation: ref(formation.formationId, formation.displayName.en), status: formation.status,
          location: regionRef(state, formation.locationRegionId), home: regionRef(state, formation.homeRegionId), posture: formation.posture, forceBand: band, choices };
      }).filter((entry) => entry.choices.length);
    if (formations.length) affordances.push({ tool: 'issue-order', formations });

    const wars = state.military.wars.filter((entry) => entry.status === 'active'
      && [entry.declaredByPolityId, entry.primaryDefenderPolityId ?? entry.defenders[0]].includes(polityId as never))
      .sort((a, b) => a.warId.localeCompare(b.warId)).slice(0, 8).map((war) => {
        const opposingLeader = war.declaredByPolityId === polityId ? (war.primaryDefenderPolityId ?? war.defenders[0]!) : war.declaredByPolityId;
        const occupations = state.military!.occupations.filter((entry) => entry.warId === war.warId).sort((a, b) => a.regionId.localeCompare(b.regionId));
        const approaches: ActionOf<'negotiate-peace'>['approach'][] = ['status-quo'];
        if (occupations.some((entry) => entry.actualControllerId === polityId)) approaches.push('limited-concessions', 'press-claims');
        const choices = approaches.map((approach) => compileChoice(state, polityId, { tool: 'negotiate-peace', warId: war.warId, approach }))
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        return { war: ref(war.warId, `War against ${polityRef(state, opposingLeader).name}`), opposingLeader: polityRef(state, opposingLeader),
          occupations: occupations.map((entry) => regionRef(state, entry.regionId)), pendingOffer: state.military!.peaceOffers.some((entry) => entry.warId === war.warId && entry.status === 'pending'), choices };
      }).filter((entry) => entry.choices.length);
    if (wars.length) affordances.push({ tool: 'negotiate-peace', wars });
  }

  const supplied = options.strategicContext ?? {};
  const priority: Record<StrategicActionV2['tool'], number> = {
    'respond-proposal': 150, 'issue-order': 140, 'negotiate-peace': 135, 'reallocate-production': 130,
    'external-import': 125, 'negotiate-trade': 120, 'respond-faction': 115, mobilize: 110,
    'change-policy': 105, 'start-project': 100, 'propose-agreement': 95, 'apply-diplomatic-pressure': 90,
    'declare-war': 85, invest: 80, conserve: 1000,
  };
  const requested = options.requestedTools ? new Set(options.requestedTools) : null;
  const materialAffordances = affordances.filter((entry) => entry.tool !== 'conserve' && (!requested || requested.has(entry.tool)))
    .sort((a, b) => priority[b.tool] - priority[a.tool] || a.tool.localeCompare(b.tool));
  const publishedAffordances = [affordances[0]!, ...materialAffordances.slice(0, options.maxMaterialToolAffordances ?? materialAffordances.length)];
  return { schemaVersion: 'open-historia-strategic-brief/3', decisionSchemaVersion: 'open-historia-strategic-decision/2',
    polity: ref(polity.id, polity.displayName.en), month: state.month, revision: state.revision, economy,
    goals: (state.campaign?.goals ?? []).filter((entry) => entry.polityId === polityId).slice(0, 8),
    context: { interests: [...(supplied.interests ?? [])].slice(0, 8), threats: [...(supplied.threats ?? [])].slice(0, 8),
      obligations: [...(supplied.obligations ?? [])].slice(0, 8), redLines: [...(supplied.redLines ?? [])].slice(0, 8),
      causalAnchors: [...(supplied.causalAnchors ?? [])].slice(0, 8), memory: [...(supplied.memory ?? [])].slice(-12) },
    affordances: publishedAffordances, unsupportedMechanics: ['model-authored numeric effects', 'direct annexation', 'unsourced demographic consequences', 'policy-change pressure'],
  };
}

export function buildStrategicBatchesV3(state: EconWorldState, playerPolityId: string, options: V3Options & {
  strategicContextByPolity?: Record<string, Partial<StrategicContextV3>>;
  requestedPolityIds?: string[];
  systemText?: string;
} = {}): StrategicBatchV3[] {
  const allowed = new Set<string>(state.polities.filter((entry) => entry.id !== playerPolityId).map((entry) => entry.id));
  const ids = (options.requestedPolityIds ?? [...allowed]).filter((entry) => allowed.has(entry)).sort();
  const batches: StrategicBatchV3[] = [];
  let currentIds: string[] = [];
  let currentBriefs: StrategicBriefV3[] = [];
  const systemLength = (options.systemText ?? '').length;
  const flush = () => {
    if (!currentIds.length) return;
    const characterCount = systemLength + JSON.stringify({ briefs: currentBriefs }).length;
    batches.push({ schemaVersion: 'open-historia-strategic-batch/3', promptContract: 'StrategicBriefV3+StrategicDecisionV2',
      batchId: sha256OfString(`${state.revision}|strategic-v3|${currentIds.join('|')}`), month: state.month, baseRevision: state.revision,
      polityIds: currentIds, briefs: currentBriefs, characterCount });
    currentIds = []; currentBriefs = [];
  };
  for (const polityId of ids) {
    const brief = buildStrategicBriefV3(state, polityId, { ...options,
      maxMaterialToolAffordances: options.maxMaterialToolAffordances ?? (ids.length >= 6 ? 1 : undefined),
      strategicContext: options.strategicContextByPolity?.[polityId] });
    const candidateBriefs = [...currentBriefs, brief];
    const candidateSize = systemLength + JSON.stringify({ briefs: candidateBriefs }).length;
    if (currentIds.length && (currentIds.length >= 6 || candidateSize >= V3_LIMIT)) flush();
    const individualSize = systemLength + JSON.stringify({ briefs: [brief] }).length;
    if (individualSize >= V3_LIMIT) throw new Error(`individual strategic V3 brief exceeds ${V3_LIMIT} characters`);
    currentIds.push(polityId); currentBriefs.push(brief);
  }
  flush();
  return batches;
}

const exclusiveTargetV3 = (action: StrategicActionV2): string | null => {
  if (action.tool === 'respond-proposal') return `proposal:${action.proposalId}`;
  if (action.tool === 'respond-faction') return `faction:${action.factionId}`;
  if (action.tool === 'reallocate-production') return `reallocation:${action.targetRegionId}`;
  if (action.tool === 'issue-order') return `formation:${action.formationId}`;
  if (action.tool === 'invest') return `investment:${action.targetRegionId}`;
  if (action.tool === 'negotiate-peace') return `war:${action.warId}`;
  return null;
};

export function materializeStrategicDecisionV3(state: EconWorldState, raw: unknown, brief: StrategicBriefV3): StrategicMaterializationV2 {
  const parsed = strategicDecisionV2Schema.safeParse(raw);
  if (!parsed.success) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: parsed.error.issues[0]?.message ?? 'invalid decision' }] };
  const decision = parsed.data;
  if (brief.revision !== state.revision || brief.month !== state.month) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: brief.revision !== state.revision ? 'stale-revision' : 'wrong-month' }] };
  if (decision.polityId !== brief.polity.id) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: 'decision actor does not match frozen V3 brief' }] };
  const tools = decision.actions.map((entry) => entry.tool);
  if (new Set(tools).size !== tools.length) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: 'at most one action per tool is allowed' }] };
  const exclusive = decision.actions.map(exclusiveTargetV3).filter((entry): entry is string => entry !== null);
  if (new Set(exclusive).size !== exclusive.length) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: 'duplicate exclusive target' }] };
  const allowed = new Set(expandStrategicAffordancesV3(brief).map(optionKey));
  const outside = decision.actions.findIndex((entry) => !allowed.has(optionKey(entry)));
  if (outside >= 0) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: outside, reason: 'action is outside the frozen V3 affordance' }] };
  const warTargets = decision.actions.filter((entry): entry is ActionOf<'declare-war'> => entry.tool === 'declare-war').map((entry) => entry.defender);
  const negotiationTargets = decision.actions.flatMap((entry) => entry.tool === 'negotiate-trade' || entry.tool === 'external-import'
    || entry.tool === 'propose-agreement' || entry.tool === 'apply-diplomatic-pressure' ? [entry.partner] : []);
  if (warTargets.some((entry) => negotiationTargets.includes(entry))) return { commands: [], unsupportedResidual: [],
    rejected: [{ actionIndex: -1, reason: 'cannot negotiate, trade, or pressure and declare war on the same polity' }] };
  const commands = decision.actions.flatMap((action) => mapStrategicActionToCommandsUncheckedV3(state, decision.polityId, action));
  if (decision.hold === null && commands.length === 0) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: 'non-hold decision must materialize at least one engine command' }] };
  const dry = runTurn(state, { commands }).result;
  if (dry.rejections.length) return { commands: [], unsupportedResidual: [], rejected: dry.rejections.map((entry) => ({
    actionIndex: commands.findIndex((command) => command.commandId === entry.command.commandId), reason: `${entry.reason}: ${entry.detail}` })) };
  return { commands, unsupportedResidual: [], rejected: [] };
}

export function materializeStrategicBatchV3(state: EconWorldState, raw: unknown, batch: StrategicBatchV3): StrategicMaterializationV2 {
  const parsed = strategicDecisionBatchV2Schema.safeParse(raw);
  if (!parsed.success) return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: parsed.error.issues[0]?.message ?? 'invalid batch' }] };
  const expected = [...batch.polityIds].sort();
  const actual = parsed.data.decisions.map((entry) => entry.polityId).sort();
  if (new Set(actual).size !== actual.length || JSON.stringify(expected) !== JSON.stringify(actual)) return { commands: [], unsupportedResidual: [],
    rejected: [{ actionIndex: -1, reason: 'strategic V3 batch must decide every and only requested polity' }] };
  if (batch.baseRevision !== state.revision || batch.month !== state.month) return { commands: [], unsupportedResidual: [],
    rejected: [{ actionIndex: -1, reason: batch.baseRevision !== state.revision ? 'stale-revision' : 'wrong-month' }] };
  const results = parsed.data.decisions.map((decision) => materializeStrategicDecisionV3(state, decision,
    batch.briefs.find((brief) => brief.polity.id === decision.polityId)!));
  const rejected = results.flatMap((entry) => entry.rejected);
  if (rejected.length) return { commands: [], unsupportedResidual: [], rejected };
  const wars = results.flatMap((entry) => entry.commands).filter((entry): entry is Extract<EconCommand, { kind: 'war.declare' }> => entry.kind === 'war.declare');
  const warPairs = wars.map((entry) => relationKey(entry.actorPolityId, entry.defenderPolityId));
  if (new Set(warPairs).size !== warPairs.length || wars.some((entry) => wars.some((other) => entry.actorPolityId === other.defenderPolityId && entry.defenderPolityId === other.actorPolityId))) {
    return { commands: [], unsupportedResidual: [], rejected: [{ actionIndex: -1, reason: 'duplicate or reciprocal cross-actor war declaration' }] };
  }
  const commands = results.flatMap((entry) => entry.commands).sort((a, b) => `${a.actorPolityId}|${a.commandId}`.localeCompare(`${b.actorPolityId}|${b.commandId}`));
  const dry = runTurn(state, { commands }).result;
  if (dry.rejections.length) return { commands: [], unsupportedResidual: [], rejected: dry.rejections.map((entry) => ({ actionIndex: -1, reason: `${entry.reason}: ${entry.detail}` })) };
  return { commands, unsupportedResidual: [], rejected: [] };
}
