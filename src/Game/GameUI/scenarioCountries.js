const TECHNICAL_OWNER_CODES = new Set([
  "NA", "XCA", "Z01", "Z02", "Z03", "Z04", "Z05", "Z06", "Z07", "Z08", "Z09",
]);

export const buildScenarioCountryOptions = (world, allCountries, nameOverrides = {}) => {
  const entries = Array.isArray(allCountries) ? allCountries : [];
  const entriesByCode = new Map();
  for (const entry of entries) {
    const code = String(entry?.code ?? "").trim();
    const name = String(entry?.name ?? "").trim();
    if (!code || !name || TECHNICAL_OWNER_CODES.has(code)) continue;
    const existing = entriesByCode.get(code);
    if (!existing || existing.name === code) entriesByCode.set(code, { code, name });
  }
  const list = [...entriesByCode.values()];
  const ownerCodes = Array.isArray(world?.ownerCodes) ? world.ownerCodes : null;
  const explicitPlayable = Array.isArray(world?.playableOwnerCodes) ? world.playableOwnerCodes : null;
  const nameByCode = new Map(list.map((entry) => [entry.code, entry.name]));
  const polity = world?.polityOverrides ?? {};
  const resolveOption = (code, fallbackName = code) => {
    const scenarioName = nameOverrides[code] || nameOverrides[fallbackName];
    const polityName = polity[code]?.name;
    return {
      code,
      name: (polityName && polityName !== code ? polityName : null) || scenarioName || fallbackName,
    };
  };
  const codes = new Set(explicitPlayable ?? (ownerCodes && ownerCodes.length ? ownerCodes : list.map((entry) => entry.code)));
  if (!explicitPlayable) for (const code of Object.keys(polity)) codes.add(code);
  return [...codes]
    .filter((code) => !TECHNICAL_OWNER_CODES.has(code))
    .map((code) => resolveOption(code, nameByCode.get(code) || code))
    .sort((left, right) => left.name.localeCompare(right.name));
};
