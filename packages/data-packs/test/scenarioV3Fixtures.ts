import type { ScenarioV3Input } from '../src/v3/schemas.js';
import { scenarioV3ValueChecksumAtPointer } from '../src/v3/validator.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;

export function minimalScenarioV3(profile: 'historical' | 'fictional' | 'development' = 'development'): ScenarioV3Input {
  const basis = profile === 'historical'
    ? { kind: 'historical' as const, sourceIds: ['source:test:archive'], observationDate: '1900-01-01', method: 'direct transcription', confidence: 'high' as const }
    : profile === 'fictional'
      ? { kind: 'fictional' as const, premise: 'Authored test-world premise.' }
      : { kind: 'development' as const, synthetic: true as const };
  const scenario: ScenarioV3Input = {
    schemaVersion: 'open-historia-scenario/3',
    id: 'scenario:v3-minimal',
    profile,
    metadata: { title: { en: 'Minimal world' }, description: { en: 'A scenario-neutral fixture.' } },
    game: {
      startDate: '1900-01-01',
      defaultPlayerPolityId: 'polity:alpha',
      playerEligiblePolityIds: ['polity:alpha'],
    },
    worldRules: {
      physicalModel: 'world-model:physical-basic',
      knowledgeBaseline: ['concept:writing'],
      communicationModel: 'world-model:communication-basic',
      governmentModel: 'world-model:government-basic',
      militaryModel: 'world-model:military-basic',
      hardProhibitions: [],
      plausibilityContext: [],
    },
    modules: { enabled: ['module:population'] },
    catalogs: {
      modules: { 'module:population': { id: 'module:population', kind: 'population' } },
      worldModels: {
        'world-model:physical-basic': { id: 'world-model:physical-basic', kind: 'physical' },
        'world-model:communication-basic': { id: 'world-model:communication-basic', kind: 'communication' },
        'world-model:government-basic': { id: 'world-model:government-basic', kind: 'government' },
        'world-model:military-basic': { id: 'world-model:military-basic', kind: 'military' },
      },
      commodities: { 'commodity:food': { id: 'commodity:food', unitId: 'unit:quantity', usage: 'both' } },
      activities: {},
      recipes: {},
      institutionTypes: {},
      officeTypes: {},
      formationArchetypes: {},
      equipmentClasses: {},
      financeProfiles: {},
      revenueChannels: {},
      financeInstruments: {},
      controlProfiles: {
        'control-profile:sovereign': {
          id: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000,
          extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
        },
      },
      relationshipTypes: {},
      routeClasses: {},
      terminology: {},
    },
    geography: {
      assets: {
        'asset:test:regions': {
          id: 'asset:test:regions', mediaType: 'application/geo+json', checksum: SHA_A,
          license: 'Synthetic test asset', effectiveDate: '1900-01-01',
        },
      },
      regions: {
        'region:test:A': {
          id: 'region:test:A',
          link: { kind: 'scenario-asset', assetId: 'asset:test:regions', featureId: 'A' },
          adjacentRegionIds: [],
        },
      },
    },
    startingState: {
      polities: {
        'polity:alpha': {
          id: 'polity:alpha', displayName: { en: 'Alpha' }, color: '#112233', treasury: 10,
          stockpiles: { 'commodity:food': 5 }, evidenceIds: ['evidence:polity-alpha'],
        },
      },
      regions: {
        'region:test:A': {
          id: 'region:test:A', displayName: { en: 'A' }, legalOwnerPolityId: 'polity:alpha',
          actualControllerPolityId: 'polity:alpha', controlProfileId: 'control-profile:sovereign',
          fiscalBase: 10, productiveCapacity: 20, supplyCapacity: 30,
          resources: { 'commodity:food': 5 }, evidenceIds: ['evidence:region-a'],
        },
      },
      populationCohorts: {
        'cohort:alpha': {
          id: 'cohort:alpha', regionId: 'region:test:A', population: 100,
          workforceParticipationBp: 5000, recruitmentEligibilityBp: 1000,
          evidenceIds: ['evidence:cohort-alpha'],
        },
      },
      formations: {}, institutions: {}, relationships: {}, routes: {},
      concepts: {
        'concept:writing': {
          id: 'concept:writing',
          type: 'technology',
          semanticKey: 'writing',
          displayName: { en: 'Writing' },
          description: { en: 'Durable symbolic recording and transmission of information.' },
          origin: {
            originEntityRefs: ['polity:alpha'],
            originMonth: '1900-01-01',
            discovererEntityRef: 'polity:alpha',
          },
          parentConceptIds: [],
          supportingEvidenceIds: ['evidence:concept-writing'],
          domains: ['domain:communication'],
          status: 'institutionalized',
          maturityBp: 10000,
          diffusion: { 'region:test:A': 10000 },
          adoption: { polities: { 'polity:alpha': 10000 }, regions: { 'region:test:A': 10000 } },
          sourceEvidenceId: 'evidence:concept-writing',
          evidenceIds: ['evidence:concept-writing'],
        },
      },
      knowledge: {
        'knowledge:alpha-writing': {
          id: 'knowledge:alpha-writing', polityId: 'polity:alpha', conceptId: 'concept:writing',
          evidenceIds: ['evidence:knowledge-alpha-writing'],
        },
      },
    },
    provenance: {
      sources: profile === 'historical' ? {
        'source:test:archive': { id: 'source:test:archive', title: 'Test archive', locator: 'shelf/1', checksum: SHA_B },
      } : {},
      evidence: {
        'evidence:polity-alpha': { id: 'evidence:polity-alpha', binding: { path: '/startingState/polities/polity:alpha', valueChecksum: SHA_A }, basis, visibility: 'public' },
        'evidence:region-a': { id: 'evidence:region-a', binding: { path: '/startingState/regions/region:test:A', valueChecksum: SHA_A }, basis, visibility: 'public' },
        'evidence:cohort-alpha': { id: 'evidence:cohort-alpha', binding: { path: '/startingState/populationCohorts/cohort:alpha', valueChecksum: SHA_A }, basis, visibility: 'public' },
        'evidence:concept-writing': { id: 'evidence:concept-writing', binding: { path: '/startingState/concepts/concept:writing', valueChecksum: SHA_A }, basis, visibility: 'public' },
        'evidence:knowledge-alpha-writing': { id: 'evidence:knowledge-alpha-writing', binding: { path: '/startingState/knowledge/knowledge:alpha-writing', valueChecksum: SHA_A }, basis, visibility: 'polity', visibleToPolityIds: ['polity:alpha'] },
      },
    },
  };
  refreshScenarioV3EvidenceChecksums(scenario);
  return scenario;
}

export function refreshScenarioV3EvidenceChecksums(scenario: ScenarioV3Input): ScenarioV3Input {
  for (const evidence of Object.values(scenario.provenance.evidence)) {
    evidence.binding.valueChecksum = scenarioV3ValueChecksumAtPointer(scenario, evidence.binding.path);
  }
  return scenario;
}
