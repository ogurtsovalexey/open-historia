// Simple Scenario V2 schemas that actually compile
export interface ScenarioManifest {
  schemaVersion: 2;
  id: string; // scenario:world-1916
  contentVersion: string; // 0.1.0
  engineRange: string;
  defaultLocale: string;
  scenarioPath: 'scenario.json';
  sourcesPath: 'sources.json';
  assets: AssetRef[];
}

export interface AssetRef {
  id: string; // asset:world-1916:regions
  kind: 'regions' | 'cities' | 'background' | 'other';
  path?: string;
  contentAddress?: string; // sha256:...
  mediaType: string;
  required: boolean;
}

export interface ScenarioV2 {
  schemaVersion: 2;
  id: string; // scenario:world-1916
  meta: ScenarioMeta;
  game: GameStart;
  polities: Record<string, PolityDef>;
  regions: RegionRef[];
  regionAssignments?: Record<string, string>; // regionId -> polityId
  cities?: CityDef[];
  simulationRules: SimulationRules;
  historicalFacts: HistoricalFact[];
  assumptions: Assumption[];
  macroRegions: MacroRegionDef[];
  fidelity: FidelityManifest;
}

export interface ScenarioMeta {
  title: string;
  description?: string;
  locales?: Record<string, { title: string; description?: string }>;
}

export interface GameStart {
  startDate: string; // YYYY-MM-DD
  defaultPlayer: string; // polity:id
}

export interface PolityDef {
  id: string; // polity:russian-empire
  name: string;
  aliases?: string[];
  color: string; // #RRGGBB
}

export interface RegionRef {
  id: string; // region:gadm-4-1:RUS.33_1
  dataset: string;
  datasetVersion: string;
  nativeId: string;
}

export interface CityDef {
  id: string;
  name: string;
  regionId: string;
  population?: number;
  note?: string;
}

export interface SimulationRules {
  era: string;
  aiHistoryMode: 'conditional' | 'free' | 'guided';
  eraNarrative?: string;
  constraints: {
    noAirPower?: boolean;
    noGunpowder?: boolean;
    noNaval?: boolean;
    maxUnitTier?: number;
    narrativeRules?: string[];
  };
  factions?: FactionDef[];
  activeConflicts?: ConflictDef[];
  technologyLevel: {
    era: string;
    notable?: string[];
  };
}

export interface FactionDef {
  id: string;
  name: string;
  leader?: string;
  ideology?: string;
  strength?: string;
}

export interface ConflictDef {
  id: string;
  name: string;
  participants: string[]; // polity IDs
  startDate?: string;
  status?: 'active' | 'dormant' | 'resolved';
  type?: 'war' | 'civil-war' | 'rebellion' | 'colonial';
}

export interface HistoricalFact {
  id: string; // fact:world-1916:population-001
  role: 'observation' | 'starting-value';
  subjectRefs: string[]; // entity IDs
  predicate: string;
  effectiveRange: DateRange;
  value: FactValue;
  sourceRefs: string[]; // source IDs
  assumptionRefs: string[]; // assumption IDs
  confidence: 'high' | 'medium' | 'low' | 'assumption';
  transformation: TransformationStep[];
  note?: string;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  until?: string; // YYYY-MM-DD
}

export type FactValue =
  | { kind: 'quantity'; amount: string; unit: string; scope?: string }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'entity-ref'; value: string }
  | { kind: 'unknown'; expectedKind: 'quantity' | 'text' | 'boolean' | 'entity-ref'; reason: string };

export interface TransformationStep {
  operation: 'identity' | 'unit-conversion' | 'calendar-conversion' | 'currency-conversion' | 'territorial-allocation' | 'aggregation' | 'scenario-choice';
  description: string;
  inputSourceRefs: string[]; // source IDs
  formula?: string;
}

export interface SourceRef {
  id: string; // source:world-1916:russia-yearbook-1916
  title: string;
  publisher?: string;
  publicationDate?: string;
  locator: string;
  retrievedAt?: string;
  contentHash?: string; // sha256:...
  license: {
    status: 'redistributable' | 'metadata-only' | 'unknown';
    name?: string;
    url?: string;
  };
  note?: string;
}

export interface Assumption {
  id: string; // assumption:world-1916:territorial-basis
  statement: string;
  rationale: string;
  affectedPaths: string[]; // JSON pointers
  sourceRefs: string[]; // source IDs
  status: 'authored';
}

export interface MacroRegionDef {
  id: string; // macro-region:world-1916:eastern-front
  name: string;
  members: string[]; // region IDs
  purpose: 'aggregation' | 'fixture' | 'historical-area';
  geometryAssetRef?: string; // asset ID
}

export interface FidelityManifest {
  intendedUse: 'test-fixture' | 'development-scenario' | 'playable-scenario';
  polityLevels: Record<string, 'Baseline' | 'Supported' | 'Curated'>;
  gaps: FidelityGap[];
}

export interface FidelityGap {
  path: string; // JSON pointer
  disposition: 'unknown' | 'assumption' | 'not-applicable';
  reason: string;
  assumptionRef?: string; // assumption ID
}

export interface ScenarioBundle {
  manifest: ScenarioManifest;
  scenario: ScenarioV2;
  sources: SourceRef[];
}