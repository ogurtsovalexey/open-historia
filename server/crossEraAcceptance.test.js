import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { processes, worldV2 } from '@open-historia/engine';
import { loadCompiledScenarioPack } from './scenarioPackStore.js';

const CASES = Object.freeze([
  {
    scenarioId: 'scenario:napoleonic-europe-1805', playerPolityId: 'polity:france', slug: 'napoleonic',
    diplomacy: { recipientPolityId: 'polity:bavaria', relationshipTypeId: 'relationship-type:coalition-negotiation' },
  },
  {
    scenarioId: 'scenario:central-mesoamerica-1450', playerPolityId: 'polity:tenochtitlan', slug: 'mesoamerica',
    diplomacy: { recipientPolityId: 'polity:chalco', relationshipTypeId: 'relationship-type:market-access' },
  },
]);

let temporary;
let library;
let living;

function territoryCase(state, playerPolityId) {
  const region = state.regions.find((entry) => (
    entry.control.legalOwnerPolityId === playerPolityId
    && entry.control.actualControllerPolityId === playerPolityId
  ));
  assert.ok(region, `territory-causality: ${state.scenarioId} has no sovereign region for ${playerPolityId}`);
  const recipient = state.polities.find((entry) => entry.id !== playerPolityId);
  assert.ok(recipient, `territory-causality: ${state.scenarioId} has no recipient polity`);
  const sovereign = state.catalogs.controlProfiles.find((entry) => entry.kind === 'sovereign');
  assert.ok(sovereign, `territory-causality: ${state.scenarioId} has no sovereign control profile`);
  return { recipient, region, sovereign };
}

function falseHistoryOutput(view, playerPolityId, foreignRegion, slug) {
  const evidenceId = view.interpretationContext.entities
    .find((entry) => entry.entityId === playerPolityId)?.evidenceIds[0];
  assert.ok(evidenceId, `false-history: ${playerPolityId} needs visible canonical evidence`);
  const text = `I conquered ${foreignRegion.label} ten turns ago.`;
  return {
    text,
    modelOutput: {
      revision: view.projection.revision,
      questions: [], requestedActions: [], proposedInitiatives: [],
      claims: [{
        claimId: `claim:invented-${slug}`,
        subject: playerPolityId,
        predicate: 'conquered-region',
        proposedValue: foreignRegion.entityId,
        proposedTime: 'ten turns ago',
        sourceSpan: { start: 0, end: text.length, text },
        grounding: 'supported', evidenceIds: [evidenceId],
      }],
    },
  };
}

function semanticProposal(state, playerPolityId, type, name, slug) {
  const region = state.regions.find((item) => item.control.actualControllerPolityId === playerPolityId);
  const evidenceId = state.evidence.find((item) => item.visibility === 'public')?.evidenceId;
  assert.ok(region && evidenceId, `open concept: ${slug} requires region and public evidence`);
  return {
    semanticProposalId: `semantic-proposal:wp12-${slug}`,
    type, displayName: { en: name }, description: { en: `Explore ${name} under current material constraints.` },
    originEntityRefs: [playerPolityId], parentConceptIds: [],
    domains: [type === 'technology' ? 'domain:communication' : 'domain:identity'],
    objective: `Develop a bounded ${name} practice`,
    direction: type === 'technology' ? 'direction:experimental' : 'direction:organizing',
    sponsorEntityRefs: [playerPolityId], affectedEntityRefs: [playerPolityId, region.regionId],
    pace: 'slow', effectFamilies: ['capacity.modify'], evidenceIds: [evidenceId],
  };
}

before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-cross-era-'));
  process.env.OH_DATA_DIR = temporary;
  library = await import('./libraryStore.js');
  living = await import('./livingWorldStore.js');
});

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  delete process.env.OH_DATA_DIR;
});

describe('WP12 cross-era acceptance', () => {
  for (const entry of CASES) {
    it(`false-history: ${entry.slug} contradicts an invented conquest without persisting it`, () => {
      const gameId = library.createGame({ scenarioId: entry.scenarioId, playerPolityId: entry.playerPolityId, name: `False history ${entry.slug}` }).game.id;
      const before = living.readLivingWorld(gameId);
      const foreignRegion = before.interpretationContext.entities.find((candidate) => (
        candidate.kind === 'region'
        && candidate.legalOwnerPolityId !== entry.playerPolityId
      ));
      assert.ok(foreignRegion, `false-history: ${entry.slug} needs a foreign region`);
      const { text, modelOutput } = falseHistoryOutput(before, entry.playerPolityId, foreignRegion, entry.slug);
      const submitted = living.submitLivingWorldIntent(gameId, {
        revision: before.projection.revision, sessionRevision: before.sessionRevision,
        intentions: [text], modelOutput,
      });
      assert.equal(submitted.projection.interpretation.claims[0].status, 'contradicted', `false-history: ${entry.slug} claim must be contradicted`);
      assert.equal(
        submitted.interpretationContext.entities.find((candidate) => candidate.entityId === foreignRegion.entityId).legalOwnerPolityId,
        foreignRegion.legalOwnerPolityId,
        `false-history: ${entry.slug} must preserve foreign legal control`,
      );
    });

    it(`territory-causality: ${entry.slug} moves regional numeric access but never formation allegiance`, () => {
      const state = loadCompiledScenarioPack(entry.scenarioId).initialState;
      const { region, recipient, sovereign } = territoryCase(state, entry.playerPolityId);
      const beforeSource = worldV2.derivePolitySnapshot(state, entry.playerPolityId).value;
      const beforeRecipient = worldV2.derivePolitySnapshot(state, recipient.id).value;
      const regional = worldV2.deriveRegionSnapshot(state, region.regionId).value;
      const formationsBefore = state.formations.map((formation) => ({
        formationId: formation.formationId, polityId: formation.polityId, manpower: formation.manpower,
        personnelOrigins: formation.personnelOrigins,
      }));
      const next = worldV2.applyTerritorialTransition(state, {
        transitionId: `transition:wp12-${entry.slug}`,
        regionId: region.regionId, kind: 'cede', expectedControl: region.control,
        targetControlProfileId: sovereign.controlProfileId,
        legalOwnerPolityId: recipient.id, actualControllerPolityId: recipient.id,
        authority: { kind: 'gm', interventionId: `intervention:wp12-${entry.slug}` },
        effectivePhase: 'opening', expectedRevision: state.revision,
      }).state;
      const afterSource = worldV2.derivePolitySnapshot(next, entry.playerPolityId).value;
      const afterRecipient = worldV2.derivePolitySnapshot(next, recipient.id).value;
      assert.equal(afterSource.controlledPopulation, beforeSource.controlledPopulation - regional.population, `territory-causality: ${entry.slug} source population must follow region`);
      assert.equal(afterRecipient.controlledPopulation, beforeRecipient.controlledPopulation + regional.population, `territory-causality: ${entry.slug} recipient population must follow region`);
      assert.equal(afterSource.taxBase, beforeSource.taxBase - regional.fiscalBase, `territory-causality: ${entry.slug} source fiscal base must reconcile`);
      assert.equal(afterRecipient.taxBase, beforeRecipient.taxBase + regional.fiscalBase, `territory-causality: ${entry.slug} recipient fiscal base must reconcile`);
      assert.deepEqual(next.formations.map((formation) => ({
        formationId: formation.formationId, polityId: formation.polityId, manpower: formation.manpower,
        personnelOrigins: formation.personnelOrigins,
      })), formationsBefore, `territory-causality: ${entry.slug} must preserve formation allegiance and origins`);
    });

    it(`diplomacy: ${entry.slug} freezes a scenario-local offer until only its recipient accepts`, () => {
      const state = loadCompiledScenarioPack(entry.scenarioId).initialState;
      const actor = state.polities.find((item) => item.id === entry.playerPolityId);
      const recipient = state.polities.find((item) => item.id === entry.diplomacy.recipientPolityId);
      assert.ok(actor && recipient, `diplomacy: ${entry.slug} requires both proposal parties`);
      assert.ok(
        state.catalogs.relationshipTypes.some((item) => item.relationshipTypeId === entry.diplomacy.relationshipTypeId),
        `diplomacy: ${entry.slug} must use only a scenario-local relationship type`,
      );
      const regionsBefore = structuredClone(state.regions);
      const evidenceId = actor.evidenceIds[0];
      assert.ok(evidenceId, `diplomacy: ${entry.slug} proposer requires canonical evidence`);
      const proposalId = `proposal:wp12-${entry.slug}-relationship`;
      const proposed = worldV2.proposeDiplomaticProposal(state, {
        proposalId,
        proposerPolityId: actor.id,
        recipientPolityIds: [recipient.id],
        terms: [{
          kind: 'relationship', relationshipTypeId: entry.diplomacy.relationshipTypeId,
          participantPolityIds: [actor.id, recipient.id],
        }],
        evidenceIds: [evidenceId],
        expectedRevision: state.revision,
      });
      assert.equal(proposed.relationships.length, state.relationships.length, `diplomacy: ${entry.slug} pending offer must not materialize a relationship`);
      assert.deepEqual(proposed.regions, regionsBefore, `diplomacy: ${entry.slug} pending offer must not change territory`);
      assert.equal(proposed.diplomaticProposals.find((item) => item.proposalId === proposalId)?.status, 'pending', `diplomacy: ${entry.slug} offer must stay pending`);

      const accepted = worldV2.resolveDiplomaticProposal(proposed, {
        proposalId, actorPolityId: recipient.id, decision: 'accept', expectedRevision: proposed.revision,
      });
      assert.equal(accepted.diplomaticProposals.find((item) => item.proposalId === proposalId)?.status, 'accepted', `diplomacy: ${entry.slug} recipient must resolve its own offer`);
      assert.equal(accepted.relationships.length, state.relationships.length + 1, `diplomacy: ${entry.slug} acceptance must create exactly one relationship`);
      assert.deepEqual(accepted.regions, regionsBefore, `diplomacy: ${entry.slug} a relationship offer must not transfer territory`);
    });

    it(`replay: ${entry.slug} resolves three monthly boundaries without a model call`, () => {
      const state = loadCompiledScenarioPack(entry.scenarioId).initialState;
      const first = living.resolveLivingWorldSubmonths(state, 3);
      const replay = living.resolveLivingWorldSubmonths(state, 3);
      assert.deepEqual(replay, first, `replay: ${entry.slug} must be byte-equivalent from one canonical revision`);
      assert.equal(first.submonths.length, 3, `replay: ${entry.slug} must record every monthly boundary`);
      assert.ok(first.submonths.every((month) => month.revisionBefore !== month.revisionAfter), `replay: ${entry.slug} every boundary needs a causal revision`);
    });

    it(`scenario-leakage: ${entry.slug} exposes only its own canonical catalog to player interpretation`, () => {
      const gameId = library.createGame({ scenarioId: entry.scenarioId, playerPolityId: entry.playerPolityId, name: `Catalog boundary ${entry.slug}` }).game.id;
      const view = living.readLivingWorld(gameId);
      const state = loadCompiledScenarioPack(entry.scenarioId).initialState;
      const knownIds = new Set([
        ...state.polities.map((item) => item.id), ...state.regions.map((item) => item.regionId),
        ...state.formations.map((item) => item.formationId), ...state.concepts.map((item) => item.conceptId),
        ...state.processes.map((item) => item.processId), ...state.relationships.map((item) => item.relationshipId),
        ...state.tributeObligations.map((item) => item.obligationId),
      ]);
      assert.ok(view.interpretationContext.entities.every((item) => knownIds.has(item.entityId)), `scenario-leakage: ${entry.slug} interpreter received an entity outside its seed`);
      assert.deepEqual(view.interpretationContext.relationshipTypes, state.catalogs.relationshipTypes.map((item) => item.relationshipTypeId).sort(), `scenario-leakage: ${entry.slug} relationship types must come only from its runtime catalog`);
    });

    it(`open concepts: ${entry.slug} admits electricity and communism only as bounded, funded processes`, () => {
      for (const [type, name] of [['technology', 'Electricity'], ['ideology', 'Communism']]) {
        const state = loadCompiledScenarioPack(entry.scenarioId).initialState;
        const proposal = semanticProposal(state, entry.playerPolityId, type, name, `${entry.slug}-${type}`);
        const resolution = processes.buildSemanticProcessEnginePlan(state, proposal);
        const accepted = processes.acceptSemanticProcessProposal(state, proposal, resolution.plan);
        const funded = processes.commitProcessResources(accepted.state, {
          processId: accepted.processId, expectedRevision: accepted.state.revision,
          investments: [{ investorEntityRef: entry.playerPolityId, amount: resolution.fundingCommitment }],
          capacityUse: resolution.capacityUse, evidenceIds: proposal.evidenceIds,
        }).state;
        const process = funded.processes.find((item) => item.processId === accepted.processId);
        assert.ok(process, `open concepts: ${entry.slug}/${name} process must exist`);
        assert.equal(process.stage, 'proposed', `open concepts: ${entry.slug}/${name} cannot jump directly to deployment`);
        assert.ok(processes.buildFeasibilityEnvelope(funded, process).allowedPaces.includes('slow'), `open concepts: ${entry.slug}/${name} must expose engine-bounded pace`);
        assert.ok(funded.polities.find((item) => item.id === entry.playerPolityId).treasury < state.polities.find((item) => item.id === entry.playerPolityId).treasury, `open concepts: ${entry.slug}/${name} must consume canonical funding`);
      }
    });
  }

  it('epistemics: Mesoamerican polity-private evidence is invisible to a different actor while Napoleonic evidence is explicitly public', () => {
    const meso = loadCompiledScenarioPack('scenario:central-mesoamerica-1450').initialState;
    const privateEvidence = meso.evidence.find((item) => item.visibility === 'polity');
    assert.ok(privateEvidence, 'epistemics: Mesoamerica must contain authored polity-private evidence');
    const owner = privateEvidence.visibleToPolityIds[0];
    const outsider = meso.polities.find((item) => item.id !== owner)?.id;
    assert.ok(owner && outsider, 'epistemics: private evidence requires distinct owner and outsider');
    const ownerEvidence = new Set(worldV2.selectEvidenceRegistry(meso, owner).value.entries.map((item) => item.evidenceId));
    const outsiderEvidence = new Set(worldV2.selectEvidenceRegistry(meso, outsider).value.entries.map((item) => item.evidenceId));
    assert.ok(ownerEvidence.has(privateEvidence.evidenceId), `epistemics: owner ${owner} must receive ${privateEvidence.evidenceId}`);
    assert.ok(!outsiderEvidence.has(privateEvidence.evidenceId), `epistemics: outsider ${outsider} must not receive ${privateEvidence.evidenceId}`);
    const napoleonic = loadCompiledScenarioPack('scenario:napoleonic-europe-1805').initialState;
    assert.ok(napoleonic.evidence.every((item) => item.visibility === 'public'), 'epistemics: Napoleonic seed must label its current evidence public rather than implying hidden knowledge');
  });
});
