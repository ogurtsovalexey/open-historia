import { z } from "zod";
import { fitGeminiFunctionSchema } from "../../src/Game/AI/geminiProtocol.js";

export const CAMPAIGN_DECISION_TOOLS = Object.freeze([
  'invest', 'reallocate-production', 'conserve', 'negotiate-trade', 'external-import',
  'propose-agreement', 'apply-diplomatic-pressure', 'respond-proposal', 'change-policy',
  'respond-faction', 'start-project', 'mobilize', 'declare-war', 'issue-order', 'negotiate-peace',
]);

// Gemini rejects the full 15-branch discriminated union as responseJsonSchema.
// The wire contract is therefore a flat superset; the strict per-tool Zod
// union and semantic materializer still validate every returned decision.
const wireActionSchema = z.object({
  tool: z.enum(CAMPAIGN_DECISION_TOOLS),
  target: z.string(), counterpart: z.string(), subject: z.string(), choice: z.string(), intensity: z.string(),
}).strict();
const wireDecisionSchema = z.object({
  polityId: z.string(), objectiveDomain: z.enum(['economy', 'diplomacy', 'politics', 'military', 'statecraft', 'campaign']),
  objectiveSummary: z.string(), horizon: z.enum(['short', 'medium', 'long']),
  actions: z.array(wireActionSchema), futurePlan: z.array(z.object({ summary: z.string(), condition: z.string() }).strict()),
  contingency: z.string(), rationale: z.string(), intendedOutcome: z.string(),
  holdReason: z.enum(['none', 'no-legal-action', 'waiting-response', 'insufficient-resources', 'plan-sequencing', 'risk-too-high']),
  holdDetail: z.string(), revisitAfterMonths: z.number().int(), revisitTriggers: z.array(z.enum([
    'resource-deficit', 'diplomatic-response', 'war', 'occupation', 'peace', 'crisis', 'government-change', 'default',
  ])),
}).strict();

export const CAMPAIGN_DECISION_RESPONSE_SCHEMA = Object.freeze(
  fitGeminiFunctionSchema(z.toJSONSchema(z.object({ decisions: z.array(wireDecisionSchema) }).strict())),
);

export const encodeCampaignActionWire = (action) => {
  const wire = (tool, values = {}) => ({ tool, target: '', counterpart: '', subject: '', choice: '', intensity: '', ...values });
  const tool = action?.tool;
  if (tool === 'invest') return wire(tool, { target: action.targetRegionId, intensity: action.scale });
  if (tool === 'reallocate-production') return wire(tool, { target: action.targetRegionId, choice: action.priority, intensity: action.scale });
  if (tool === 'negotiate-trade' || tool === 'external-import') return wire(tool, { counterpart: action.partner, subject: action.resource, choice: action.desiredRunway, intensity: action.budgetAttitude });
  if (tool === 'propose-agreement') return wire(tool, { counterpart: action.partner, choice: action.agreementType });
  if (tool === 'apply-diplomatic-pressure') return wire(tool, { counterpart: action.partner, target: action.targetRegionId ?? '', choice: action.demand, intensity: action.pressure });
  if (tool === 'respond-proposal') return wire(tool, { target: action.proposalId, choice: action.response });
  if (tool === 'change-policy') return wire(tool, { choice: action.taxStance, subject: action.budgetPriority });
  if (tool === 'respond-faction') return wire(tool, { target: action.factionId, choice: action.response });
  if (tool === 'start-project') return wire(tool, { target: action.templateId, subject: action.targetRegionId ?? '', counterpart: action.targetPolityId ?? '', intensity: action.scale });
  if (tool === 'mobilize') return wire(tool, { target: action.locationRegionId, subject: action.commanderId ?? '', intensity: action.scale });
  if (tool === 'declare-war') return wire(tool, { counterpart: action.defender, choice: action.reason });
  if (tool === 'issue-order') return wire(tool, { target: action.formationId, subject: action.targetRegionId ?? '', choice: action.posture });
  if (tool === 'negotiate-peace') return wire(tool, { target: action.warId, choice: action.approach });
  return wire(tool);
};

export const encodeCampaignDecisionWire = (decision) => ({
  polityId: decision.polityId, objectiveDomain: decision.objective.domain, objectiveSummary: decision.objective.summary, horizon: decision.objective.horizon,
  actions: decision.actions.map(encodeCampaignActionWire), futurePlan: decision.futurePlan, contingency: decision.contingency,
  rationale: decision.rationale, intendedOutcome: decision.intendedOutcome ?? '', holdReason: decision.hold?.reason ?? 'none',
  holdDetail: decision.hold?.detail ?? '', revisitAfterMonths: decision.hold?.revisit.afterMonths ?? 1,
  revisitTriggers: decision.hold?.revisit.triggers ?? ['resource-deficit'],
});

const decodeCampaignActionWire = (action) => {
  const tool = action?.tool;
  if (tool === 'invest') return { tool, targetRegionId: action.target, scale: action.intensity };
  if (tool === 'reallocate-production') return { tool, targetRegionId: action.target, priority: action.choice, scale: action.intensity };
  if (tool === 'negotiate-trade' || tool === 'external-import') {
    // The compact wire has deliberately generic slots. Gemini occasionally
    // puts the two trade qualifiers in their semantically matching but
    // opposite slots (for example choice=balanced, intensity=medium). The
    // domains are disjoint, so this swap is deterministic and cannot hide an
    // unknown value; the strict StrategicDecisionV2 parser still rejects it.
    const runwayValues = new Set(['short', 'medium', 'long']);
    const budgetValues = new Set(['cautious', 'balanced', 'urgent']);
    const swapped = budgetValues.has(action.choice) && runwayValues.has(action.intensity);
    return { tool, partner: action.counterpart, resource: action.subject,
      desiredRunway: swapped ? action.intensity : action.choice,
      budgetAttitude: swapped ? action.choice : action.intensity };
  }
  if (tool === 'propose-agreement') return { tool, partner: action.counterpart, agreementType: action.choice };
  if (tool === 'apply-diplomatic-pressure') return { tool, partner: action.counterpart, ...(action.target ? { targetRegionId: action.target } : {}), demand: action.choice, pressure: action.intensity };
  if (tool === 'respond-proposal') return { tool, proposalId: action.target, response: action.choice };
  if (tool === 'change-policy') return { tool, taxStance: action.choice, budgetPriority: action.subject };
  if (tool === 'respond-faction') return { tool, factionId: action.target, response: action.choice };
  if (tool === 'start-project') return { tool, templateId: action.target, ...(action.subject ? { targetRegionId: action.subject } : {}), ...(action.counterpart ? { targetPolityId: action.counterpart } : {}), scale: action.intensity };
  if (tool === 'mobilize') return { tool, locationRegionId: action.target, ...(action.subject ? { commanderId: action.subject } : {}), scale: action.intensity };
  if (tool === 'declare-war') return { tool, defender: action.counterpart, reason: action.choice };
  if (tool === 'issue-order') return { tool, formationId: action.target, posture: action.choice, targetRegionId: action.subject ?? null };
  if (tool === 'negotiate-peace') return { tool, warId: action.target, approach: action.choice };
  return { tool };
};

export const normalizeCampaignDecisionWire = (raw) => ({
  ...raw,
  decisions: Array.isArray(raw?.decisions) ? raw.decisions.map((decision) => ({
    polityId: decision.polityId,
    objective: { domain: decision.objectiveDomain, summary: decision.objectiveSummary, horizon: decision.horizon },
    actions: Array.isArray(decision?.actions) ? decision.actions.map(decodeCampaignActionWire) : decision?.actions,
    futurePlan: decision.futurePlan, contingency: decision.contingency, rationale: decision.rationale,
    ...(decision.intendedOutcome ? { intendedOutcome: decision.intendedOutcome } : {}),
    hold: decision.holdReason === 'none' ? null : { reason: decision.holdReason, detail: decision.holdDetail,
      revisit: { afterMonths: decision.revisitAfterMonths, triggers: decision.revisitTriggers } },
  })) : raw?.decisions,
});

export const salvageCampaignDecisionBatch = (raw, polityIds, { acceptDecision, fallbackDecision }) => {
  const source = Array.isArray(raw?.decisions) ? raw.decisions : [];
  const replacedPolityIds = [];
  const decisions = polityIds.map((polityId) => {
    const matches = source.filter((decision) => decision?.polityId === polityId);
    if (matches.length === 1 && acceptDecision(matches[0])) return matches[0];
    replacedPolityIds.push(polityId);
    return fallbackDecision(polityId);
  });
  return { batch: { decisions }, replacedPolityIds };
};

// Codex output-schema accepts this flat named-field object. Every action field
// is required; fields unused by the selected tool MUST be the empty string.
const codexActionFields = Object.freeze([
  'targetRegionId', 'partner', 'resource', 'desiredRunway', 'budgetAttitude', 'agreementType', 'demand', 'pressure',
  'proposalId', 'response', 'taxStance', 'budgetPriority', 'priority', 'factionId', 'templateId', 'scale', 'targetPolityId',
  'commanderId', 'defender', 'reason', 'formationId', 'posture', 'warId', 'approach',
]);
const stringEnum = (...values) => ({ type: 'string', enum: values });
const codexActionProperties = Object.fromEntries(codexActionFields.map((field) => [field, { type: 'string' }]));
Object.assign(codexActionProperties, {
  desiredRunway: stringEnum('', 'short', 'medium', 'long'), budgetAttitude: stringEnum('', 'cautious', 'balanced', 'urgent'),
  agreementType: stringEnum('', 'non-aggression', 'defensive-alliance', 'guarantee', 'military-access'),
  demand: stringEnum('', 'territorial-concession', 'policy-change', 'military-access'), pressure: stringEnum('', 'small', 'medium', 'large'),
  response: stringEnum('', 'accept', 'reject', 'concede', 'repress', 'refuse'), taxStance: stringEnum('', 'relieve', 'steady', 'raise'),
  budgetPriority: stringEnum('', 'administration', 'science', 'industry', 'security', 'military'), scale: stringEnum('', 'small', 'medium', 'large'),
  priority: stringEnum('', 'food', 'raw-materials', 'industry'),
  reason: stringEnum('', 'claim', 'defense', 'guarantee', 'rivalry', 'none'), posture: stringEnum('', 'hold', 'defend', 'advance', 'withdraw'),
  approach: stringEnum('', 'status-quo', 'limited-concessions', 'press-claims'),
});

const CODEX_DECISION_RESPONSE_SCHEMA_BASE = {
  type: 'object', additionalProperties: false, required: ['decisions'], properties: {
    decisions: { type: 'array', maxItems: 6, items: {
      type: 'object', additionalProperties: false,
      required: ['polityId', 'objectiveDomain', 'objectiveSummary', 'horizon', 'actions', 'futurePlan', 'contingency', 'rationale',
        'intendedOutcome', 'holdReason', 'holdDetail', 'revisitAfterMonths', 'revisitTriggers'],
      properties: {
        polityId: { type: 'string' }, objectiveDomain: stringEnum('economy', 'diplomacy', 'politics', 'military', 'statecraft', 'campaign'),
        objectiveSummary: { type: 'string' }, horizon: stringEnum('short', 'medium', 'long'),
        actions: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false,
          required: ['tool', ...codexActionFields], properties: { tool: stringEnum(...CAMPAIGN_DECISION_TOOLS), ...codexActionProperties } } },
        futurePlan: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
          required: ['summary', 'condition'], properties: { summary: { type: 'string' }, condition: { type: 'string' } } } },
        contingency: { type: 'string' }, rationale: { type: 'string' }, intendedOutcome: { type: 'string' },
        holdReason: stringEnum('none', 'no-legal-action', 'waiting-response', 'insufficient-resources', 'plan-sequencing', 'risk-too-high'),
        holdDetail: { type: 'string' }, revisitAfterMonths: { type: 'integer', minimum: 1, maximum: 12 },
        revisitTriggers: { type: 'array', minItems: 1, maxItems: 8, items: stringEnum(
          'resource-deficit', 'diplomatic-response', 'war', 'occupation', 'peace', 'crisis', 'government-change', 'default') },
      },
    } },
  },
};

// The evaluator must bind each output schema to the concrete application
// batch. Exact length prevents a structurally valid partial response; the
// materializer still owns the separate exact-and-unique coverage check because
// JSON Schema cannot express uniqueness by polityId.
export const buildCodexDecisionResponseSchema = (polityIds) => {
  if (!Array.isArray(polityIds) || polityIds.length < 1 || polityIds.length > 6
    || new Set(polityIds).size !== polityIds.length
    || polityIds.some((polityId) => typeof polityId !== 'string' || !polityId)) {
    throw new Error('Codex output schema requires one to six unique polity ids');
  }
  const schema = structuredClone(CODEX_DECISION_RESPONSE_SCHEMA_BASE);
  schema.properties.decisions.minItems = polityIds.length;
  schema.properties.decisions.maxItems = polityIds.length;
  schema.properties.decisions.items.properties.polityId = { type: 'string', enum: [...polityIds] };
  return schema;
};

// Retained for transport unit tests and non-batch callers. Capability and
// production calls must use buildCodexDecisionResponseSchema(batch.polityIds).
export const CODEX_DECISION_RESPONSE_SCHEMA = Object.freeze(structuredClone(CODEX_DECISION_RESPONSE_SCHEMA_BASE));

const codexUsedFields = Object.freeze({
  invest: ['targetRegionId', 'scale'], 'reallocate-production': ['targetRegionId', 'priority', 'scale'], conserve: [],
  'negotiate-trade': ['partner', 'resource', 'desiredRunway', 'budgetAttitude'], 'external-import': ['partner', 'resource', 'desiredRunway', 'budgetAttitude'],
  'propose-agreement': ['partner', 'agreementType'], 'apply-diplomatic-pressure': ['partner', 'targetRegionId', 'demand', 'pressure'],
  'respond-proposal': ['proposalId', 'response'], 'change-policy': ['taxStance', 'budgetPriority'], 'respond-faction': ['factionId', 'response'],
  'start-project': ['templateId', 'scale', 'targetRegionId', 'targetPolityId'], mobilize: ['targetRegionId', 'scale', 'commanderId'],
  'declare-war': ['defender', 'reason'], 'issue-order': ['formationId', 'posture', 'targetRegionId'], 'negotiate-peace': ['warId', 'approach'],
});

const decodeCodexActionWire = (action) => {
  const used = new Set(codexUsedFields[action?.tool] ?? []);
  for (const field of codexActionFields) if (!used.has(field) && action?.[field] !== '') throw new Error(`Codex wire field ${field} must use the empty sentinel for ${action?.tool}`);
  const tool = action?.tool;
  if (tool === 'invest') return { tool, targetRegionId: action.targetRegionId, scale: action.scale };
  if (tool === 'reallocate-production') return { tool, targetRegionId: action.targetRegionId, priority: action.priority, scale: action.scale };
  if (tool === 'conserve') return { tool };
  if (tool === 'negotiate-trade' || tool === 'external-import') return { tool, partner: action.partner, resource: action.resource,
    desiredRunway: action.desiredRunway, budgetAttitude: action.budgetAttitude };
  if (tool === 'propose-agreement') return { tool, partner: action.partner, agreementType: action.agreementType };
  if (tool === 'apply-diplomatic-pressure') return { tool, partner: action.partner, demand: action.demand, pressure: action.pressure,
    ...(action.targetRegionId ? { targetRegionId: action.targetRegionId } : {}) };
  if (tool === 'respond-proposal') return { tool, proposalId: action.proposalId, response: action.response };
  if (tool === 'change-policy') return { tool, taxStance: action.taxStance, budgetPriority: action.budgetPriority };
  if (tool === 'respond-faction') return { tool, factionId: action.factionId, response: action.response };
  if (tool === 'start-project') return { tool, templateId: action.templateId, scale: action.scale,
    ...(action.targetRegionId ? { targetRegionId: action.targetRegionId } : {}), ...(action.targetPolityId ? { targetPolityId: action.targetPolityId } : {}) };
  if (tool === 'mobilize') return { tool, locationRegionId: action.targetRegionId, scale: action.scale,
    commanderId: action.commanderId || null };
  if (tool === 'declare-war') return { tool, defender: action.defender, reason: action.reason };
  if (tool === 'issue-order') return { tool, formationId: action.formationId, posture: action.posture, targetRegionId: action.targetRegionId || null };
  if (tool === 'negotiate-peace') return { tool, warId: action.warId, approach: action.approach };
  return { tool };
};

export const normalizeCodexDecisionWire = (raw) => ({
  decisions: Array.isArray(raw?.decisions) ? raw.decisions.map((decision) => ({
    polityId: decision.polityId, objective: { domain: decision.objectiveDomain, summary: decision.objectiveSummary, horizon: decision.horizon },
    actions: Array.isArray(decision.actions) ? decision.actions.map(decodeCodexActionWire) : decision.actions,
    futurePlan: decision.futurePlan, contingency: decision.contingency, rationale: decision.rationale,
    ...(decision.intendedOutcome ? { intendedOutcome: decision.intendedOutcome } : {}),
    hold: decision.holdReason === 'none' ? null : { reason: decision.holdReason, detail: decision.holdDetail,
      revisit: { afterMonths: decision.revisitAfterMonths, triggers: decision.revisitTriggers } },
  })) : raw?.decisions,
});

const numericClaimPattern = /\b-?\d+(?:[.,]\d+)?\s*(?:%|bp|gold|men|equipment|months?)(?!\w)/gi;
const unitForPublishedField = (field) => {
  if (/months?/i.test(field)) return 'months';
  if (/bp$/i.test(field)) return 'bp';
  if (/manpower|\bmen\b/i.test(field)) return 'men';
  if (/equipment/i.test(field)) return 'equipment';
  if (/treasury|cost|gold/i.test(field)) return 'gold';
  if (/percent|percentage|pct/i.test(field)) return '%';
  return null;
};
const normalizedClaim = (value, unit) => `${String(value).replace(',', '.')} ${unit.toLowerCase().replace(/^month$/, 'months')}`;

export const assessCodexDecisionReferences = (raw, prompt) => {
  const text = JSON.stringify(raw ?? null);
  const ids = text.match(/(?:polity|region|proposal|faction|formation|project|war|effect|intel|character):[a-z0-9._:-]+/gi) ?? [];
  const inventedReferences = [...new Set(ids.filter((id) => !prompt.includes(id)))].sort();
  const decisions = Array.isArray(raw?.decisions) ? raw.decisions : [];
  const narrative = decisions.flatMap((entry) => [entry?.objectiveSummary, entry?.rationale, entry?.intendedOutcome,
    entry?.contingency, ...(Array.isArray(entry?.futurePlan) ? entry.futurePlan.flatMap((plan) => [plan?.summary, plan?.condition]) : [])])
    .filter((entry) => typeof entry === 'string').join(' ');
  const published = new Set();
  for (const match of prompt.matchAll(/"([^"]+)":(-?\d+(?:\.\d+)?)/g)) {
    const unit = unitForPublishedField(match[1]);
    if (unit) published.add(normalizedClaim(match[2], unit));
  }
  const claims = [...narrative.matchAll(numericClaimPattern)].map((match) => match[0]);
  const publishedNumericCitations = claims.filter((claim) => {
    const parsed = claim.match(/(-?\d+(?:[.,]\d+)?)\s*(%|bp|gold|men|equipment|months?)/i);
    return parsed ? published.has(normalizedClaim(parsed[1], parsed[2])) : false;
  });
  const authoritativeNumericClaims = claims.filter((claim) => !publishedNumericCitations.includes(claim));
  return { inventedReferences, privateDoctrine: /lebensraum|private german doctrine|player doctrine/i.test(narrative),
    publishedNumericCitations, authoritativeNumericClaims };
};
