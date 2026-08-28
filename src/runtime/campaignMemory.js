const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const CAMPAIGN_MEMORY_VERSION = 1;

export const CAMPAIGN_MEMORY_CATEGORIES = Object.freeze([
  "alliance",
  "ceasefire",
  "crisis",
  "debt",
  "divergence",
  "grievance",
  "leader",
  "occupation",
  "policy",
  "promise",
  "regime",
  "relationship",
  "territorial",
  "trade",
  "treaty",
  "war",
  "other",
]);

export const CAMPAIGN_MEMORY_STATUSES = Object.freeze([
  "active",
  "broken",
  "resolved",
  "superseded",
]);

const CATEGORY_SET = new Set(CAMPAIGN_MEMORY_CATEGORIES);
const STATUS_SET = new Set(CAMPAIGN_MEMORY_STATUSES);
const RESOLUTION_STATUS_SET = new Set(["broken", "resolved", "superseded"]);

const normalizeToken = (value) => normalizeString(value).toLowerCase().replace(/[\s_]+/g, "-");

const normalizeUniqueStrings = (value) => {
  const seen = new Set();
  const result = [];
  for (const entry of normalizeArray(value)) {
    const text = normalizeString(entry);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
};

const normalizeRound = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
};

// A model occasionally omits an id on a new fact. Derive one from the durable
// content instead of generating a timestamp: retrying the same consolidation then
// converges on the same record rather than duplicating it.
const stableHash = (value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const deriveCampaignMemoryId = (value) => {
  const category = CATEGORY_SET.has(normalizeToken(value?.category))
    ? normalizeToken(value.category)
    : "other";
  const parties = normalizeUniqueStrings(value?.parties).map((entry) => entry.toLocaleLowerCase()).sort();
  const statement = normalizeString(value?.statement).toLocaleLowerCase();
  return `memory-${category}-${stableHash(`${parties.join("|")}::${statement}`)}`;
};

export const normalizeCampaignMemoryFact = (value) => {
  if (!value || typeof value !== "object") return null;
  const statement = normalizeString(value.statement ?? value.text ?? value.summary ?? value.description);
  if (!statement) return null;
  const categoryToken = normalizeToken(value.category);
  const statusToken = normalizeToken(value.status);
  const fact = {
    id: normalizeString(value.id),
    category: CATEGORY_SET.has(categoryToken) ? categoryToken : "other",
    statement,
    parties: normalizeUniqueStrings(value.parties),
    status: STATUS_SET.has(statusToken) ? statusToken : "active",
    sinceDate: normalizeString(value.sinceDate ?? value.since),
    endedDate: normalizeString(value.endedDate ?? value.until),
    evidenceIds: normalizeUniqueStrings(value.evidenceIds ?? value.sources),
    createdRound: normalizeRound(value.createdRound),
    updatedRound: normalizeRound(value.updatedRound),
  };
  if (!fact.id) fact.id = deriveCampaignMemoryId(fact);
  return fact;
};

export const normalizeCampaignMemory = (value) => {
  const rawFacts = Array.isArray(value) ? value : value?.facts;
  const byId = new Map();
  for (const rawFact of normalizeArray(rawFacts)) {
    const fact = normalizeCampaignMemoryFact(rawFact);
    if (!fact) continue;
    const prior = byId.get(fact.id);
    byId.set(fact.id, prior ? {
      ...prior,
      ...fact,
      evidenceIds: normalizeUniqueStrings([...prior.evidenceIds, ...fact.evidenceIds]),
      parties: normalizeUniqueStrings([...prior.parties, ...fact.parties]),
      createdRound: prior.createdRound || fact.createdRound,
    } : fact);
  }
  return { version: CAMPAIGN_MEMORY_VERSION, facts: [...byId.values()] };
};

const normalizeOperation = (value) => {
  if (!value || typeof value !== "object") return null;
  const op = normalizeToken(value.op);
  if (!new Set(["upsert", "resolve"]).has(op)) return null;
  return {
    op,
    id: normalizeString(value.id),
    category: normalizeString(value.category),
    statement: normalizeString(value.statement),
    parties: normalizeUniqueStrings(value.parties),
    status: normalizeString(value.status),
    sinceDate: normalizeString(value.sinceDate),
    endedDate: normalizeString(value.endedDate),
    evidenceIds: normalizeUniqueStrings(value.evidenceIds),
  };
};

export const applyCampaignMemoryOps = (
  memory,
  operations,
  { allowedEvidenceIds = [], currentDate = "", currentRound = 0 } = {},
) => {
  const normalized = normalizeCampaignMemory(memory);
  const byId = new Map(normalized.facts.map((fact) => [fact.id, fact]));
  const allowed = new Set(normalizeUniqueStrings(allowedEvidenceIds));
  const round = normalizeRound(currentRound);

  for (const rawOperation of normalizeArray(operations)) {
    const operation = normalizeOperation(rawOperation);
    if (!operation) continue;
    const evidenceIds = operation.evidenceIds.filter((id) => allowed.has(id));

    if (operation.op === "resolve") {
      const prior = byId.get(operation.id);
      const status = normalizeToken(operation.status);
      if (!prior || !RESOLUTION_STATUS_SET.has(status) || evidenceIds.length === 0) continue;
      byId.set(prior.id, {
        ...prior,
        statement: operation.statement || prior.statement,
        status,
        endedDate: operation.endedDate || normalizeString(currentDate) || prior.endedDate,
        evidenceIds: normalizeUniqueStrings([...prior.evidenceIds, ...evidenceIds]),
        updatedRound: round || prior.updatedRound,
      });
      continue;
    }

    const candidate = normalizeCampaignMemoryFact({
      ...operation,
      id: operation.id,
      createdRound: round,
      updatedRound: round,
      evidenceIds,
    });
    if (!candidate) continue;
    const prior = byId.get(candidate.id);
    // Every new durable fact must point to material in this exact consolidation
    // batch. Existing facts may be refreshed, but a model cannot invent a new fact
    // by citing an id that was never sent to it.
    if (!prior && evidenceIds.length === 0) continue;
    byId.set(candidate.id, prior ? {
      ...prior,
      ...candidate,
      sinceDate: prior.sinceDate || candidate.sinceDate,
      createdRound: prior.createdRound || candidate.createdRound,
      parties: normalizeUniqueStrings([...prior.parties, ...candidate.parties]),
      evidenceIds: normalizeUniqueStrings([...prior.evidenceIds, ...candidate.evidenceIds]),
    } : candidate);
  }

  return { version: CAMPAIGN_MEMORY_VERSION, facts: [...byId.values()] };
};

export const buildCampaignMemoryText = (value, { includeResolved = true } = {}) => {
  const facts = normalizeCampaignMemory(value).facts
    .filter((fact) => includeResolved || fact.status === "active");
  if (facts.length === 0) {
    return "No durable campaign facts have been recorded yet.";
  }
  return facts.map((fact) => {
    const parties = fact.parties.length ? ` | parties: ${fact.parties.join(", ")}` : "";
    const dates = [fact.sinceDate ? `since ${fact.sinceDate}` : "", fact.endedDate ? `ended ${fact.endedDate}` : ""]
      .filter(Boolean)
      .join(", ");
    return `- [${fact.id}] [${fact.category}; ${fact.status}${dates ? `; ${dates}` : ""}]${parties} | ${fact.statement}`;
  }).join("\n");
};

