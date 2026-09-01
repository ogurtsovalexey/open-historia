const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

export function normalizeGeminiModel(model) {
    return String(model ?? "").replace(/^models\//, "").trim();
}

export function getGeminiUrl(model, { stream = false } = {}) {
    const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${GEMINI_API_ROOT}/${encodeURIComponent(normalizeGeminiModel(model))}:${method}`;
}

export function getGeminiHeaders(apiKey) {
    return {
        "Content-Type": "application/json",
        "x-goog-api-key": String(apiKey ?? "").trim(),
    };
}

const normalizeReasoningMode = (reasoningMode, reasoningEnabled) => {
    if (!reasoningEnabled || reasoningMode === "off" || reasoningMode === "minimal") return "minimal";
    if (reasoningMode === "fast" || reasoningMode === "low") return "low";
    return "medium";
};

export function getGeminiThinkingConfig(model, { reasoningEnabled = true, reasoningMode } = {}) {
    const normalizedModel = normalizeGeminiModel(model);
    const level = normalizeReasoningMode(reasoningMode, reasoningEnabled);

    if (/^gemini-3(?:[.-]|$)/i.test(normalizedModel)) {
        return { thinkingLevel: level };
    }

    if (/^gemini-2\.5-flash(?:-lite)?(?:[.-]|$)/i.test(normalizedModel)) {
        return { thinkingBudget: level === "minimal" ? 0 : level === "low" ? 1024 : 8192 };
    }

    return { thinkingBudget: level === "minimal" ? 0 : level === "low" ? 1024 : 8192 };
}

export function canonicalizeGeminiContents(history) {
    if (!Array.isArray(history)) throw new TypeError("Gemini history must be an array.");

    const contents = [];
    for (const entry of history) {
        if (!entry || (entry.role !== "user" && entry.role !== "model")) {
            throw new TypeError("Gemini history entries must use the user or model role.");
        }
        const parts = [];
        for (const part of Array.isArray(entry.parts) ? entry.parts : []) {
            if (!part || !Object.hasOwn(part, "text")) continue;
            if (typeof part.text !== "string") throw new TypeError("Gemini history part text must be a string.");
            if (!part.text.trim()) continue;
            parts.push({ text: part.text });
        }
        if (parts.length === 0) continue;
        const previous = contents.at(-1);
        if (previous?.role === entry.role) previous.parts.push(...parts);
        else contents.push({ role: entry.role, parts });
    }

    if (contents.length === 0) throw new TypeError("Gemini contents must contain at least one non-empty text part.");
    return contents;
}

export function toGeminiSchema(value) {
    if (Array.isArray(value)) return value.map(toGeminiSchema);
    if (!value || typeof value !== "object") return value;
    const unsupported = new Set(["additionalProperties", "$schema", "$id", "$defs", "definitions", "$ref", "const", "exclusiveMinimum", "exclusiveMaximum"]);
    const schema = Object.fromEntries(Object.entries(value)
        .filter(([key]) => !unsupported.has(key) && key !== "oneOf")
        .map(([key, entry]) => [key, toGeminiSchema(entry)]));
    if (Object.hasOwn(value, "const")) schema.enum = [value.const];
    if (!schema.anyOf && Array.isArray(value.oneOf)) schema.anyOf = value.oneOf.map(toGeminiSchema);
    if (Array.isArray(schema.anyOf)) {
        schema.anyOf = schema.anyOf.flatMap((candidate) =>
            candidate && typeof candidate === "object" && !Array.isArray(candidate)
            && Object.keys(candidate).length === 1 && Array.isArray(candidate.anyOf)
                ? candidate.anyOf
                : [candidate]);
    }
    if (Number.isFinite(value.exclusiveMinimum)) {
        schema.minimum = value.type === "integer" ? value.exclusiveMinimum + 1 : value.exclusiveMinimum;
    }
    if (Number.isFinite(value.exclusiveMaximum)) {
        schema.maximum = value.type === "integer" ? value.exclusiveMaximum - 1 : value.exclusiveMaximum;
    }
    return schema;
}

export function fitGeminiFunctionSchema(value, maxCharacters = 30_000) {
    const schema = toGeminiSchema(value);
    if (JSON.stringify(schema).length <= maxCharacters) return schema;
    const compact = (entry) => {
        if (Array.isArray(entry)) return entry.map(compact);
        if (!entry || typeof entry !== "object") return entry;
        return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, key === "command"
            ? { description: "A typed engine command using only prompt-supplied IDs; null for hold.", anyOf: [{ type: "object" }, { type: "null" }] }
            : compact(child)]));
    };
    const fitted = compact(schema);
    if (JSON.stringify(fitted).length > maxCharacters) {
        throw new TypeError(`Gemini function schema remains over ${maxCharacters} characters after bounded command compaction.`);
    }
    return fitted;
}
