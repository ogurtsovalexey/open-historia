export const SCENARIO_ID = 'scenario:world-1916';
export const POLITY_RU = 'polity:russian-empire';
export const POLITY_DE = 'polity:german-empire';
export const REGION_1 = 'region:gadm-4-1:RUS.33_1';
export const REGION_2 = 'region:gadm-4-1:DEU.1_1';
export const SOURCE_YEARBOOK = 'source:world-1916:russia-yearbook-1916';
export const SOURCE_OTHER = 'source:world-1916:other-source';
export const FACT_REVENUE = 'fact:world-1916:russia-revenue-001';
export const ASSUMPTION_TERRITORY = 'assumption:world-1916:russian-territorial-basis';
export const MACRO_EAST = 'macro-region:world-1916:eastern-front-test';

export function makeSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SOURCE_YEARBOOK,
    title: 'Russia yearbook 1916',
    locator: 'docs/spec/fixture-locator',
    license: { status: 'metadata-only' },
    ...overrides,
  };
}

export function makeFact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FACT_REVENUE,
    role: 'starting-value',
    subjectRefs: [POLITY_RU],
    predicate: 'fixture.monthly-revenue',
    effectiveRange: { from: '1916-01-01', until: '1916-01-31' },
    value: { kind: 'quantity', amount: '1000000', unit: 'RUB-1913', scope: 'fixture estimate' },
    sourceRefs: [SOURCE_YEARBOOK],
    assumptionRefs: [],
    confidence: 'low',
    transformation: [
      {
        operation: 'aggregation',
        description: 'fixture aggregation',
        inputSourceRefs: [SOURCE_YEARBOOK],
      },
    ],
    ...overrides,
  };
}

export function makeBundle(overrides: { manifest?: Record<string, unknown>; scenario?: Record<string, unknown>; sources?: unknown } = {}): Record<string, unknown> {
  const manifest = {
    schemaVersion: 2,
    id: SCENARIO_ID,
    contentVersion: '0.1.0',
    engineRange: '>=0.1.0 <1.0.0',
    defaultLocale: 'en',
    scenarioPath: 'scenario.json',
    sourcesPath: 'sources.json',
    assets: [],
    ...(overrides.manifest ?? {}),
  };

  const scenario = {
    schemaVersion: 2,
    id: SCENARIO_ID,
    meta: { title: 'World 1916 contract fixture' },
    game: { startDate: '1916-01-01', defaultPlayer: POLITY_RU },
    polities: {
      [POLITY_RU]: { id: POLITY_RU, name: 'Russian Empire', color: '#1a4f2b' },
      [POLITY_DE]: { id: POLITY_DE, name: 'German Empire', color: '#2b2b2b' },
    },
    regions: [
      { id: REGION_1, dataset: 'gadm', datasetVersion: '4.1', nativeId: 'RUS.33_1' },
      { id: REGION_2, dataset: 'gadm', datasetVersion: '4.1', nativeId: 'DEU.1_1' },
    ],
    regionAssignments: {
      [REGION_1]: POLITY_RU,
      [REGION_2]: POLITY_DE,
    },
    simulationRules: {
      era: 'world-war-i',
      aiHistoryMode: 'conditional',
      constraints: { noAirPower: false, narrativeRules: [] },
      technologyLevel: { era: 'industrial', notable: [] },
    },
    historicalFacts: [],
    assumptions: [],
    macroRegions: [],
    fidelity: {
      intendedUse: 'test-fixture',
      polityLevels: { [POLITY_RU]: 'Baseline', [POLITY_DE]: 'Baseline' },
      gaps: [],
    },
    ...(overrides.scenario ?? {}),
  };

  return {
    manifest,
    scenario,
    sources: overrides.sources ?? [],
  };
}