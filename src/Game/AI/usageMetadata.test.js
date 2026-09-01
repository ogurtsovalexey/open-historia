import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGeminiUsage } from "./usageMetadata.js";

test("normalizes Gemini usageMetadata without estimating missing fields", () => {
  assert.deepEqual(normalizeGeminiUsage({
    promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 4,
    cachedContentTokenCount: 20, totalTokenCount: 154,
  }), {
    inputTokens: 120, outputTokens: 30, reasoningTokens: 4,
    cachedInputTokens: 20, totalTokens: 154, source: "provider",
  });
  assert.equal(normalizeGeminiUsage(undefined), undefined);
  assert.deepEqual(normalizeGeminiUsage({ totalTokenCount: 5 }), {
    inputTokens: null, outputTokens: null, reasoningTokens: null,
    cachedInputTokens: null, totalTokens: 5, source: "provider",
  });
});
