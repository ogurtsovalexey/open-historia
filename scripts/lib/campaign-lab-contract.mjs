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
  target: z.string().optional(), counterpart: z.string().optional(), subject: z.string().optional(),
  choice: z.string().optional(), intensity: z.string().optional(),
}).strict();
const wireHoldSchema = z.object({
  reason: z.enum(['no-legal-action', 'waiting-response', 'insufficient-resources', 'plan-sequencing', 'risk-too-high']), detail: z.string(),
  revisit: z.object({ afterMonths: z.number().int().min(1).max(12), triggers: z.array(z.enum(['resource-deficit', 'diplomatic-response', 'war', 'occupation', 'peace', 'crisis', 'government-change', 'default'])).min(1).max(8) }).strict(),
}).strict();
const wireDecisionSchema = z.object({
  polityId: z.string(), objective: z.object({ domain: z.enum(['economy', 'diplomacy', 'politics', 'military', 'statecraft', 'campaign']), summary: z.string(), horizon: z.enum(['short', 'medium', 'long']) }).strict(),
  actions: z.array(wireActionSchema).max(3), futurePlan: z.array(z.object({ summary: z.string(), condition: z.string() }).strict()).max(8),
  contingency: z.string(), rationale: z.string(), intendedOutcome: z.string().optional(), hold: wireHoldSchema.optional(),
}).strict();

export const CAMPAIGN_DECISION_RESPONSE_SCHEMA = Object.freeze(
  fitGeminiFunctionSchema(z.toJSONSchema(z.object({ decisions: z.array(wireDecisionSchema).max(6) }).strict())),
);

export const encodeCampaignActionWire = (action) => {
  const tool = action?.tool;
  if (tool === 'invest') return { tool, target: action.targetRegionId, intensity: action.scale };
  if (tool === 'reallocate-production') return { tool, target: action.targetRegionId, choice: action.priority, intensity: action.scale };
  if (tool === 'negotiate-trade' || tool === 'external-import') return { tool, counterpart: action.partner, subject: action.resource, choice: action.desiredRunway, intensity: action.budgetAttitude };
  if (tool === 'propose-agreement') return { tool, counterpart: action.partner, choice: action.agreementType };
  if (tool === 'apply-diplomatic-pressure') return { tool, counterpart: action.partner, target: action.targetRegionId, choice: action.demand, intensity: action.pressure };
  if (tool === 'respond-proposal') return { tool, target: action.proposalId, choice: action.response };
  if (tool === 'change-policy') return { tool, choice: action.taxStance, subject: action.budgetPriority };
  if (tool === 'respond-faction') return { tool, target: action.factionId, choice: action.response };
  if (tool === 'start-project') return { tool, target: action.templateId, subject: action.targetRegionId, counterpart: action.targetPolityId, intensity: action.scale };
  if (tool === 'mobilize') return { tool, target: action.locationRegionId, subject: action.commanderId, intensity: action.scale };
  if (tool === 'declare-war') return { tool, counterpart: action.defender, choice: action.reason };
  if (tool === 'issue-order') return { tool, target: action.formationId, subject: action.targetRegionId ?? undefined, choice: action.posture };
  if (tool === 'negotiate-peace') return { tool, target: action.warId, choice: action.approach };
  return { tool };
};

const decodeCampaignActionWire = (action) => {
  const tool = action?.tool;
  if (tool === 'invest') return { tool, targetRegionId: action.target, scale: action.intensity };
  if (tool === 'reallocate-production') return { tool, targetRegionId: action.target, priority: action.choice, scale: action.intensity };
  if (tool === 'negotiate-trade' || tool === 'external-import') return { tool, partner: action.counterpart, resource: action.subject, desiredRunway: action.choice, budgetAttitude: action.intensity };
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
    ...decision,
    hold: decision?.hold ?? null,
    actions: Array.isArray(decision?.actions) ? decision.actions.map(decodeCampaignActionWire) : decision?.actions,
  })) : raw?.decisions,
});
