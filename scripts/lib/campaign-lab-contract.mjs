import { z } from "zod";
import { opponentDiplomacyBatchResultSchema } from "../../packages/agent-runtime/dist/index.js";
import { fitGeminiFunctionSchema } from "../../src/Game/AI/geminiProtocol.js";

export const CAMPAIGN_DECISION_RESPONSE_SCHEMA = Object.freeze(
  fitGeminiFunctionSchema(z.toJSONSchema(opponentDiplomacyBatchResultSchema)),
);

export const CAMPAIGN_DECISION_INTENTS = Object.freeze([
  ...CAMPAIGN_DECISION_RESPONSE_SCHEMA.properties.decisions.items.properties.intent.enum,
]);
