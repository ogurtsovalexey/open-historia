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
  targetRegionId: z.string().optional(), scale: z.enum(['small', 'medium', 'large']).optional(),
  priority: z.enum(['food', 'raw-materials', 'industry']).optional(), partner: z.string().optional(), resource: z.string().optional(),
  desiredRunway: z.enum(['short', 'medium', 'long']).optional(), budgetAttitude: z.enum(['cautious', 'balanced', 'urgent']).optional(),
  agreementType: z.enum(['non-aggression', 'defensive-alliance', 'guarantee', 'military-access']).optional(),
  demand: z.enum(['territorial-concession', 'policy-change', 'military-access']).optional(), pressure: z.enum(['small', 'medium', 'large']).optional(),
  proposalId: z.string().optional(), response: z.enum(['accept', 'reject', 'concede', 'repress', 'refuse']).optional(),
  taxStance: z.enum(['relieve', 'steady', 'raise']).optional(), budgetPriority: z.enum(['administration', 'science', 'industry', 'security', 'military']).optional(),
  factionId: z.string().optional(), templateId: z.string().optional(), targetPolityId: z.string().optional(), commanderId: z.string().optional(),
  defender: z.string().optional(), reason: z.enum(['claim', 'defense', 'guarantee', 'rivalry', 'none']).optional(),
  formationId: z.string().optional(), posture: z.enum(['hold', 'defend', 'advance', 'withdraw']).optional(), warId: z.string().optional(),
  approach: z.enum(['status-quo', 'limited-concessions', 'press-claims']).optional(),
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

export const normalizeCampaignDecisionWire = (raw) => ({
  ...raw,
  decisions: Array.isArray(raw?.decisions) ? raw.decisions.map((decision) => ({
    ...decision,
    hold: decision?.hold ?? null,
    actions: Array.isArray(decision?.actions) ? decision.actions.map((action) => action?.tool === 'issue-order' && action.targetRegionId === undefined
      ? { ...action, targetRegionId: null } : action) : decision?.actions,
  })) : raw?.decisions,
});
