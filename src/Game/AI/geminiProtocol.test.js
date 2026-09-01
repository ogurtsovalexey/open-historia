import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeGeminiContents,
  fitGeminiFunctionSchema,
  getGeminiHeaders,
  getGeminiThinkingConfig,
  getGeminiUrl,
  toGeminiSchema,
} from "./geminiProtocol.js";

test("Gemini authentication stays out of request URLs", () => {
  assert.equal(getGeminiUrl("models/gemini-3.5-flash-lite"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  assert.equal(getGeminiUrl("gemini-3.5-flash-lite", { stream: true }),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
  assert.equal(getGeminiHeaders("secret")["x-goog-api-key"], "secret");
  assert.doesNotMatch(getGeminiUrl("gemini-3.5-flash-lite"), /secret|[?&]key=/);
});

test("oversized engine command unions are compacted at the provider boundary", () => {
  const schema = { type: "object", properties: { decisions: { type: "array", items: { type: "object", properties: {
    command: { anyOf: Array.from({ length: 10 }, (_, index) => ({ type: "object", description: "x".repeat(100), properties: { [`kind${index}`]: { type: "string" } } })) },
  } } } } };
  const fitted = fitGeminiFunctionSchema(schema, 500);
  assert.deepEqual(fitted.properties.decisions.items.properties.command.anyOf, [{ type: "object" }, { type: "null" }]);
});

test("Gemini schema conversion removes unsupported exclusive bounds", () => {
  assert.deepEqual(toGeminiSchema({ type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 10, const: 4, additionalProperties: false }), {
    type: "integer", minimum: 1, maximum: 9, enum: [4],
  });
  assert.deepEqual(toGeminiSchema({ oneOf: [{ type: "string" }, { type: "null" }] }), {
    anyOf: [{ type: "string" }, { type: "null" }],
  });
  assert.deepEqual(toGeminiSchema({ anyOf: [{ anyOf: [{ type: "string" }, { type: "number" }] }, { type: "null" }] }), {
    anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
  });
});

test("Gemini reasoning uses thinkingLevel for 3.x and thinkingBudget for 2.5 Flash", () => {
  assert.deepEqual(getGeminiThinkingConfig("gemini-3.5-flash-lite", { reasoningEnabled: false }), { thinkingLevel: "minimal" });
  assert.deepEqual(getGeminiThinkingConfig("gemini-3-flash", { reasoningMode: "fast" }), { thinkingLevel: "low" });
  assert.deepEqual(getGeminiThinkingConfig("gemini-3-flash", { reasoningMode: "standard" }), { thinkingLevel: "medium" });
  assert.deepEqual(getGeminiThinkingConfig("gemini-2.5-flash-lite", { reasoningEnabled: false }), { thinkingBudget: 0 });
  assert.deepEqual(getGeminiThinkingConfig("gemini-2.5-flash", { reasoningMode: "fast" }), { thinkingBudget: 1024 });
  assert.deepEqual(getGeminiThinkingConfig("gemini-2.5-flash", { reasoningMode: "standard" }), { thinkingBudget: 8192 });
});

test("Gemini history drops empty parts and merges adjacent roles", () => {
  assert.deepEqual(canonicalizeGeminiContents([
    { role: "user", parts: [{ text: "first" }, {}, { text: "  " }] },
    { role: "user", parts: [{ text: "second" }] },
    { role: "model", parts: [{ text: "reply" }] },
  ]), [
    { role: "user", parts: [{ text: "first" }, { text: "second" }] },
    { role: "model", parts: [{ text: "reply" }] },
  ]);
  assert.throws(() => canonicalizeGeminiContents([{ role: "user", parts: [{ text: 42 }] }]), /must be a string/);
  assert.throws(() => canonicalizeGeminiContents([{ role: "user", parts: [] }]), /at least one/);
});
