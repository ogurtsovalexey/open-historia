import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  assertAcyclicConceptDependencies,
  buildFeasibilityEnvelope,
  buildSemanticProcessEnginePlan,
} from '../src/processes/feasibility.js';
import { computeEffectDelta, semanticEffectSelectionSchema } from '../src/processes/effects.js';
import {
  acceptSemanticProcessProposal,
  advanceProcessDeterministically,
  applyProcessDecision,
  commitProcessResources,
} from '../src/processes/reducer.js';
import { semanticProcessProposalSchema, type ConceptState, type ProcessEnginePlan } from '../src/processes/schema.js';
import { nextRevisionLineage, stampWorldStateRevision } from '../src/world/revision.js';
import type { WorldStateV2, WorldStateV2Input } from '../src/world/schema.js';

const SEED = `sha256:${'1'.repeat(64)}`;

function nextMonth(state: WorldStateV2): WorldStateV2 {
  const [yearText, monthText] = state.month.slice(0, 7).split('-');
  const month = Number(monthText);
  const nextYear = month === 12 ? Number(yearText) + 1 : Number(yearText);
  const nextMonthNumber = month === 12 ? 1 : month + 1;
  const { revision: _revision, ...content } = state;
  void _revision;
  return stampWorldStateRevision({
    ...content,
    month: `${String(nextYear).padStart(4, '0')}-${String(nextMonthNumber).padStart(2, '0')}-01`,
    turn: state.turn + 1,
    revisionLineage: nextRevisionLineage(state),
  });
}

function advanceOneMonth(state: WorldStateV2, processId: string): WorldStateV2 {
  const advancedClock = nextMonth(state);
  return advanceProcessDeterministically(advancedClock, processId).state;
}

function worldInput(month = '1500-01-01'): WorldStateV2Input {
  return {
    schemaVersion: 'open-historia-world/2', scenarioId: 'scenario:process-kernel', month, turn: 0,
    revisionLineage: { seedRevision: SEED, ancestorRevisions: [] },
    worldRules: {
      physicalModel: 'physical-model:test', knowledgeBaseline: [],
      communicationModel: 'communication-model:test', governmentModel: 'government-model:test',
      militaryModel: 'military-model:test', hardProhibitions: [], plausibilityContext: ['pre-industrial test world'],
    },
    modules: { enabled: [] },
    catalogs: {
      modules: [],
      worldModels: [
        { modelId: 'physical-model:test', kind: 'physical' },
        { modelId: 'communication-model:test', kind: 'communication' },
        { modelId: 'government-model:test', kind: 'government' },
        { modelId: 'military-model:test', kind: 'military' },
      ],
      commodities: [{ commodityId: 'resource:copper', usage: 'both' }],
      controlProfiles: [{
        controlProfileId: 'control-profile:sovereign', kind: 'sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      }],
      formationArchetypes: [], equipmentClasses: [], routeClasses: [],
    },
    polities: [{
      id: 'polity:test', displayName: { en: 'Test polity' }, treasury: 1000,
      stockpiles: [{ commodityId: 'resource:copper', quantity: 2 }], evidenceIds: ['evidence:grounding'],
    }],
    regions: [{
      regionId: 'region:test:capital', displayName: { en: 'Capital' },
      control: {
        legalOwnerPolityId: 'polity:test', actualControllerPolityId: 'polity:test', kind: 'sovereign',
        controlProfileId: 'control-profile:sovereign', administrationAccessBp: 10000,
        extractionAccessBp: 10000, recruitmentAccessBp: 10000, integrationBp: 10000,
      },
      fiscalBase: 100, productiveCapacity: 100, supplyCapacity: 100,
      resourceDeposits: [{ resourceId: 'resource:copper', amount: 3 }], evidenceIds: ['evidence:grounding'],
    }],
    populationCohorts: [], formations: [], routes: [], characters: [], groups: [], institutions: [], concepts: [],
    processes: [], relationships: [], knowledge: { records: [] }, events: [],
    evidence: [{
      evidenceId: 'evidence:grounding', revision: SEED, kind: 'authored', entityRefs: ['polity:test', 'region:test:capital'],
      eventRefs: [], canonicalPointers: [], visibility: 'public',
    }],
  };
}

const emptyPlan = (): ProcessEnginePlan => ({
  prerequisites: {
    conceptIds: [], material: [], knowledgeEvidenceIds: ['evidence:grounding'], institutionIds: [],
    communicationEvidenceIds: [], oppositionEvidenceIds: [], minimumFunding: 0, capacity: [],
  },
  compatibleEffectFamilies: ['capacity.modify', 'group-support.shift'],
  initialFunding: 0,
  capacityUse: [],
  investments: [],
  initialMomentumBp: 5000,
  initialResistanceBp: 0,
});

function proposal(type: 'technology' | 'ideology', name: string, id: string) {
  return {
    semanticProposalId: `semantic-proposal:${id}`,
    type,
    displayName: { en: name },
    description: { en: `Investigate ${name}` },
    originEntityRefs: ['polity:test'],
    parentConceptIds: [],
    domains: [type === 'technology' ? 'domain:natural-philosophy' : 'domain:political-thought'],
    objective: `Develop ${name}`,
    direction: type === 'technology' ? 'direction:experimental' : 'direction:organizing',
    sponsorEntityRefs: ['polity:test'],
    affectedEntityRefs: ['polity:test', 'region:test:capital'],
    pace: 'breakthrough' as const,
    effectFamilies: type === 'technology' ? ['capacity.modify' as const] : ['group-support.shift' as const],
    evidenceIds: ['evidence:grounding'],
  };
}

describe('scenario-neutral process kernel', () => {
  it('accepts an electricity investigation in 1500 only as a proposed process', () => {
    const state = stampWorldStateRevision(worldInput('1500-01-01'));
    const result = acceptSemanticProcessProposal(state, proposal('technology', 'Electricity', 'electricity-1500'), emptyPlan());

    assert.strictEqual(result.state.concepts.length, 1);
    assert.strictEqual(result.state.concepts[0]!.type, 'technology');
    assert.strictEqual(result.state.concepts[0]!.status, 'proposed');
    assert.strictEqual(result.state.concepts[0]!.maturityBp, 0);
    assert.strictEqual(result.state.processes[0]!.stage, 'proposed');
    assert.strictEqual(result.state.processes[0]!.progressBp, 0);
    assert.strictEqual(result.state.polities[0]!.treasury, 1000);
    assert.deepStrictEqual(result.state.processes[0]!.selectedEffectFamilies, ['capacity.modify']);
    assert.ok(result.causalRecord);
    const transitionEvidence = result.state.evidence.find((entry) => entry.evidenceId === result.evidenceIds[0])!;
    assert.deepStrictEqual(transitionEvidence.canonicalPointers, ['/concepts/0', '/processes/0']);
  });

  it('turns early electricity into a funded investigation while prohibiting implausible pace', () => {
    const initial = stampWorldStateRevision(worldInput('1500-01-01'));
    const semantic = { ...proposal('technology', 'Electricity', 'bounded-electricity'), pace: 'stalled' as const };
    const resolution = buildSemanticProcessEnginePlan(initial, semantic);
    assert.deepStrictEqual(resolution.allowedPacesAfterCommitment, ['stalled', 'slow', 'steady']);
    const accepted = acceptSemanticProcessProposal(initial, semantic, resolution.plan);
    assert.deepStrictEqual(buildFeasibilityEnvelope(accepted.state, accepted.state.processes[0]!).allowedPaces, ['stalled']);
    const funded = commitProcessResources(accepted.state, {
      processId: accepted.processId,
      expectedRevision: accepted.state.revision,
      investments: [{ investorEntityRef: 'polity:test', amount: resolution.fundingCommitment }],
      capacityUse: resolution.capacityUse,
      evidenceIds: ['evidence:grounding'],
    }).state;
    assert.deepStrictEqual(buildFeasibilityEnvelope(funded, funded.processes[0]!).allowedPaces, ['stalled', 'slow', 'steady']);
    assert.throws(() => applyProcessDecision(funded, {
      processId: accepted.processId,
      direction: semantic.direction,
      pace: 'breakthrough',
      effectSelections: [{ kind: 'capacity.modify', targetEntityRef: 'region:test:capital' }],
      evidenceIds: ['evidence:grounding'],
    }), /pace breakthrough is infeasible/i);
  });

  it('accepts communism in 1200 but exposes material and institutional constraints', () => {
    const state = stampWorldStateRevision(worldInput('1200-01-01'));
    const plan = emptyPlan();
    plan.prerequisites.material = [{ resourceId: 'resource:copper', amount: 100 }];
    const result = acceptSemanticProcessProposal(state, proposal('ideology', 'Communism', 'communism-1200'), plan);
    const process = result.state.processes[0]!;
    const envelope = buildFeasibilityEnvelope(result.state, process);

    assert.strictEqual(result.state.concepts[0]!.type, 'ideology');
    assert.strictEqual(process.stage, 'proposed');
    assert.deepStrictEqual(envelope.allowedPaces, ['stalled']);
    assert.match(envelope.reasons.join('\n'), /Insufficient material resource:copper/);
  });

  it('deduplicates concepts by normalized semantic identity and is idempotent per proposal', () => {
    const initial = stampWorldStateRevision(worldInput());
    const first = acceptSemanticProcessProposal(initial, proposal('technology', 'Electricity', 'electricity-a'), emptyPlan()).state;
    assert.throws(
      () => acceptSemanticProcessProposal(first, proposal('technology', 'electricity', 'electricity-b'), emptyPlan()),
      /equivalentConceptId/,
    );
    const approvedDuplicate = {
      ...proposal('technology', 'electricity', 'electricity-b'),
      equivalentConceptId: first.concepts[0]!.conceptId,
    };
    const secondResult = acceptSemanticProcessProposal(first, approvedDuplicate, emptyPlan());
    assert.strictEqual(secondResult.state.concepts.length, 1);
    assert.strictEqual(secondResult.state.processes.length, 2);
    assert.strictEqual(secondResult.state.processes[0]!.conceptId, secondResult.state.processes[1]!.conceptId);

    const replaySameProposal = acceptSemanticProcessProposal(initial, proposal('technology', 'Electricity', 'electricity-a'), emptyPlan());
    assert.strictEqual(replaySameProposal.state.revision, first.revision);

    const equivalent = {
      ...proposal('technology', 'Electrical Force', 'electricity-equivalent'),
      equivalentConceptId: first.concepts[0]!.conceptId,
    };
    const equivalentResult = acceptSemanticProcessProposal(secondResult.state, equivalent, emptyPlan());
    assert.strictEqual(equivalentResult.state.concepts.length, 1);
    assert.strictEqual(equivalentResult.state.processes[2]!.conceptId, first.concepts[0]!.conceptId);

    const incompatible = {
      ...proposal('technology', 'Electric Power', 'electricity-incompatible'),
      equivalentConceptId: first.concepts[0]!.conceptId,
      domains: ['domain:currency'],
      effectFamilies: ['relation.modify' as const],
    };
    const incompatiblePlan = emptyPlan();
    incompatiblePlan.compatibleEffectFamilies.push('relation.modify');
    assert.throws(
      () => acceptSemanticProcessProposal(first, incompatible, incompatiblePlan),
      /incompatible domains, parents or effect families/,
    );
  });

  it('rejects arbitrary model numbers and unknown effect opcodes', () => {
    assert.throws(() => semanticProcessProposalSchema.parse({
      ...proposal('technology', 'Electricity', 'bad-number'), progressBp: 9000,
    }), /unrecognized key/i);
    assert.throws(() => semanticEffectSelectionSchema.parse({
      kind: 'state.execute-code', targetEntityRef: 'polity:test',
    }), /Invalid option|Invalid input/i);
    assert.throws(() => semanticEffectSelectionSchema.parse({
      kind: 'capacity.modify', targetEntityRef: 'region:test:capital', multiplier: 99,
    }), /unrecognized key/i);
    const funded = emptyPlan();
    funded.initialFunding = 100;
    funded.investments = [{ investorEntityRef: 'polity:test', amount: 100 }];
    assert.throws(
      () => acceptSemanticProcessProposal(stampWorldStateRevision(worldInput()), proposal('technology', 'Electricity', 'funded'), funded),
      /only an unfunded proposed process/,
    );
  });

  it('does not use enemy material to satisfy sponsor feasibility', () => {
    const input = worldInput();
    input.polities.push({
      id: 'polity:enemy', displayName: { en: 'Enemy' }, treasury: 0,
      stockpiles: [{ commodityId: 'resource:copper', quantity: 1000 }], evidenceIds: ['evidence:grounding'],
    });
    input.regions.push({
      ...structuredClone(input.regions[0]!), regionId: 'region:test:enemy', displayName: { en: 'Enemy region' },
      control: {
        ...input.regions[0]!.control,
        legalOwnerPolityId: 'polity:enemy', actualControllerPolityId: 'polity:enemy',
      },
      resourceDeposits: [{ resourceId: 'resource:copper', amount: 1000 }],
    });
    const plan = emptyPlan();
    plan.prerequisites.material = [{ resourceId: 'resource:copper', amount: 500 }];
    const accepted = acceptSemanticProcessProposal(
      stampWorldStateRevision(input), proposal('technology', 'Electricity', 'scoped-material'), plan,
    );
    const envelope = buildFeasibilityEnvelope(accepted.state, accepted.state.processes[0]!);
    assert.deepStrictEqual(envelope.allowedPaces, ['stalled']);
    assert.match(envelope.reasons.join('\n'), /Insufficient material/);
  });

  it('commits engine-resolved funding and capacity separately from semantic intent', () => {
    const initial = stampWorldStateRevision(worldInput());
    const plan = emptyPlan();
    plan.prerequisites.minimumFunding = 100;
    plan.prerequisites.capacity = [{
      capacityId: 'capacity:natural-philosophy', entityRef: 'region:test:capital', amount: 2,
    }];
    const accepted = acceptSemanticProcessProposal(
      initial,
      proposal('technology', 'Electricity', 'resourcing'),
      plan,
    );
    assert.deepStrictEqual(buildFeasibilityEnvelope(accepted.state, accepted.state.processes[0]!).allowedPaces, ['stalled']);

    const resourced = commitProcessResources(accepted.state, {
      processId: accepted.processId,
      expectedRevision: accepted.state.revision,
      investments: [{ investorEntityRef: 'polity:test', amount: 100 }],
      capacityUse: [{ capacityId: 'capacity:natural-philosophy', entityRef: 'region:test:capital', amount: 2 }],
      evidenceIds: ['evidence:grounding'],
    });
    assert.strictEqual(resourced.state.polities[0]!.treasury, 900);
    assert.strictEqual(resourced.state.processes[0]!.funding, 100);
    assert.deepStrictEqual(resourced.state.processes[0]!.investments, [{ investorEntityRef: 'polity:test', amount: 100 }]);
    assert.deepStrictEqual(buildFeasibilityEnvelope(resourced.state, resourced.state.processes[0]!).allowedPaces, [
      'stalled', 'slow', 'steady', 'fast', 'breakthrough',
    ]);
    const evidence = resourced.state.evidence.find((entry) => entry.evidenceId === resourced.evidenceIds[0])!;
    assert.ok(evidence.canonicalPointers.includes('/polities/0/treasury'));
    assert.throws(() => commitProcessResources(resourced.state, {
      processId: accepted.processId,
      expectedRevision: accepted.state.revision,
      investments: [{ investorEntityRef: 'polity:test', amount: 1 }],
      capacityUse: [],
      evidenceIds: ['evidence:grounding'],
    }), /expected .* current revision/);
  });

  it('uses fixed-point effect math and records changed canonical input at demonstrated stage', () => {
    assert.strictEqual(computeEffectDelta({
      baseDelta: Number.MAX_SAFE_INTEGER, minimum: 0, maximum: Number.MAX_SAFE_INTEGER, maturityScaleBp: 10000,
    }, 5000), 4_503_599_627_370_495);
    let state = stampWorldStateRevision(worldInput());
    const accepted = acceptSemanticProcessProposal(state, proposal('technology', 'Electricity', 'effect-evidence'), emptyPlan());
    state = accepted.state;
    for (let step = 0; step < 29; step += 1) state = advanceOneMonth(state, accepted.processId);
    state = applyProcessDecision(state, {
      processId: accepted.processId,
      direction: 'direction:experimental',
      pace: 'breakthrough',
      effectSelections: [{ kind: 'capacity.modify', targetEntityRef: 'region:test:capital' }],
      evidenceIds: ['evidence:grounding'],
    }).state;
    const result = advanceProcessDeterministically(nextMonth(state), accepted.processId, [{
      kind: 'capacity.modify', targetEntityRef: 'region:test:capital', parameter: 'productiveCapacity',
      duration: 'permanent', stacking: 'additive', sourceProcessId: accepted.processId,
      sourceEvidenceIds: ['evidence:grounding'], lowerBound: 0, upperBound: 1000, delta: 25,
    }]);
    assert.strictEqual(result.state.processes[0]!.stage, 'demonstrated');
    assert.strictEqual(result.state.regions[0]!.productiveCapacity, 125);
    const event = result.state.events.find((entry) => entry.eventId === result.eventIds[0])!;
    assert.ok(event.entityRefs.some((ref) => ref === 'region:test:capital'));
    const evidence = result.state.evidence.find((entry) => entry.evidenceId === result.evidenceIds[0])!;
    assert.ok(evidence.canonicalPointers.includes('/regions/0/productiveCapacity'));
  });

  it('materializes selected checkpoint effects with engine-owned magnitudes and no later model call', () => {
    const run = (): WorldStateV2 => {
      let state = stampWorldStateRevision(worldInput());
      const accepted = acceptSemanticProcessProposal(
        state,
        proposal('technology', 'Water power', 'automatic-checkpoint-effect'),
        emptyPlan(),
      );
      state = applyProcessDecision(accepted.state, {
        processId: accepted.processId,
        direction: 'direction:experimental',
        pace: 'breakthrough',
        effectSelections: [{ kind: 'capacity.modify', targetEntityRef: 'polity:test' }],
        evidenceIds: ['evidence:grounding'],
      }).state;
      for (let step = 0; step < 30; step += 1) state = advanceOneMonth(state, accepted.processId);
      return state;
    };
    const first = run();
    const replay = run();
    assert.deepStrictEqual(replay, first);
    assert.strictEqual(first.processes[0]!.stage, 'demonstrated');
    assert.strictEqual(first.regions[0]!.productiveCapacity, 101);
    const effectEvent = first.events.find((entry) => entry.kind === 'process-advanced-demonstrated');
    assert.ok(effectEvent?.entityRefs.some((ref) => ref === 'region:test:capital'));
    const evidence = first.evidence.find((entry) => entry.eventRefs.includes(effectEvent!.eventId));
    assert.ok(evidence?.canonicalPointers.includes('/regions/0/productiveCapacity'));
  });

  it('rejects cyclic concept dependencies', () => {
    const state = stampWorldStateRevision(worldInput());
    const base = acceptSemanticProcessProposal(state, proposal('technology', 'Electricity', 'cycle-a'), emptyPlan()).state;
    const first = base.concepts[0]!;
    const second: ConceptState = {
      ...structuredClone(first), conceptId: 'concept:cycle-b', semanticKey: 'cycle-b',
      displayName: { en: 'Cycle B' }, parentConceptIds: [first.conceptId],
    };
    const cyclic: WorldStateV2 = {
      ...base,
      concepts: [
        { ...first, parentConceptIds: [second.conceptId] },
        second,
      ],
    };
    assert.throws(() => assertAcyclicConceptDependencies(cyclic), /Cyclic concept dependency/);
  });

  it('replays accepted semantics without a model and produces byte-identical state', () => {
    const run = (): WorldStateV2 => {
      let state = stampWorldStateRevision(worldInput());
      const accepted = acceptSemanticProcessProposal(state, proposal('technology', 'Electricity', 'replay'), emptyPlan());
      state = accepted.state;
      for (let step = 0; step < 50; step += 1) {
        state = advanceOneMonth(state, accepted.processId);
      }
      return state;
    };
    const first = run();
    const second = run();
    assert.deepStrictEqual(second, first);
    assert.strictEqual(first.processes[0]!.stage, 'institutionalized');
    assert.strictEqual(first.processes[0]!.status, 'completed');
    assert.strictEqual(first.concepts[0]!.maturityBp, 10000);
  });

  it('cannot advance an ongoing process twice in the same world month', () => {
    const initial = stampWorldStateRevision(worldInput());
    const accepted = acceptSemanticProcessProposal(initial, proposal('technology', 'Electricity', 'monthly-only'), emptyPlan());
    const month = nextMonth(accepted.state);
    const once = advanceProcessDeterministically(month, accepted.processId).state;
    assert.throws(
      () => advanceProcessDeterministically(once, accepted.processId),
      /already advanced/,
    );
  });
});
