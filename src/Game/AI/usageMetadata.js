export function normalizeGeminiUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== "object") return undefined;
  const count = (key) => Number.isFinite(usageMetadata[key]) && usageMetadata[key] >= 0
    ? usageMetadata[key] : null;
  return {
    inputTokens: count("promptTokenCount"),
    outputTokens: count("candidatesTokenCount"),
    reasoningTokens: count("thoughtsTokenCount"),
    cachedInputTokens: count("cachedContentTokenCount"),
    totalTokens: count("totalTokenCount"),
    source: "provider",
  };
}
