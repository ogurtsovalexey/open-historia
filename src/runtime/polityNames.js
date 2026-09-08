/*! Open Historia — country display-name resolver © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Codes ("RUS", "KHAL") are load-bearing identifiers everywhere in the data,
// but the PLAYER should only ever see full names. This resolves a code to the
// era polity name (world.polityOverrides) or the base country name, with the
// code itself as a last resort, and caches the lookup for cheap sync access.
import { useEffect, useState } from "react";
import { JSON_URLS, loadCountryNames, readJson } from "./assets.js";
import { getStoredLanguage } from "./i18n.js";

let nameByCode = new Map();
let refreshedAt = 0;
let inflight = null;

const refresh = async () => {
  const [countries, world] = await Promise.all([
    loadCountryNames().catch(() => []),
    readJson(JSON_URLS.world, { defaultValue: {}, force: true }).catch(() => ({})),
  ]);
  const next = new Map();
  for (const country of countries ?? []) {
    if (country?.code) next.set(String(country.code), country.name || country.code);
  }
  // Era polities win over modern names for the same code — but only when
  // they actually carry a name; a nameless override must not degrade one.
  const russian = String(getStoredLanguage()).toLowerCase().startsWith("ru");
  for (const [id, polity] of Object.entries(world?.polityOverrides ?? {})) {
    const name = russian ? (polity?.nameRu || polity?.name) : polity?.name;
    if (!name) continue;
    // Living World uses polity:* as its stable canonical id.  It is valid
    // simulation data but must resolve through exactly the same display seam
    // as older code-keyed polities.
    if (id) next.set(String(id), name);
    if (polity?.code) next.set(String(polity.code), name);
  }
  nameByCode = next;
  refreshedAt = Date.now();
};

export const ensurePolityNames = async () => {
  if (Date.now() - refreshedAt > 15000) {
    inflight = inflight ?? refresh().finally(() => {
      inflight = null;
    });
    await inflight;
  }
};

// Sync lookup — falls back to the code until ensurePolityNames has run.
export const polityDisplayName = (code) => {
  const key = String(code ?? "").trim();
  if (!key) return "";
  return nameByCode.get(key) || key;
};

// Hook variant for single values: renders the code briefly, then the name.
export const useCountryDisplayName = (code) => {
  const [name, setName] = useState(() => polityDisplayName(code));

  useEffect(() => {
    let cancelled = false;
    setName(polityDisplayName(code));
    ensurePolityNames().then(() => {
      if (!cancelled) setName(polityDisplayName(code));
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    const refreshForLanguage = () => {
      refreshedAt = 0;
      ensurePolityNames().then(() => setName(polityDisplayName(code))).catch(() => {});
    };
    window.addEventListener("i18n:updated", refreshForLanguage);
    return () => window.removeEventListener("i18n:updated", refreshForLanguage);
  }, [code]);

  return name;
};
