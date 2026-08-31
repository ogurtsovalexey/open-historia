const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const CAMPAIGN_MEMORY_VERSION = 2;
export const CAMPAIGN_MEMORY_MAX_FACTS = 12;
export const CAMPAIGN_MEMORY_MAX_CHARACTERS = 6000;

export const CAMPAIGN_MEMORY_DOMAINS = Object.freeze([
  "economy",
  "diplomacy",
  "dynasty",
  "politics",
  "war",
  "other",
]);

export const CAMPAIGN_MEMORY_SALIENCE = Object.freeze([
  "minor",
  "material",
  "major",
  "critical",
]);

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
const DOMAIN_SET = new Set(CAMPAIGN_MEMORY_DOMAINS);
const SALIENCE_SET = new Set(CAMPAIGN_MEMORY_SALIENCE);
const RESOLUTION_STATUS_SET = new Set(["broken", "resolved", "superseded"]);
const SALIENCE_SCORE = Object.freeze({ minor: 0, material: 10, major: 20, critical: 30 });

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

const normalizeTokens = (value, allowed, fallback = []) => {
  const tokens = normalizeUniqueStrings(value)
    .map(normalizeToken)
    .filter((entry) => allowed.has(entry));
  return tokens.length > 0 ? tokens : [...fallback];
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
    entityRefs: normalizeUniqueStrings(value.entityRefs),
    domains: normalizeTokens(value.domains, DOMAIN_SET, ["other"]),
    salience: SALIENCE_SET.has(normalizeToken(value.salience)) ? normalizeToken(value.salience) : "minor",
    causedBy: normalizeUniqueStrings(value.causedBy),
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
      entityRefs: normalizeUniqueStrings([...prior.entityRefs, ...fact.entityRefs]),
      domains: normalizeTokens([...prior.domains, ...fact.domains], DOMAIN_SET, ["other"]),
      causedBy: normalizeUniqueStrings([...prior.causedBy, ...fact.causedBy]),
      createdRound: prior.createdRound || fact.createdRound,
    } : fact);
  }
  const inputVersion = Number(value?.version);
  const version = Array.isArray(value) || inputVersion === 1 ? 1 : CAMPAIGN_MEMORY_VERSION;
  return { version, facts: [...byId.values()] };
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
    entityRefs: normalizeUniqueStrings(value.entityRefs),
    domains: normalizeTokens(value.domains, DOMAIN_SET),
    salience: normalizeToken(value.salience),
    causedBy: normalizeUniqueStrings(value.causedBy),
  };
};

export const applyCampaignMemoryOps = (
  memory,
  operations,
  { allowedEntityIds = [], allowedEvidenceIds = [], currentDate = "", currentRound = 0 } = {},
) => {
  const normalized = normalizeCampaignMemory(memory);
  const byId = new Map(normalized.facts.map((fact) => [fact.id, fact]));
  const allowed = new Set(normalizeUniqueStrings(allowedEvidenceIds));
  const allowedEntities = new Set(normalizeUniqueStrings(allowedEntityIds));
  const round = normalizeRound(currentRound);

  for (const rawOperation of normalizeArray(operations)) {
    const operation = normalizeOperation(rawOperation);
    if (!operation) continue;
    const evidenceIds = operation.evidenceIds.filter((id) => allowed.has(id));
    if (operation.entityRefs.some((id) => !allowedEntities.has(id))) continue;
    const allowedCauses = new Set([...allowed, ...byId.keys()]);
    if (operation.causedBy.some((id) => !allowedCauses.has(id))) continue;

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
    if (!candidate || operation.domains.length === 0 || !SALIENCE_SET.has(operation.salience)) continue;
    const prior = byId.get(candidate.id);
    // Every new durable fact must point to material in this exact consolidation
    // batch. Existing facts may be refreshed, but a model cannot invent a new fact
    // by citing an id that was never sent to it.
    if (evidenceIds.length === 0) continue;
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

const renderCampaignMemoryFact = (fact) => {
  const parties = fact.parties.length ? ` | parties: ${fact.parties.join(", ")}` : "";
  const entities = fact.entityRefs.length ? ` | entities: ${fact.entityRefs.join(", ")}` : "";
  const causes = fact.causedBy.length ? ` | caused by: ${fact.causedBy.join(", ")}` : "";
  const dates = [fact.sinceDate ? `since ${fact.sinceDate}` : "", fact.endedDate ? `ended ${fact.endedDate}` : ""]
    .filter(Boolean)
    .join(", ");
  return `- [${fact.id}] [${fact.category}; ${fact.status}; ${fact.domains.join(",")}; ${fact.salience}${dates ? `; ${dates}` : ""}]${parties}${entities}${causes} | ${fact.statement}`;
};

const memoryScore = (fact, context) => {
  const targets = new Set(normalizeUniqueStrings(context.targetEntityIds));
  const domains = new Set(normalizeTokens(context.domains, DOMAIN_SET));
  const actor = normalizeString(context.actorEntityId);
  const currentRound = normalizeRound(context.currentRound);
  const age = Math.max(0, currentRound - fact.updatedRound);
  return (fact.entityRefs.some((id) => targets.has(id)) ? 80 : 0)
    + (actor && fact.entityRefs.includes(actor) ? 50 : 0)
    + (fact.domains.some((domain) => domains.has(domain)) ? 30 : 0)
    + (fact.status === "active" ? 20 : 0)
    + SALIENCE_SCORE[fact.salience]
    + Math.max(0, 20 - age);
};

export const selectCampaignMemoryFacts = (value, context = {}) => {
  const facts = normalizeCampaignMemory(value).facts;
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const requiredIds = normalizeUniqueStrings(context.requiredFactIds);
  const required = requiredIds.map((id) => {
    const found = byId.get(id);
    if (!found) throw new Error(`Unknown required campaign memory fact id: ${id}`);
    return found;
  });
  const maxFacts = Math.max(0, Math.min(CAMPAIGN_MEMORY_MAX_FACTS, normalizeRound(context.maxFacts ?? CAMPAIGN_MEMORY_MAX_FACTS)));
  const maxCharacters = Math.max(0, Math.min(CAMPAIGN_MEMORY_MAX_CHARACTERS, normalizeRound(context.maxCharacters ?? CAMPAIGN_MEMORY_MAX_CHARACTERS)));
  const requiredSet = new Set(requiredIds);
  const requestedDomains = new Set(normalizeTokens(context.domains, DOMAIN_SET));
  const currentRound = normalizeRound(context.currentRound);
  const candidates = facts
    .filter((fact) => !requiredSet.has(fact.id))
    .filter((fact) => requestedDomains.size === 0 || fact.domains.some((domain) => requestedDomains.has(domain)))
    .filter((fact) => fact.status === "active" || Math.max(0, currentRound - fact.updatedRound) <= 20)
    .map((fact) => ({ fact, score: memoryScore(fact, context) }))
    .sort((left, right) => right.score - left.score
      || right.fact.updatedRound - left.fact.updatedRound
      || (left.fact.id < right.fact.id ? -1 : left.fact.id > right.fact.id ? 1 : 0));
  const ordered = [...required, ...candidates.map((entry) => entry.fact)];
  const selected = [];
  let characters = 0;

  for (const fact of ordered) {
    if (selected.length >= maxFacts) {
      if (requiredSet.has(fact.id)) throw new Error("Required campaign memory facts exceed the fact limit.");
      break;
    }
    const lineLength = renderCampaignMemoryFact(fact).length + (selected.length > 0 ? 1 : 0);
    if (characters + lineLength > maxCharacters) {
      if (requiredSet.has(fact.id)) throw new Error("Required campaign memory facts exceed the character limit.");
      continue;
    }
    selected.push(fact);
    characters += lineLength;
  }
  return selected;
};

export const buildCampaignMemoryText = (value, { context = null, includeResolved = true } = {}) => {
  const facts = (context ? selectCampaignMemoryFacts(value, context) : normalizeCampaignMemory(value).facts)
    .filter((fact) => includeResolved || fact.status === "active");
  if (facts.length === 0) {
    return "No durable campaign facts have been recorded yet.";
  }
  return facts.map(renderCampaignMemoryFact).join("\n");
};
