import { describe, it } from 'node:test';
import assert from 'node:assert';
import { scenarioV3 } from '@open-historia/data-packs';
import { compileScenarioV3 } from '../src/world/compileScenarioV3.js';
import { ScenarioV3CompilationError, worldSeedV2Schema } from '../src/world/seed.js';
import { derivePolitySnapshot, deriveRegionSnapshot, deriveRouteSnapshot } from '../src/world/selectors.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;

function minimalScenario() {
  const evidence = (id: string, path: string, visibility: 'public' | 'polity' = 'public') => ({
    id,
    binding: { path, valueChecksum: SHA_A },
    basis: { kind: 'development' as const, synthetic: true as const },
    visibility,
    ...(visibility === 'polity' ? { visibleToPolityIds: ['polity:alpha'] } : {}),
  });
  const scenario = {
    schemaVersion: 'open-historia-scenario/3',
    id: 'scenario:compiler-minimal',
    profile: 'development',
    metadata: { title: { en: 'Compiler fixture' }, description: { en: 'Synthetic.' } },
    game: { startDate: '1900-01-01', defaultPlayerPolityId: 'polity:alpha', playerEligiblePolityIds: ['polity:alpha'] },
    worldRules: {
      physicalModel: 'world-model:physical-basic', knowledgeBaseline: ['concept:writing'],
      communicationModel: 'world-model:communication-basic', governmentModel: 'world-model:government-basic',
      militaryModel: 'world-model:military-basic', hardProhibitions: [], plausibilityContext: [],
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
      activities: {}, recipes: {}, institutionTypes: {}, officeTypes: {}, formationArchetypes: {},
      equipmentClasses: {}, financeProfiles: {}, revenueChannels: {}, financeInstruments: {},
      controlProfiles: {
        'control-profile:sovereign': {
          id: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000,
          extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
        },
      },
      relationshipTypes: {}, routeClasses: {}, terminology: {},
    },
    geography: {
      assets: {
        'asset:test:regions': {
          id: 'asset:test:regions', mediaType: 'application/geo+json', checksum: SHA_A,
          license: 'Synthetic', effectiveDate: '1900-01-01',
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
          decisionMode: 'active',
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
      formations: {}, institutions: {}, relationships: {}, diplomaticProposals: {}, tributeObligations: {}, routes: {},
      concepts: {
        'concept:writing': {
          id: 'concept:writing', type: 'technology', semanticKey: 'writing',
          displayName: { en: 'Writing' }, description: { en: 'Durable symbolic records.' },
          origin: {
            originEntityRefs: ['polity:alpha'], originMonth: '1900-01-01',
            discovererEntityRef: 'polity:alpha',
          },
          parentConceptIds: [], supportingEvidenceIds: ['evidence:concept-writing'],
          domains: ['domain:communication'], status: 'institutionalized', maturityBp: 10000,
          diffusion: { 'region:test:A': 10000 },
          adoption: { polities: { 'polity:alpha': 10000 }, regions: { 'region:test:A': 10000 } },
          sourceEvidenceId: 'evidence:concept-writing', evidenceIds: ['evidence:concept-writing'],
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
      sources: {},
      evidence: {
        'evidence:polity-alpha': evidence('evidence:polity-alpha', '/startingState/polities/polity:alpha'),
        'evidence:region-a': evidence('evidence:region-a', '/startingState/regions/region:test:A'),
        'evidence:cohort-alpha': evidence('evidence:cohort-alpha', '/startingState/populationCohorts/cohort:alpha'),
        'evidence:concept-writing': evidence('evidence:concept-writing', '/startingState/concepts/concept:writing'),
        'evidence:knowledge-alpha-writing': evidence(
          'evidence:knowledge-alpha-writing',
          '/startingState/knowledge/knowledge:alpha-writing',
          'polity',
        ),
      },
    },
  };
  refreshEvidenceChecksums(scenario);
  return scenario;
}

function refreshEvidenceChecksums<T extends {
  provenance: { evidence: Record<string, { binding: { path: string; valueChecksum: string } }> };
}>(scenario: T): T {
  for (const evidence of Object.values(scenario.provenance.evidence)) {
    evidence.binding.valueChecksum = scenarioV3.scenarioV3ValueChecksumAtPointer(scenario, evidence.binding.path);
  }
  return scenario;
}

function reverseRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse());
}

describe('ScenarioV3 engine compiler', () => {
  it('compiles a minimal development scenario into a lossless seed and valid initial WorldStateV2', () => {
    const input = minimalScenario();
    const compiled = compileScenarioV3(input);
    assert.strictEqual(compiled.seed.schemaVersion, 'open-historia-world-seed/2');
    assert.strictEqual(compiled.seed.sourceSchemaVersion, 'open-historia-scenario/3');
    assert.deepStrictEqual(compiled.seed.startingState, input.startingState);
    assert.match(compiled.bundleChecksum, /^sha256:[a-f0-9]{64}$/);
    assert.match(compiled.seedChecksum, /^sha256:[a-f0-9]{64}$/);
    assert.match(compiled.runtimeProjectionChecksum, /^sha256:[a-f0-9]{64}$/);
    assert.notStrictEqual(compiled.runtimeProjectionChecksum, compiled.seedChecksum);
    assert.deepStrictEqual(worldSeedV2Schema.parse(compiled.seed), compiled.seed);
    assert.strictEqual(worldSeedV2Schema.safeParse({ ...compiled.seed, unexpected: true }).success, false);
    assert.strictEqual(compiled.initialState.revisionLineage.seedRevision, compiled.seedChecksum);
    assert.ok(compiled.initialState.evidence.every((entry) => entry.revision === compiled.seedChecksum));
    assert.deepStrictEqual(compiled.diagnostics, []);
    assert.deepStrictEqual(compiled.runtimeProjection.polities, [{
      polityId: 'polity:alpha', displayName: { en: 'Alpha' }, color: '#112233', playerEligible: true,
    }]);
    assert.deepStrictEqual(compiled.initialState.regions[0]!.control, {
      legalOwnerPolityId: 'polity:alpha', actualControllerPolityId: 'polity:alpha',
      kind: 'sovereign', controlProfileId: 'control-profile:sovereign',
      administrationAccessBp: 10000, extractionAccessBp: 10000,
      recruitmentAccessBp: 10000, integrationBp: 10000,
    });
    const knowledgeEvidence = compiled.initialState.evidence.find(
      (entry) => entry.evidenceId === 'evidence:knowledge-alpha-writing',
    )!;
    assert.deepStrictEqual(knowledgeEvidence.entityRefs, ['concept:writing', 'polity:alpha']);
    assert.deepStrictEqual(knowledgeEvidence.canonicalPointers, ['/knowledge/records/0']);
    assert.ok('visibleToPolityIds' in knowledgeEvidence);
    assert.deepStrictEqual(knowledgeEvidence.visibleToPolityIds, ['polity:alpha']);
  });

  it('fails closed with validator diagnostics for an unknown reference', () => {
    const input = minimalScenario();
    input.startingState.regions['region:test:A']!.legalOwnerPolityId = 'polity:missing';
    assert.throws(() => compileScenarioV3(input), (error: unknown) => {
      assert.ok(error instanceof ScenarioV3CompilationError);
      assert.ok(error.diagnostics.some((entry) => entry.path === '/startingState/regions/region:test:A/legalOwnerPolityId'));
      return true;
    });
  });

  it('is byte-equivalent across repeated compilation and record-key permutations', () => {
    const input = minimalScenario();
    const permuted = {
      ...structuredClone(input),
      catalogs: {
        ...structuredClone(input.catalogs),
        worldModels: reverseRecord(input.catalogs.worldModels),
        controlProfiles: reverseRecord(input.catalogs.controlProfiles),
      },
      geography: {
        assets: reverseRecord(input.geography.assets),
        regions: reverseRecord(input.geography.regions),
      },
      startingState: {
        ...structuredClone(input.startingState),
        polities: reverseRecord(input.startingState.polities),
        regions: reverseRecord(input.startingState.regions),
        populationCohorts: reverseRecord(input.startingState.populationCohorts),
      },
      provenance: {
        sources: reverseRecord(input.provenance.sources),
        evidence: reverseRecord(input.provenance.evidence),
      },
    };
    const first = compileScenarioV3(input);
    const repeated = compileScenarioV3(input);
    const reordered = compileScenarioV3(permuted);
    assert.deepStrictEqual(first, repeated);
    assert.deepStrictEqual(first, reordered);
  });

  it('produces exact engine-derived regional and polity projections', () => {
    const { initialState } = compileScenarioV3(minimalScenario());
    const region = deriveRegionSnapshot(initialState, 'region:test:A').value;
    assert.deepStrictEqual({
      population: region.population,
      potentialWorkforce: region.potentialWorkforce,
      workforce: region.workforce,
      eligiblePopulation: region.eligiblePopulation,
      fiscalBase: region.fiscalBase,
      productiveCapacity: region.productiveCapacity,
    }, {
      population: 100, potentialWorkforce: 50, workforce: 50,
      eligiblePopulation: 10, fiscalBase: 10, productiveCapacity: 20,
    });
    const polity = derivePolitySnapshot(initialState, 'polity:alpha').value;
    assert.deepStrictEqual({
      legalPopulation: polity.legalPopulation,
      controlledPopulation: polity.controlledPopulation,
      administeredPopulation: polity.administeredPopulation,
      workforce: polity.workforce,
      taxBase: polity.taxBase,
      recruitablePopulation: polity.recruitablePopulation,
      unmobilizedRecruitablePopulation: polity.unmobilizedRecruitablePopulation,
      regionalOutput: polity.regionalOutput,
    }, {
      legalPopulation: 100, controlledPopulation: 100, administeredPopulation: 100,
      workforce: 50, taxBase: 10, recruitablePopulation: 10,
      unmobilizedRecruitablePopulation: 10, regionalOutput: 20,
    });
  });

  it('derives formation manpower exactly from sorted authored origins', () => {
    const input = minimalScenario();
    const withFormation = {
      ...input,
      catalogs: {
        ...input.catalogs,
        formationArchetypes: {
          'formation-archetype:levy': { id: 'formation-archetype:levy', equipmentClassIds: [] },
        },
      },
      startingState: {
        ...input.startingState,
        formations: {
          'formation:alpha': {
            id: 'formation:alpha', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy',
            personnelOrigins: { 'region:test:A': 7 }, equipment: {}, evidenceIds: ['evidence:formation-alpha'],
          },
        },
      },
      provenance: { sources: input.provenance.sources, evidence: {
        ...input.provenance.evidence,
        'evidence:formation-alpha': {
          id: 'evidence:formation-alpha',
          binding: { path: '/startingState/formations/formation:alpha', valueChecksum: SHA_A },
          basis: { kind: 'development', synthetic: true }, visibility: 'public',
        },
      } },
    };
    const compiled = compileScenarioV3(refreshEvidenceChecksums(withFormation));
    assert.deepStrictEqual(compiled.initialState.formations, [{
      formationId: 'formation:alpha', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy', manpower: 7,
      personnelOrigins: [{ regionId: 'region:test:A', personnel: 7 }],
      equipment: [],
      evidenceIds: ['evidence:formation-alpha'],
    }]);
    assert.strictEqual(derivePolitySnapshot(compiled.initialState, 'polity:alpha').value.fieldedPersonnel, 7);
  });

  it('losslessly compiles nonempty formation equipment and routes into live WorldStateV2', () => {
    const input = minimalScenario();
    const unsupported = {
      ...input,
      catalogs: {
        ...input.catalogs,
        commodities: {
          ...input.catalogs.commodities,
          'commodity:fuel': { id: 'commodity:fuel', unitId: 'unit:tonne', usage: 'both' },
        },
        routeClasses: { 'route-class:land': { id: 'route-class:land' } },
        equipmentClasses: {
          'equipment-class:arms': { id: 'equipment-class:arms' },
          'equipment-class:transport': { id: 'equipment-class:transport' },
        },
        formationArchetypes: { 'formation-archetype:levy': {
          id: 'formation-archetype:levy', equipmentClassIds: ['equipment-class:transport', 'equipment-class:arms'],
        } },
      },
      startingState: {
        ...input.startingState,
        routes: { 'route:test': {
          id: 'route:test', classId: 'route-class:land', regionIds: ['region:test:A'],
          allowedCommodityIds: ['commodity:food', 'commodity:fuel'], evidenceIds: ['evidence:route-test'],
        } },
        formations: { 'formation:alpha': {
          id: 'formation:alpha', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy',
          personnelOrigins: { 'region:test:A': 7 }, equipment: { 'equipment-class:transport': 2, 'equipment-class:arms': 3 },
          evidenceIds: ['evidence:formation-alpha'],
        } },
      },
      provenance: { sources: input.provenance.sources, evidence: {
        ...input.provenance.evidence,
        'evidence:route-test': {
          id: 'evidence:route-test', binding: { path: '/startingState/routes/route:test', valueChecksum: SHA_A },
          basis: { kind: 'development', synthetic: true }, visibility: 'public',
        },
        'evidence:formation-alpha': {
          id: 'evidence:formation-alpha', binding: { path: '/startingState/formations/formation:alpha', valueChecksum: SHA_A },
          basis: { kind: 'development', synthetic: true }, visibility: 'public',
        },
      } },
    };
    const compiled = compileScenarioV3(refreshEvidenceChecksums(unsupported));
    assert.deepStrictEqual(compiled.diagnostics, []);
    assert.deepStrictEqual(compiled.initialState.formations, [{
      formationId: 'formation:alpha', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy',
      manpower: 7, personnelOrigins: [{ regionId: 'region:test:A', personnel: 7 }],
      equipment: [
        { equipmentClassId: 'equipment-class:arms', quantity: 3 },
        { equipmentClassId: 'equipment-class:transport', quantity: 2 },
      ],
      evidenceIds: ['evidence:formation-alpha'],
    }]);
    assert.deepStrictEqual(compiled.initialState.routes, [{
      routeId: 'route:test', classId: 'route-class:land', regionIds: ['region:test:A'],
      allowedCommodityIds: ['commodity:food', 'commodity:fuel'], evidenceIds: ['evidence:route-test'],
    }]);
    assert.deepStrictEqual(derivePolitySnapshot(compiled.initialState, 'polity:alpha').value.equipment, [
      { equipmentClassId: 'equipment-class:arms', quantity: 3 },
      { equipmentClassId: 'equipment-class:transport', quantity: 2 },
    ]);
    assert.deepStrictEqual(deriveRouteSnapshot(compiled.initialState, 'route:test').value, {
      routeId: 'route:test', classId: 'route-class:land', regionIds: ['region:test:A'],
      allowedCommodityIds: ['commodity:food', 'commodity:fuel'],
    });

    const permuted = structuredClone(unsupported);
    permuted.catalogs.formationArchetypes['formation-archetype:levy']!.equipmentClassIds.reverse();
    permuted.startingState.routes['route:test']!.allowedCommodityIds.reverse();
    const recompiled = compileScenarioV3(permuted);
    assert.strictEqual(recompiled.seedChecksum, compiled.seedChecksum);
    assert.strictEqual(recompiled.initialState.revision, compiled.initialState.revision);

    const disallowed = structuredClone(unsupported);
    disallowed.catalogs.formationArchetypes['formation-archetype:levy']!.equipmentClassIds = [];
    assert.throws(() => compileScenarioV3(disallowed), (error: unknown) => {
      assert.ok(error instanceof ScenarioV3CompilationError);
      assert.deepStrictEqual(error.diagnostics.map((entry) => entry.path), [
        '/startingState/formations/formation:alpha/equipment/equipment-class:arms',
        '/startingState/formations/formation:alpha/equipment/equipment-class:transport',
      ]);
      return true;
    });
  });
});
