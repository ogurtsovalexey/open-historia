// Focused legacy-shaped scenario preset fixture exercising the Scenario V2
// adapter. Mirrors the real `scripts/presets/*.spec.mjs` shape (country codes,
// GID assignments, prose simulation rules) without being historical data.
export default {
  id: "legacy-rome",

  meta: {
    name: "Legacy Rome — 117 AD",
    description: "Minimal legacy-shaped preset for adapter tests.",
  },

  game: { country: "ROM", startDate: "0117-01-01", gameDate: "0117-01-01" },

  allowedUnitTypes: ["infantry", "armor", "naval", "garrison"],

  polities: {
    ROM: { name: "Roman Empire", color: "#a31c1c", aliases: ["Rome", "SPQR"] },
    PART: { name: "Parthian Empire", color: "#8a6d3b", aliases: ["Parthia"] },
  },

  countryAssignments: {
    ROM: ["ITA", "ESP"],
    PART: ["IRN"],
  },

  regionAssignments: {
    "ITA.1_1": "ROM",
  },

  cities: [["Roma", "Rome", 4, 1000000]],

  simulationRules:
    "Classical warfare without gunpowder or air power; the Mediterranean is contested " +
    "between Rome and Parthia.",

  startingTimelineText: "August, 117 AD. Trajan is dead; Hadrian is acclaimed.",
};