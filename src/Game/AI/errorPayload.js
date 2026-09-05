export async function readErrorPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

export function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
  if (payload.error?.message) return payload.error.message;
  if (payload.message) return payload.message;
  if (typeof payload.rawText === "string" && payload.rawText.trim()) return payload.rawText.trim();
  return fallback;
}
