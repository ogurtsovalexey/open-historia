import { z } from "zod";
import { strategicDecisionBatchV2Schema } from "../../packages/agent-runtime/dist/index.js";
import { fitGeminiFunctionSchema } from "../../src/Game/AI/geminiProtocol.js";

export const CAMPAIGN_DECISION_RESPONSE_SCHEMA = Object.freeze(
  fitGeminiFunctionSchema(z.toJSONSchema(strategicDecisionBatchV2Schema)),
);

export const CAMPAIGN_DECISION_TOOLS = Object.freeze([
  'invest', 'reallocate-production', 'conserve', 'negotiate-trade', 'external-import',
  'propose-agreement', 'apply-diplomatic-pressure', 'respond-proposal', 'change-policy',
  'respond-faction', 'start-project', 'mobilize', 'declare-war', 'issue-order', 'negotiate-peace',
]);
