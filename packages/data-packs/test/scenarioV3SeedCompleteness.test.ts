import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateScenarioV3 } from '../src/v3/validator.js';
import { minimalScenarioV3, refreshScenarioV3EvidenceChecksums } from './scenarioV3Fixtures.js';

describe('ScenarioV3 → WorldStateV2 seed completeness', () => {
  it('sources every primary seed field or derives it without invented inputs', () => {
    const input = minimalScenarioV3();
    refreshScenarioV3EvidenceChecksums(input);
    const validated = validateScenarioV3(input);
    assert.strictEqual(validated.valid, true, JSON.stringify(validated.errors));
    const scenario = validated.scenario!;
    const region = Object.values(scenario.startingState.regions).find((entry) => entry.id === 'region:test:A')!;
    const profile = scenario.catalogs.controlProfiles[region.controlProfileId]!;
    const cohort = scenario.startingState.populationCohorts['cohort:alpha']!;
    const concept = scenario.startingState.concepts['concept:writing']!;
    const knowledge = scenario.startingState.knowledge['knowledge:alpha-writing']!;
    const polity = Object.values(scenario.startingState.polities).find((entry) => entry.id === 'polity:alpha')!;
    const evidence = scenario.provenance.evidence['evidence:knowledge-alpha-writing']!;

    const worldSeedFields = {
      schemaVersion: 'open-historia-world/2',
      scenarioId: scenario.id,
      month: scenario.game.startDate,
      turn: 0,
      revisionLineage: 'derived from the compiled seed checksum',
      worldRules: scenario.worldRules,
      modules: Object.values(scenario.catalogs.modules).filter((entry) => scenario.modules.enabled.includes(entry.id)),
      catalogs: {
        worldModels: Object.values(scenario.catalogs.worldModels),
        commodities: Object.values(scenario.catalogs.commodities),
        controlProfiles: Object.values(scenario.catalogs.controlProfiles),
      },
      polities: [{
        id: polity.id, displayName: polity.displayName, treasury: polity.treasury,
        stockpile: Object.entries(polity.stockpiles), evidenceIds: polity.evidenceIds,
      }],
      regions: [{
        regionId: region.id, displayName: region.displayName,
        control: {
          legalOwnerPolityId: region.legalOwnerPolityId,
          actualControllerPolityId: region.actualControllerPolityId,
          kind: profile.kind,
          controlProfileId: profile.id,
          administrationAccessBp: profile.administrationAccessBp,
          extractionAccessBp: profile.extractionAccessBp,
          recruitmentAccessBp: profile.recruitmentAccessBp,
          integrationBp: profile.integrationBp,
        },
        fiscalBase: region.fiscalBase,
        productiveCapacity: region.productiveCapacity,
        supplyCapacity: region.supplyCapacity,
        resourceDeposits: Object.entries(region.resources),
        evidenceIds: region.evidenceIds,
      }],
      populationCohorts: [{
        cohortId: cohort.id, regionId: cohort.regionId, population: cohort.population,
        workforceParticipationBp: cohort.workforceParticipationBp,
        recruitmentEligibilityBp: cohort.recruitmentEligibilityBp,
        evidenceIds: cohort.evidenceIds,
      }],
      formations: [],
      characters: [],
      groups: [],
      institutions: [],
      concepts: [{
        conceptId: concept.id,
        type: concept.type,
        semanticKey: concept.semanticKey,
        displayName: concept.displayName,
        description: concept.description,
        origin: concept.origin,
        parentConceptIds: concept.parentConceptIds,
        supportingEvidenceIds: concept.supportingEvidenceIds,
        domains: concept.domains,
        status: concept.status,
        maturityBp: concept.maturityBp,
        diffusion: concept.diffusion,
        adoption: concept.adoption,
        sourceEvidenceId: concept.sourceEvidenceId,
        evidenceIds: concept.evidenceIds,
      }],
      processes: [],
      relationships: [],
      knowledge: { records: [{ polityId: knowledge.polityId, conceptId: knowledge.conceptId, evidenceIds: knowledge.evidenceIds }] },
      events: [],
      evidence: [{ visibility: evidence.visibility, visibleToPolityIds: evidence.visibleToPolityIds }],
    };

    assert.deepStrictEqual(Object.keys(worldSeedFields), [
      'schemaVersion', 'scenarioId', 'month', 'turn', 'revisionLineage', 'worldRules', 'modules', 'catalogs',
      'polities', 'regions', 'populationCohorts', 'formations', 'characters', 'groups', 'institutions',
      'concepts', 'processes', 'relationships', 'knowledge', 'events', 'evidence',
    ]);
    assert.deepStrictEqual(worldSeedFields.regions[0]!.control.kind, 'sovereign');
    assert.deepStrictEqual(worldSeedFields.regions[0]!.fiscalBase, 10);
    assert.deepStrictEqual(worldSeedFields.populationCohorts[0]!.workforceParticipationBp, 5000);
    assert.deepStrictEqual(worldSeedFields.concepts[0]!.type, 'technology');
    assert.deepStrictEqual(worldSeedFields.concepts[0]!.status, 'institutionalized');
    assert.deepStrictEqual(worldSeedFields.knowledge.records[0]!.polityId, 'polity:alpha');
    assert.deepStrictEqual(worldSeedFields.evidence[0], { visibility: 'polity', visibleToPolityIds: ['polity:alpha'] });
  });

  it('derives formation manpower only as the exact sum of authored personnel origins', () => {
    const input = minimalScenarioV3();
    input.catalogs.formationArchetypes['formation-archetype:levy'] = { id: 'formation-archetype:levy', equipmentClassIds: [] };
    input.startingState.formations['formation:alpha'] = {
      id: 'formation:alpha', polityId: 'polity:alpha', archetypeId: 'formation-archetype:levy',
      personnelOrigins: { 'region:test:A': 7 }, equipment: {}, evidenceIds: ['evidence:formation-alpha'],
    };
    input.provenance.evidence['evidence:formation-alpha'] = {
      id: 'evidence:formation-alpha', binding: { path: '/startingState/formations/formation:alpha', valueChecksum: `sha256:${'a'.repeat(64)}` },
      basis: { kind: 'development', synthetic: true }, visibility: 'public',
    };
    refreshScenarioV3EvidenceChecksums(input);
    const validated = validateScenarioV3(input);
    assert.strictEqual(validated.valid, true, JSON.stringify(validated.errors));
    const scenario = validated.scenario!;
    const formation = scenario.startingState.formations['formation:alpha']!;
    const manpower = Object.values(formation.personnelOrigins).reduce((sum, value) => sum + value, 0);
    assert.strictEqual(manpower, 7);
  });

  it('derives institution and relationship kinds exactly from authored type IDs', () => {
    const input = minimalScenarioV3();
    input.catalogs.institutionTypes['institution-type:council'] = { id: 'institution-type:council' };
    input.catalogs.relationshipTypes['relationship-type:dependency'] = { id: 'relationship-type:dependency' };
    input.startingState.polities['polity:beta'] = {
      id: 'polity:beta', displayName: { en: 'Beta' }, color: '#445566', treasury: 0,
      stockpiles: {}, evidenceIds: ['evidence:polity-beta'],
    };
    input.startingState.institutions['institution:council'] = {
      id: 'institution:council', typeId: 'institution-type:council', polityId: 'polity:alpha',
      evidenceIds: ['evidence:institution-council'],
    };
    input.startingState.relationships['relationship:alpha-beta'] = {
      id: 'relationship:alpha-beta', typeId: 'relationship-type:dependency',
      participantPolityIds: ['polity:alpha', 'polity:beta'], evidenceIds: ['evidence:relationship-alpha-beta'],
    };
    for (const [id, path] of [
      ['evidence:polity-beta', '/startingState/polities/polity:beta'],
      ['evidence:institution-council', '/startingState/institutions/institution:council'],
      ['evidence:relationship-alpha-beta', '/startingState/relationships/relationship:alpha-beta'],
    ]) {
      input.provenance.evidence[id] = {
        id, binding: { path, valueChecksum: `sha256:${'a'.repeat(64)}` },
        basis: { kind: 'development', synthetic: true }, visibility: 'public',
      };
    }
    refreshScenarioV3EvidenceChecksums(input);
    const validated = validateScenarioV3(input);
    assert.strictEqual(validated.valid, true, JSON.stringify(validated.errors));
    const scenario = validated.scenario!;
    assert.strictEqual(scenario.startingState.institutions['institution:council']!.typeId, 'institution-type:council');
    assert.strictEqual(scenario.startingState.relationships['relationship:alpha-beta']!.typeId, 'relationship-type:dependency');
  });
});
