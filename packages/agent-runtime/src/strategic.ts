import { z } from 'zod';
import {
  econCommandSchema,
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
