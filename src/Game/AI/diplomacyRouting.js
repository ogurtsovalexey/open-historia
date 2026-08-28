const normalizeText = (value) => String(value ?? "").trim();
const key = (value) => normalizeText(value).toLocaleLowerCase().normalize("NFKD");

const HIGH_PATTERNS = [
  /\b(annex|partition|divide|cede|cession|transfer|territor|province|region|border|occupation|occupy|invad|invasion|war|attack|front|military operation|troop|army)\w*/i,
  /(аннекс|раздел|подел|уступ|передач|территор|провинц|регион|област|границ|оккуп|вторж|войн|атак|фронт|военн|арм(?:ия|ии|ию|ией)|войск)/i,
];

const MEDIUM_PATTERNS = [
  /\b(trade|tariff|sanction|nato|alliance|treaty|agreement|security|guarantee|aid|recognition|diploma|embassy|negotiat|summit|energy|pipeline)\w*/i,
  /(торг|тариф|санкц|нато|альянс|союз|договор|соглаш|безопасн|гарант|помощ|признан|дипломат|посоль|переговор|саммит|энерг|трубопровод)/i,
];

export const normalizeDiplomaticCountries = (countries) => {
  const seen = new Set();
  const normalized = [];
  for (const country of Array.isArray(countries) ? countries : []) {
    const name = normalizeText(typeof country === "string" ? country : country?.name);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    normalized.push({
      code: normalizeText(typeof country === "object" ? country?.code : ""),
      name,
    });
  }
  return normalized;
};

export const findMentionedCountries = (text, countries, excludedNames = []) => {
  const haystack = key(text);
  const excluded = new Set(excludedNames.map(key));
  return normalizeDiplomaticCountries(countries)
    .filter((country) => !excluded.has(key(country.name)))
    .filter((country) => {
      const needle = key(country.name);
      return needle.length >= 3 && haystack.includes(needle);
    })
    .map((country) => country.name);
};

export const classifyDiplomaticTurn = ({ message, recentText = "", countries = [] } = {}) => {
  const current = normalizeText(message);
  const context = `${current}\n${normalizeText(recentText).slice(-1600)}`;
  const mentionedEntities = findMentionedCountries(current, countries);

  if (HIGH_PATTERNS.some((pattern) => pattern.test(context))) {
    return {
      complexity: "high",
      maxTokens: 12000,
      mentionedEntities,
      needsPlanner: mentionedEntities.length === 0,
      reasoningMode: "deep",
    };
  }
  if (MEDIUM_PATTERNS.some((pattern) => pattern.test(context))) {
    return {
      complexity: "medium",
      maxTokens: 4096,
      mentionedEntities,
      needsPlanner: false,
      reasoningMode: "balanced",
    };
  }
  return {
    complexity: "low",
    maxTokens: 1024,
    mentionedEntities,
    needsPlanner: false,
    reasoningMode: "fast",
  };
};

export const mergeDiplomaticPlan = (route, plan, countryCatalog = []) => {
  const known = new Map(normalizeDiplomaticCountries(countryCatalog).map((country) => [key(country.name), country.name]));
  const plannedEntities = (Array.isArray(plan?.entities) ? plan.entities : [])
    .map((name) => known.get(key(name)))
    .filter(Boolean);
  const requestedComplexity = ["low", "medium", "high"].includes(plan?.complexity)
    ? plan.complexity
    : route.complexity;
  const rank = { low: 0, medium: 1, high: 2 };
  const complexity = rank[requestedComplexity] > rank[route.complexity]
    ? requestedComplexity
    : route.complexity;

  return {
    ...route,
    complexity,
    maxTokens: complexity === "high" ? 12000 : complexity === "medium" ? 4096 : 1024,
    mentionedEntities: [...new Set([...route.mentionedEntities, ...plannedEntities])],
    needsPlanner: false,
    reasoningMode: complexity === "high" ? "deep" : complexity === "medium" ? "balanced" : "fast",
  };
};

export const buildFocusedDiplomaticMapContext = ({
  game = {},
  world = {},
  regions = [],
  participants = [],
  speakingAs = "",
  route = {},
} = {}) => {
  const normalizedParticipants = normalizeDiplomaticCountries(participants);
  const countryNamesByCode = new Map();
  for (const region of regions) {
    const code = normalizeText(region?.countryCode);
    const country = normalizeText(region?.country);
    if (code && country) countryNamesByCode.set(key(code), country);
  }
  for (const country of normalizedParticipants) {
    if (country.code) countryNamesByCode.set(key(country.code), country.name);
  }

  const canonicalOwner = (owner) => countryNamesByCode.get(key(owner)) || normalizeText(owner);
  const overrides = world?.regionOwnershipOverrides && typeof world.regionOwnershipOverrides === "object"
    ? world.regionOwnershipOverrides
    : {};
  const owned = new Map();
  for (const region of Array.isArray(regions) ? regions : []) {
    const id = normalizeText(region?.id);
    const owner = canonicalOwner(overrides[id] || region?.country || region?.countryCode);
    if (!owner) continue;
    const entries = owned.get(key(owner)) || { name: owner, regions: [] };
    entries.regions.push({ id, name: normalizeText(region?.name) || id });
    owned.set(key(owner), entries);
  }

  const player = normalizeText(game?.country) || "Unknown polity";
  const coreNames = [...new Set([player, speakingAs, ...normalizedParticipants.map((country) => country.name)].filter(Boolean))];
  const detailedNames = route?.complexity === "high"
    ? [...new Set((route.mentionedEntities?.length ? route.mentionedEntities : coreNames).filter(Boolean))]
    : [];
  const lines = [
    `Player polity: ${player}`,
    `Responding polity: ${normalizeText(speakingAs) || "Unknown polity"}`,
    `Current date: ${normalizeText(game?.gameDate) || "unknown"}`,
    `Difficulty: ${normalizeText(game?.difficulty) || "standard"}`,
    "Territorial snapshot:",
  ];

  for (const name of coreNames) {
    const entry = owned.get(key(name));
    lines.push(`- ${name}: ${entry?.regions.length ?? 0} mapped regions`);
  }

  if (detailedNames.length > 0) {
    lines.push("", "Detailed regions needed for this territorial negotiation:");
    for (const name of detailedNames) {
      const entry = owned.get(key(name));
      if (!entry || entry.regions.length === 0) {
        lines.push(`- ${name}: no exact region list found; do not invent precise map ids.`);
        continue;
      }
      const shown = entry.regions.slice(0, 120);
      lines.push(`- ${name} [${entry.regions.length}]: ${shown.map((region) => `${region.name} (${region.id})`).join(", ")}${entry.regions.length > shown.length ? `, (+${entry.regions.length - shown.length} more)` : ""}`);
    }
  } else {
    lines.push("Exact province lists are intentionally omitted because this turn is not a territorial negotiation.");
  }

  return lines.join("\n");
};
