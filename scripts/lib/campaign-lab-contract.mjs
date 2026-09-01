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
