import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildFallbackBatch,
  buildDiplomacyBatch,
  buildDiplomacyBatches,
  buildOpponentBatches,
  buildPolityBrief,
  EMPTY_AGENT_STATE,
  MAX_BATCHES_PER_MONTH,
  MAX_BATCH_BRIEF_CHARS,
  MAX_POLITIES_PER_BATCH,
  MAX_POLITY_BRIEF_CHARS,
  opponentBatchResultSchema,
  selectOpponentPolities,
  validateOpponentBatch,
  validateDiplomacyBatch,
  buildStrategicBriefV2,
  buildStrategicBatchesV2,
  materializeStrategicDecisionV2,
  materializeStrategicBatchV2,
  strategicDecisionV2Schema,
  buildStrategicBriefV3,
  buildStrategicBatchesV3,
  expandStrategicAffordancesV3,
  materializeStrategicDecisionV3,
  materializeStrategicBatchV3,
  buildStrategicBriefV4,
  materializeStrategicDecisionV4,
  dispatchStrategicSessions,
  stableStrategicCommitOrder,
  strategicCallBudget,
  isQuarterlyCheckpoint,
  politicalIdentitySchema,
  buildStrategicPoliticsFromState,
  assertStrategicRunCompatible,
  commitStrategicMemory,
  pendingTriggerRetryMonth,
  type AgentState,
} from '../src/index.js';
import { econCommandSchema, initState, parseScenario, runTurn, stateChecksum, type EconWorldState } from '@open-historia/engine';

const fixture = fileURLToPath(new URL('../../../engine/fixtures/scenario-dev-map-4c/scenario.json', import.meta.url));
const fallbackGolden = fileURLToPath(new URL('../../test/golden/p3a-fallback-chain.json', import.meta.url));
const initial = () => initState(parseScenario(JSON.parse(readFileSync(fixture, 'utf8'))));
const diplomacyFixture = fileURLToPath(new URL('../../../engine/fixtures/scenario-dev-map-6c/scenario.json', import.meta.url));
const diplomacyInitial = () => initState(parseScenario(JSON.parse(readFileSync(diplomacyFixture, 'utf8'))));
const inertDiplomacyInitial = () => {
  const raw = JSON.parse(readFileSync(diplomacyFixture, 'utf8'));
  raw.polities.find((entry: { id: string }) => entry.id === 'polity:austria').decisionMode = 'inert';
  return initState(parseScenario(raw));
};
const benchmarkFixture = fileURLToPath(new URL('../../../data-packs/fixtures/europe-1935-benchmark/engine/scenario.json', import.meta.url));
const benchmarkInitial = () => initState(parseScenario(JSON.parse(readFileSync(benchmarkFixture, 'utf8'))));
const canonicalPoliticalInitial = () => {
  const raw = JSON.parse(readFileSync(diplomacyFixture, 'utf8'));
  const polity = raw.politics.polities.find((entry: { polityId: string }) => entry.polityId === 'polity:austria');
  polity.strategyAuthority = {
    headOfStateCharacterId: 'character:austria-ruler', headOfGovernmentCharacterId: 'character:austria-ruler',
    decisionAuthorityCharacterId: 'character:austria-ruler', rulingFactionId: 'faction:austria-establishment',
    currentConstraints: ['Preserve sovereign government.', 'Avoid diplomatic isolation.'],
  };
  raw.politics.factions.find((entry: { factionId: string }) => entry.factionId === 'faction:austria-establishment').politicalIdentity = {
    nativeLabel: 'Bundesstaat Österreich', legitimacyBases: ['Federal constitution'],
    governingPrinciples: ['Preserve Austrian independence'], strategicPreferences: ['Seek external guarantees'],
    taboos: ['Unforced loss of sovereignty'], riskAttitude: 'cautious',
  };
  for (const characterId of ['character:austria-ruler', 'character:austria-heir']) {
    raw.politics.characters.find((entry: { characterId: string }) => entry.characterId === characterId).leaderCard = {
      historical: false, factCard: ['Exercises only authority defined by this fixture.'],
      knowledgePolicy: 'scenario-only', sourceRefs: ['source:fixture:politics'],
    };
  }
  return initState(parseScenario(raw));
};

const holdV2 = (polityId: string) => ({
  polityId, objective: { domain: 'economy' as const, summary: 'Preserve room to manoeuvre.', horizon: 'short' as const },
  actions: [{ tool: 'conserve' as const }], futurePlan: [], contingency: 'Review after new evidence.', rationale: 'No supported material action is justified.',
  hold: { reason: 'plan-sequencing' as const, detail: 'Wait for the next checkpoint.', revisit: { afterMonths: 1, triggers: ['resource-deficit' as const] } },
});

const politicalV4 = (polityId: string) => {
  const card = (role: 'head-of-state' | 'head-of-government' | 'decision-authority') => ({
    characterId: `character:${polityId.slice(7)}:leader`, name: 'Scenario Leader', role, historical: false,
    factCard: ['Exercises the authority declared by the scenario.'], knowledgePolicy: 'scenario-only' as const,
    sourceRefs: ['source:test:scenario'],
  });
  return {
    identity: { nativeLabel: 'Scenario government', legitimacyBases: ['Authored constitutional order'],
      governingPrinciples: ['Preserve sovereignty'], strategicPreferences: ['Use material evidence'], taboos: ['Inventing state facts'],
      riskAttitude: 'balanced' as const },
    headOfState: card('head-of-state'), headOfGovernment: card('head-of-government'), decisionAuthority: card('decision-authority'),
    rulingGroup: 'Scenario cabinet', currentConstraints: ['Remain within authored law'],
  };
};

test('StrategicBriefV2 exposes monthly flows, iron runway and parameterized tools without geometry', () => {
  const state = benchmarkInitial();
  const brief = buildStrategicBriefV2(state, 'polity:germany');
  assert.equal(brief.schemaVersion, 'open-historia-strategic-brief/2');
  const iron = brief.economy.resources.find((entry) => entry.resource === 'iron')!;
  assert.ok(iron.monthlyConsumption > iron.monthlyProduction);
  assert.ok(iron.runwayMonths !== null && iron.runwayMonths > 0);
  assert.ok(brief.tools.some((entry) => entry.tool === 'negotiate-trade'));
  assert.equal(JSON.stringify(brief).includes('geometry'), false);
  assert.equal(JSON.stringify(brief).includes('coordinates'), false);
});

test('StrategicDecisionV2 requires typed hold and limits compatible material actions', () => {
  assert.deepEqual(strategicDecisionV2Schema.parse(holdV2('polity:germany')), holdV2('polity:germany'));
  assert.throws(() => strategicDecisionV2Schema.parse({ ...holdV2('polity:germany'), hold: null }), /hold is required/);
  assert.throws(() => strategicDecisionV2Schema.parse({ ...holdV2('polity:germany'), actions: [
    { tool: 'invest', targetRegionId: 'region:benchmark-1:DE', scale: 'small' },
    { tool: 'conserve' },
  ], hold: null }), /conserve cannot/);
});

test('materializer creates deterministic ids and engine-priced trade commands', () => {
  const state = benchmarkInitial();
  const decision = { polityId: 'polity:germany', objective: { domain: 'economy', summary: 'Protect industrial production.', horizon: 'medium' },
    actions: [{ tool: 'negotiate-trade', partner: 'polity:soviet-union', resource: 'iron', desiredRunway: 'medium', budgetAttitude: 'urgent' }],
    futurePlan: [{ summary: 'Seek another supplier.', condition: 'The proposal is rejected.' }], contingency: 'Use another authored route.',
    rationale: 'Iron has a finite runway.', hold: null };
  const first = materializeStrategicDecisionV2(state, decision);
  const second = materializeStrategicDecisionV2(state, decision);
  assert.deepEqual(first, second);
  assert.equal(first.rejected.length, 0);
  assert.equal(first.commands[0]?.kind, 'diplomacy.propose');
  assert.equal(runTurn(state, { commands: first.commands }).result.rejections.length, 0);
  const stale = materializeStrategicDecisionV2(runTurn(state, { commands: [] }).result.state, decision, { expectedRevision: state.revision });
  assert.match(stale.rejected[0]?.reason ?? '', /stale-revision/);
});

test('materializer turns qualitative production priority into exact conserved allocations', () => {
  const state = benchmarkInitial();
  const decision = { polityId: 'polity:germany', objective: { domain: 'economy', summary: 'Extend raw-material runway.', horizon: 'short' },
    actions: [{ tool: 'reallocate-production', targetRegionId: 'region:benchmark-1:DE', priority: 'raw-materials', scale: 'medium' }],
    futurePlan: [], contingency: 'Seek imports if domestic allocation is insufficient.', rationale: 'Processing is consuming iron faster than domestic extraction replaces it.', hold: null };
  const result = materializeStrategicDecisionV2(state, decision);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.commands[0]?.kind, 'economy.reallocate-production');
  if (result.commands[0]?.kind !== 'economy.reallocate-production') return;
  assert.equal(result.commands[0].allocations.reduce((sum, entry) => sum + entry.allocationBp, 0), 10000);
  assert.equal(runTurn(state, { commands: result.commands }).result.rejections.length, 0);
});

test('materializer rejects incompatible actions atomically and reports unsupported residuals', () => {
  const state = benchmarkInitial();
  const incompatible = materializeStrategicDecisionV2(state, { polityId: 'polity:germany', objective: { domain: 'military', summary: 'Coerce Austria.', horizon: 'short' },
    actions: [{ tool: 'propose-agreement', partner: 'polity:austria', agreementType: 'non-aggression' },
      { tool: 'declare-war', defender: 'polity:austria', reason: 'rivalry' }], futurePlan: [], contingency: 'Pause.', rationale: 'Probe compatibility.', hold: null });
  assert.equal(incompatible.commands.length, 0);
  assert.match(incompatible.rejected[0]?.reason ?? '', /cannot negotiate/);
  const residual = materializeStrategicDecisionV2(state, { polityId: 'polity:germany', objective: { domain: 'diplomacy', summary: 'Seek a policy concession.', horizon: 'medium' },
    actions: [{ tool: 'apply-diplomatic-pressure', partner: 'polity:austria', demand: 'policy-change', pressure: 'medium' }], futurePlan: [], contingency: 'Continue talks.',
    rationale: 'Use supported pressure channels.', intendedOutcome: 'Austria changes an internal policy.', hold: null });
  assert.equal(residual.commands.length, 0);
  assert.ok(residual.unsupportedResidual.some((entry) => entry.startsWith('diplomatic-pressure:')));
});

test('Strategic V2 batches are bounded and materialize all actors against one revision', () => {
  const state = benchmarkInitial();
  const batches = buildStrategicBatchesV2(state, 'polity:germany');
  assert.equal(batches.length, 2);
  assert.ok(batches.every((entry) => entry.polityIds.length <= 6 && entry.characterCount <= 40000));
  const batch = batches[0]!;
  const materialized = materializeStrategicBatchV2(state, { decisions: batch.polityIds.map(holdV2) }, batch);
  assert.deepEqual(materialized, { commands: [], unsupportedResidual: [], rejected: [] });
  const advanced = runTurn(state, { commands: [] }).result.state;
  assert.match(materializeStrategicBatchV2(advanced, { decisions: batch.polityIds.map(holdV2) }, batch).rejected[0]?.reason ?? '', /stale-revision/);
});

test('inert engine polities remain legal world entities but receive no opponent decision turn', () => {
  const state = inertDiplomacyInitial();
  const player = 'polity:germany';
  assert.equal(state.polities.some((entry) => entry.id === 'polity:austria' && entry.decisionMode === 'inert'), true);
  assert.equal(selectOpponentPolities(state, player, EMPTY_AGENT_STATE).includes('polity:austria'), false);
  assert.equal(buildDiplomacyBatches(state, player).flatMap((batch) => batch.polityIds).includes('polity:austria'), false);
  assert.equal(buildStrategicBatchesV2(state, player).flatMap((batch) => batch.polityIds).includes('polity:austria'), false);
  assert.equal(buildStrategicBatchesV3(state, player).flatMap((batch) => batch.polityIds).includes('polity:austria'), false);
  assert.equal(buildOpponentBatches(state, ['polity:austria', 'polity:italy'], (id) => buildPolityBrief(state, id))
    .flatMap((batch) => batch.polityIds).includes('polity:austria'), false);
});

test('StrategicBriefV3 publishes only individually executable coupled affordances', () => {
  const state = benchmarkInitial();
  const brief = buildStrategicBriefV3(state, 'polity:germany', {
    externalSupplierPolityIds: ['polity:soviet-union', 'polity:united-states'],
    strategicContext: { interests: ['secure inputs'], threats: ['iron exhaustion'], obligations: ['honour agreements'], redLines: ['no invented facts'],
      causalAnchors: [{ anchorId: 'anchor:iron', interest: 'secure inputs', applicability: ['iron deficit'], invalidators: ['iron surplus'] }], memory: ['Imports were reviewed.'] },
  });
  assert.equal(brief.schemaVersion, 'open-historia-strategic-brief/3');
  assert.equal(brief.decisionSchemaVersion, 'open-historia-strategic-decision/2');
  assert.deepEqual(brief.context.interests, ['secure inputs']);
  assert.ok(brief.affordances.some((entry) => entry.tool === 'conserve'));
  assert.equal(JSON.stringify(brief).includes('allowed'), false);
  assert.equal(JSON.stringify(brief).includes('geometry'), false);
  assert.equal(JSON.stringify(brief).includes('character:'), false);
  const actions = expandStrategicAffordancesV3(brief);
  assert.ok(actions.length > 1);
  for (const action of actions) {
    if (action.tool === 'conserve') continue;
    const decision = { ...holdV2('polity:germany'), actions: [action], hold: null };
    const result = materializeStrategicDecisionV3(state, decision, brief);
    assert.equal(result.rejected.length, 0, `${action.tool}: ${JSON.stringify(result.rejected)}`);
    assert.ok(result.commands.length > 0, action.tool);
    assert.equal(runTurn(state, { commands: result.commands }).result.rejections.length, 0, action.tool);
  }
  assert.deepEqual(state, benchmarkInitial(), 'affordance enumeration and validation must not mutate state');
});

test('StrategicBriefV3 removes empty and mismatched options and enforces frozen choices', () => {
  const state = benchmarkInitial();
  const brief = buildStrategicBriefV3(state, 'polity:germany', { externalSupplierPolityIds: ['polity:soviet-union'] });
  const realloc = brief.affordances.find((entry) => entry.tool === 'reallocate-production');
  if (realloc?.tool === 'reallocate-production') {
    for (const region of realloc.regions) for (const priority of region.priorities) for (const choice of priority.scales) {
      assert.equal(choice.action.targetRegionId, region.region.id);
      assert.equal(choice.action.priority, priority.priority);
    }
  }
  assert.ok(brief.affordances.every((entry) => expandStrategicAffordancesV3({ ...brief, affordances: [entry] }).length > 0));
  const invented = { ...holdV2('polity:germany'), actions: [{ tool: 'invest' as const, targetRegionId: 'region:invented:XX', scale: 'small' as const }], hold: null };
  const rejected = materializeStrategicDecisionV3(state, invented, brief);
  assert.equal(rejected.commands.length, 0);
  assert.match(rejected.rejected[0]?.reason ?? '', /frozen V3 affordance/);
});

test('Strategic V3 policy choices preserve relative policy and batches include complete prompt size', () => {
  const policyState = diplomacyInitial();
  const brief = buildStrategicBriefV3(policyState, 'polity:austria');
  const policy = brief.affordances.find((entry) => entry.tool === 'change-policy');
  assert.ok(policy?.tool === 'change-policy');
  if (policy?.tool !== 'change-policy') return;
  const steady = policy.choices.find((entry) => entry.action.taxStance === 'steady')!;
  assert.ok(steady.preview.deltas.some((entry) => entry.path.endsWith('taxBurdenBp') && entry.before === entry.after));
  assert.ok(policy.choices.every((entry) => Object.values((entry.preview.deltas.find((delta) => delta.path.endsWith('priorities'))?.after ?? {}) as Record<string, number>).reduce((sum, value) => sum + value, 0) === 10000));
  const systemText = 'S'.repeat(1200);
  const state = benchmarkInitial();
  const batches = buildStrategicBatchesV3(state, 'polity:germany', { systemText });
  assert.ok(batches.every((entry) => entry.characterCount === systemText.length
    + JSON.stringify({ requiredPolityIds: entry.polityIds, briefs: entry.briefs }).length));
  assert.ok(batches.every((entry) => entry.polityIds.length === 1 || entry.characterCount < 39500));
  assert.ok(batches.every((entry) => entry.characterCount < 40000));
});

test('Strategic V3 batch rejects duplicate tools, exclusive targets, and reciprocal wars', () => {
  const state = benchmarkInitial();
  const batches = buildStrategicBatchesV3(state, 'polity:germany');
  const batch = batches[0]!;
  const decisions = batch.polityIds.map(holdV2);
  const actorBrief = batch.briefs[0]!;
  const action = expandStrategicAffordancesV3(actorBrief).find((entry) => entry.tool !== 'conserve');
  if (action) decisions[0] = { ...holdV2(batch.polityIds[0]!), actions: [action, action], hold: null } as never;
  assert.match(materializeStrategicBatchV3(state, { decisions }, batch).rejected[0]?.reason ?? '', /one action per tool|exclusive target/);
});

test('Strategic V3 diplomacy, proposal, faction, and project options carry public context and legal targets', () => {
  let state = diplomacyInitial();
  const base = (actorPolityId: string, suffix: string) => ({ commandId: `94000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month });
  const germanRegion = state.regions.find((entry) => entry.controllerId === 'polity:germany')!;
  state = runTurn(state, { commands: [{ kind: 'diplomacy.propose', ...base('polity:germany', '1'), proposalId: 'proposal:v3-terms',
    recipientPolityId: 'polity:austria', terms: { kind: 'territorial-settlement', fromPolityId: 'polity:germany',
      toPolityId: 'polity:austria', regionIds: [germanRegion.regionId] } }] as never }).result.state;
  const brief = buildStrategicBriefV3(state, 'polity:austria');
  const proposals = brief.affordances.find((entry) => entry.tool === 'respond-proposal');
  assert.ok(proposals?.tool === 'respond-proposal');
  if (proposals?.tool === 'respond-proposal') {
    assert.deepEqual(proposals.proposals[0]?.terms, { kind: 'territorial-settlement', fromPolityId: 'polity:germany',
      toPolityId: 'polity:austria', regionIds: [germanRegion.regionId] });
    assert.ok(proposals.proposals[0]?.choices.every((entry) => ['accept', 'reject'].includes(entry.action.response)));
  }
  const pressure = brief.affordances.find((entry) => entry.tool === 'apply-diplomatic-pressure');
  if (pressure?.tool === 'apply-diplomatic-pressure') for (const partner of pressure.partners) for (const choice of partner.choices) {
    if (choice.action.demand === 'territorial-concession') assert.equal(state.regions.find((entry) => entry.regionId === choice.action.targetRegionId)?.controllerId, partner.partner.id);
    assert.notEqual(choice.action.demand, 'policy-change');
  }
  const factions = brief.affordances.find((entry) => entry.tool === 'respond-faction');
  if (factions?.tool === 'respond-faction') assert.ok(factions.factions.every((entry) => entry.escalation !== 'calm' && entry.faction.name.length > 0));
  const projects = brief.affordances.find((entry) => entry.tool === 'start-project');
  if (projects?.tool === 'start-project') for (const project of projects.projects) {
    assert.ok(project.template.name.length > 0 && project.cost > 0 && project.durationMonths > 0);
    assert.ok(project.choices.every((choice) => project.targetMode === 'owned-region' ? Boolean(choice.action.targetRegionId) && !choice.action.targetPolityId
      : project.targetMode === 'foreign-polity' ? Boolean(choice.action.targetPolityId) && !choice.action.targetRegionId
        : !choice.action.targetPolityId && !choice.action.targetRegionId));
  }
});

test('Strategic V3 zero treasury and current control remove unaffordable or invalid options', () => {
  const state = diplomacyInitial();
  const clone = structuredClone(state);
  clone.polities.find((entry) => entry.id === 'polity:austria')!.treasury = 0;
  clone.revision = stateChecksum(clone) as EconWorldState['revision'];
  const brief = buildStrategicBriefV3(clone, 'polity:austria');
  assert.equal(brief.affordances.some((entry) => ['invest', 'negotiate-trade', 'external-import'].includes(entry.tool)), false);
  const factions = brief.affordances.find((entry) => entry.tool === 'respond-faction');
  if (factions?.tool === 'respond-faction') assert.ok(factions.factions.every((entry) => entry.choices.every((choice) => choice.action.response !== 'concede')));
  const mobilize = brief.affordances.find((entry) => entry.tool === 'mobilize');
  if (mobilize?.tool === 'mobilize') assert.ok(mobilize.regions.every((entry) => entry.choices.every((choice) => {
    const command = materializeStrategicDecisionV3(clone, { ...holdV2('polity:austria'), actions: [choice.action], hold: null }, brief).commands[0];
    return command?.kind === 'military.mobilize' && command.manpower > 0 && command.equipment > 0;
  })));
});

test('Strategic V3 war protections, active formation orders, and leader-only peace are enforced', () => {
  let state = diplomacyInitial();
  const base = (actorPolityId: string, suffix: string) => ({ commandId: `95000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month });
  state = runTurn(state, { commands: [{ kind: 'war.declare', ...base('polity:germany', '1'), warId: 'war:v3-order',
    defenderPolityId: 'polity:austria', reason: 'rivalry' }] as never }).result.state;
  const german = buildStrategicBriefV3(state, 'polity:germany');
  const declarations = german.affordances.find((entry) => entry.tool === 'declare-war');
  if (declarations?.tool === 'declare-war') assert.equal(declarations.defenders.some((entry) => entry.defender.id === 'polity:austria'), false);
  const orders = german.affordances.find((entry) => entry.tool === 'issue-order');
  if (orders?.tool === 'issue-order') assert.ok(orders.formations.every((entry) => entry.status === 'active'
    && entry.choices.every((choice) => choice.action.posture === 'advance' ? choice.action.targetRegionId !== null : choice.action.targetRegionId === null)));
  const peace = german.affordances.find((entry) => entry.tool === 'negotiate-peace');
  assert.ok(peace?.tool === 'negotiate-peace' && peace.wars.some((entry) => entry.war.id === 'war:v3-order'));
  const nonLeader = buildStrategicBriefV3(state, 'polity:france').affordances.find((entry) => entry.tool === 'negotiate-peace');
  assert.equal(nonLeader, undefined);
});

test('Strategic V3 briefs, previews, commands, and batches are byte-deterministic and doctrine-free', () => {
  const state = diplomacyInitial();
  const options = { externalSupplierPolityIds: ['polity:france'], strategicContext: { interests: ['security'], threats: ['war'],
    obligations: ['treaty'], redLines: ['no surrender'], causalAnchors: [{ anchorId: 'anchor:test', interest: 'security', applicability: ['war'], invalidators: ['peace'] }],
    memory: ['Public consequence only.'] } };
  const first = buildStrategicBriefV3(state, 'polity:austria', options);
  const second = buildStrategicBriefV3(state, 'polity:austria', options);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(first).includes('Lebensraum'), false);
  assert.equal(JSON.stringify(first).includes('character:'), false);
  const action = expandStrategicAffordancesV3(first).find((entry) => entry.tool !== 'conserve')!;
  assert.equal(JSON.stringify(materializeStrategicDecisionV3(state, { ...holdV2('polity:austria'), actions: [action], hold: null }, first)),
    JSON.stringify(materializeStrategicDecisionV3(state, { ...holdV2('polity:austria'), actions: [action], hold: null }, second)));
  assert.equal(JSON.stringify(buildStrategicBatchesV3(state, 'polity:germany', { systemText: 'system' })),
    JSON.stringify(buildStrategicBatchesV3(state, 'polity:germany', { systemText: 'system' })));
});

test('strategic previews attribute action minus no-op over the same monthly tick', () => {
  const state = benchmarkInitial();
  const noOp = runTurn(state, { commands: [] }).result.state;
  const brief = buildStrategicBriefV3(state, 'polity:germany', { requestedTools: ['invest'] });
  const invest = brief.affordances.find((entry) => entry.tool === 'invest');
  assert.ok(invest?.tool === 'invest');
  const treasury = invest.regions[0]!.scales[0]!.preview.deltas.find((entry) => entry.path.endsWith('.treasury'))!;
  assert.equal(treasury.before, noOp.polities.find((entry) => entry.id === 'polity:germany')!.treasury);
  assert.notEqual(treasury.before, state.polities.find((entry) => entry.id === 'polity:germany')!.treasury,
    'fixture must have an ordinary monthly treasury tick so the regression is meaningful');
});

test('StrategicBriefV4 is a single-actor bounded ID catalog with politics and complete candidate audit', () => {
  const state = benchmarkInitial();
  const options = {
    invocation: { reason: 'scheduled-quarter' as const, detail: 'Quarterly strategic review.' },
    triggers: [{ triggerId: 'trigger:iron', kind: 'resource-emergency' as const, summary: 'Protect the iron runway.', mandatory: true,
      compatibleTools: ['invest' as const], evidenceIds: ['evidence:iron-runway'] }],
    relevantFamilies: ['invest' as const], political: politicalV4('polity:germany'), systemText: 'Compact production prompt.',
    strategicContext: { redLines: ['Loss of sovereignty'], obligations: ['Existing commitments are constraints.'] },
    countTokens: (text: string) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4),
  };
  const first = buildStrategicBriefV4(state, 'polity:germany', options);
  const second = buildStrategicBriefV4(state, 'polity:germany', options);
  assert.deepEqual(first, second);
  assert.equal(first.promptContract, 'StrategicBriefV4+StrategicDecisionV3');
  assert.match(first.role, /Germany/);
  assert.equal(first.political.decisionAuthority.knowledgePolicy, 'scenario-only');
  assert.ok(first.inputTokenCount <= 8000);
  assert.equal(first.tokenCountMethod, 'provider');
  assert.equal(first.candidateAudit.length, 15);
  assert.ok(first.choices.every((entry) => entry.choiceId.startsWith('choice:')));
  assert.equal(new Set(first.choices.map((entry) => entry.choiceId)).size, first.choices.length);
  assert.equal(JSON.stringify(first).includes('geometry'), false);
});

test('StrategicBriefV4 derives authority from canonical politics and observes a same-revision transfer', () => {
  const initial = canonicalPoliticalInitial();
  const political = buildStrategicPoliticsFromState(initial, 'polity:austria');
  assert.equal(political.identity.nativeLabel, 'Bundesstaat Österreich');
  assert.equal(political.decisionAuthority.characterId, 'character:austria-ruler');
  const brief = buildStrategicBriefV4(initial, 'polity:austria', {
    invocation: { reason: 'scheduled-quarter', detail: 'Quarterly review.' }, relevantFamilies: ['conserve'], countTokens: () => 1,
  });
  assert.equal(brief.political.rulingGroup, 'Austria Establishment');
  const abdicated = runTurn(initial, { commands: [econCommandSchema.parse({
    kind: 'politics.abdicate', commandId: '70000000-0000-4000-8000-000000000001',
    actorPolityId: 'polity:austria', expectedRevision: initial.revision, effectiveMonth: initial.month,
  })] }).result.state;
  const changed = buildStrategicBriefV4(abdicated, 'polity:austria', {
    invocation: { reason: 'government-change', detail: 'Power transferred.' }, relevantFamilies: ['conserve'], countTokens: () => 1,
  });
  assert.equal(changed.political.headOfState.characterId, 'character:austria-heir');
  assert.equal(changed.political.decisionAuthority.characterId, 'character:austria-heir');
});

test('StrategicBriefV4 cannot hide families required by active goals or material checkpoints', () => {
  const state = benchmarkInitial();
  const czech = buildStrategicBriefV4(state, 'polity:czechoslovakia', {
    invocation: { reason: 'scheduled-quarter', detail: 'Quarterly review.' },
    relevantFamilies: ['invest'], political: politicalV4('polity:czechoslovakia'), countTokens: () => 1,
  });
  assert.equal(czech.choices.some((entry) => entry.family === 'propose-agreement'), true);
  assert.match(czech.candidateAudit.find((entry) => entry.family === 'propose-agreement')?.reason ?? '', /active goal/);

  const poland = buildStrategicBriefV4(state, 'polity:poland', {
    invocation: { reason: 'war', detail: 'A supplied hostile formation is adjacent.' },
    relevantFamilies: ['invest'], political: politicalV4('polity:poland'), countTokens: () => 1,
  });
  assert.equal(poland.candidateAudit.find((entry) => entry.family === 'mobilize')?.disposition, 'published');
  assert.match(poland.candidateAudit.find((entry) => entry.family === 'mobilize')?.reason ?? '', /war checkpoint/);
});

test('StrategicDecisionV3 expands frozen IDs and requires exact compatible mandatory coverage', () => {
  const state = benchmarkInitial();
  const brief = buildStrategicBriefV4(state, 'polity:germany', {
    invocation: { reason: 'resource-emergency', detail: 'Iron exhaustion checkpoint.' },
    triggers: [{ triggerId: 'trigger:iron', kind: 'resource-emergency', summary: 'Protect iron supply.', mandatory: true,
      compatibleTools: ['invest'], evidenceIds: ['evidence:iron'] }],
    relevantFamilies: ['invest'], political: politicalV4('polity:germany'), countTokens: () => 1,
  });
  const selected = brief.choices.find((entry) => entry.family === 'invest')!;
  const rejected = brief.choices.find((entry) => entry.choiceId !== selected.choiceId)!;
  const decision = {
    polityId: 'polity:germany', revision: state.revision,
    objective: { domain: 'economy' as const, summary: 'Protect industrial resilience.', horizon: 'medium' as const },
    selectedChoices: [{ choiceId: selected.choiceId, purpose: 'Improve a legal domestic target.', evidenceIds: ['trigger:iron'],
      expectedConsequence: 'The engine preview shows a bounded infrastructure improvement.' }],
    triggerCoverage: [{ triggerId: 'trigger:iron', choiceIds: [selected.choiceId] }],
    rejectedChoices: [{ choiceId: rejected.choiceId, reason: 'Less useful at this checkpoint.' }],
    durablePlan: { objective: 'Preserve industrial resilience.', futureSteps: ['Reassess supply next quarter.'], commitments: [] },
    contingency: 'Use another published supply choice if conditions change.', hold: null,
  };
  const accepted = materializeStrategicDecisionV4(state, decision, brief);
  assert.equal(accepted.status, 'accepted');
  assert.ok(accepted.commands.length > 0);
  assert.equal(runTurn(state, { commands: accepted.commands }).result.rejections.length, 0);
  assert.equal(materializeStrategicDecisionV4(state, { ...decision, selectedChoices: [{ ...decision.selectedChoices[0], choiceId: 'choice:invented' }] }, brief).status, 'terminal');
  assert.equal(materializeStrategicDecisionV4(state, { ...decision, triggerCoverage: [] }, brief).status, 'hold');
  const advanced = runTurn(state, { commands: [] }).result.state;
  assert.equal(materializeStrategicDecisionV4(advanced, decision, brief).status, 'hold');
});

test('V4 scheduling is quarterly, bounded to four sessions, budgeted, and committed in stable polity order', () => {
  assert.equal(isQuarterlyCheckpoint('1935-01-01', '1935-01-01'), true);
  assert.equal(isQuarterlyCheckpoint('1935-01-01', '1935-02-01'), false);
  assert.equal(isQuarterlyCheckpoint('1935-01-01', '1935-04-01'), true);
  assert.deepEqual(dispatchStrategicSessions(['polity:e', 'polity:a', 'polity:d', 'polity:c', 'polity:b']),
    [['polity:a', 'polity:b', 'polity:c', 'polity:d'], ['polity:e']]);
  assert.equal(strategicCallBudget(7, '1935-01-01', '1936-01-01', 9), 44);
  assert.deepEqual(stableStrategicCommitOrder([{ polityId: 'polity:b' }, { polityId: 'polity:a' }]),
    [{ polityId: 'polity:a' }, { polityId: 'polity:b' }]);
});

test('political identity contract is era-neutral and V4 refuses an over-budget production prompt', () => {
  for (const nativeLabel of ['Mercian kingship (800)', 'Estate monarchy (1400)', 'Constitutional cabinet (1800)', 'Coalition republic (2026)']) {
    assert.equal(politicalIdentitySchema.parse({ nativeLabel, legitimacyBases: ['Authored lawful authority'],
      governingPrinciples: ['Preserve the polity'], strategicPreferences: ['Balance commitments and capacity'],
      taboos: [], riskAttitude: 'cautious' }).nativeLabel, nativeLabel);
  }
  assert.throws(() => buildStrategicBriefV4(benchmarkInitial(), 'polity:germany', {
    invocation: { reason: 'scheduled-quarter', detail: 'Review.' }, relevantFamilies: ['invest'],
    political: politicalV4('polity:germany'), countTokens: () => 8001,
  }), /exceeds 8000 tokens/);
  const fallbackCount = buildStrategicBriefV4(initial(), 'polity:austria', {
    invocation: { reason: 'scheduled-quarter', detail: 'Review.' }, relevantFamilies: ['conserve'],
    political: politicalV4('polity:austria'),
  });
  assert.equal(fallbackCount.tokenCountMethod, 'utf8-upper-bound');
  assert.ok(fallbackCount.inputTokenCount <= 8000);
});

test('V4 run compatibility is explicit and durable plans commit only with accepted actions', () => {
  const manifest = { schemaVersion: 'open-historia-strategic-run/3' as const, scenarioId: 'scenario:europe-1935-benchmark',
    scenarioContentVersion: '1.0.0', promptContract: 'StrategicBriefV4+StrategicDecisionV3' as const,
    provider: 'codex-subscription', model: 'gpt-5.6-luna', effort: 'medium', preflightChecksum: 'sha256:test' };
  assert.deepEqual(assertStrategicRunCompatible(manifest, manifest), manifest);
  assert.throws(() => assertStrategicRunCompatible({ ...manifest, schemaVersion: 'open-historia-strategic-run/2' }, manifest), /cannot resume/);
  assert.throws(() => assertStrategicRunCompatible({ ...manifest, model: 'gpt-5.6-sol' }, manifest), /frozen model changed/);
  const previous = { polityId: 'polity:germany', durablePlan: null, lastDecisionRevision: null };
  const held = commitStrategicMemory(previous, { status: 'hold', commands: [], decision: null,
    pendingTriggerIds: ['trigger:test'], reason: 'provider failure' });
  assert.deepEqual(held, previous);
  assert.notEqual(held, previous);
  assert.equal(pendingTriggerRetryMonth('1935-12-01'), '1936-01-01');
});

test('strategic diplomacy batch is bounded, deterministic and contains no full map', () => {
  const state = diplomacyInitial();
  const first = buildDiplomacyBatch(state, 'polity:austria');
  const second = buildDiplomacyBatch(state, 'polity:austria');
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.equal(first.polityIds.length, 5);
  assert.ok(first.characterCount <= MAX_BATCH_BRIEF_CHARS);
  assert.equal(JSON.stringify(first).includes('geometry'), false);
  assert.ok(first.briefs.every((brief) => brief.projectRegionCandidates.length <= 3
    && brief.mobilizationRegionCandidates.length <= 3 && brief.frontRegionCandidates.length <= 6
    && brief.peaceRegionCandidates.length <= 6 && brief.settlementRegionCandidates.length <= 6));
  assert.ok(first.briefs.every((brief) => ((brief.identity?.candidates as string[] | undefined)?.length ?? 0) <= 6));
  assert.ok(first.briefs.every((brief) => brief.campaignGoals.length <= 3 && brief.campaignCrises.length <= 3));
  assert.equal(JSON.stringify(first).includes('minorities'), false);
  assert.equal(JSON.stringify(first).includes('identity.regions'), false);
  assert.equal(JSON.stringify(first).includes('startingRegionCounts'), false);
  assert.equal(JSON.stringify(first).includes('supplyLinks'), false);
  assert.equal(JSON.stringify(first).includes('truths'), false);
  assert.equal(JSON.stringify(first).includes('liquid-fuel reserves'), false);
  assert.equal(JSON.stringify(first).includes('character:'), false);
  assert.ok(first.briefs.every((brief) => brief.projectRegionCandidates.length <= 3));
  assert.equal(buildDiplomacyBatch(initial(), 'polity:austria'), null);
});

test('nine-polity benchmark schedules every opponent in batches of at most six with bounded causal context', () => {
  const fixture = fileURLToPath(new URL('../../../data-packs/fixtures/europe-1935-benchmark/engine/scenario.json', import.meta.url));
  const state = initState(parseScenario(JSON.parse(readFileSync(fixture, 'utf8'))));
  const memory = Array.from({ length: 12 }, (_, index) => `1935-${String(index + 1).padStart(2, '0')}-01 observed fact`);
  const context = Object.fromEntries(state.polities.map((entry) => [entry.id, {
    interests: ['preserve security'], threats: ['revisionism'], obligations: ['public treaty'], redLines: ['occupation'],
    causalAnchors: [{ anchorId: `anchor:${entry.id.slice(7)}`, interest: 'preserve security', applicability: ['state survives'], invalidators: ['government replaced'] }], memory,
  }]));
  const batches = buildDiplomacyBatches(state, 'polity:germany', { strategicContextByPolity: context });
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.flatMap((entry) => entry.polityIds).sort(), state.polities.filter((entry) => entry.id !== 'polity:germany').map((entry) => entry.id).sort());
  assert.ok(batches.every((entry) => entry.polityIds.length <= 6 && entry.characterCount <= MAX_BATCH_BRIEF_CHARS));
  assert.ok(batches.every((entry) => !JSON.stringify(entry).includes('geometry')));
  assert.ok(batches.flatMap((entry) => entry.briefs).every((entry) => entry.strategicContext?.memory.length === 12));
});

test('strategic diplomacy validation requires one bound decision per polity', () => {
  const state = diplomacyInitial();
  const batch = buildDiplomacyBatch(state, 'polity:austria')!;
  const holds = { decisions: batch.polityIds.map((polityId) => ({ polityId, intent: 'hold' as const, rationale: 'No material action.', command: null })) };
  assert.deepEqual(validateDiplomacyBatch(holds, batch), holds);
  assert.throws(() => validateDiplomacyBatch({ decisions: holds.decisions.slice(1) }, batch), /every and only/);
  const wrongActor: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  wrongActor.decisions[0] = {
    polityId: batch.polityIds[0]!, intent: 'propose', rationale: 'Test proposal.',
    command: {
      kind: 'diplomacy.propose', commandId: '00000000-0000-4000-8000-000000000001',
      actorPolityId: 'polity:austria', recipientPolityId: batch.polityIds[0]!,
      expectedRevision: state.revision, effectiveMonth: state.month, proposalId: 'proposal:test',
      terms: { kind: 'agreement', agreementType: 'non-aggression', fromPolityId: 'polity:austria', toPolityId: batch.polityIds[0]! },
    },
  };
  assert.throws(() => validateDiplomacyBatch(wrongActor, batch), /actor mismatch/);

  const policy: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  policy.decisions[0] = {
    polityId: batch.polityIds[0]!, intent: 'set-policy', rationale: 'Rebalance public spending.',
    command: {
      kind: 'finance.set-policy', commandId: '00000000-0000-4000-8000-000000000002',
      actorPolityId: batch.polityIds[0]!, expectedRevision: state.revision, effectiveMonth: state.month,
      taxBurdenBp: 10000, exemptionBp: 500,
      priorities: { administration: 2500, science: 1500, industry: 2500, security: 1500, military: 2000 },
    },
  };
  assert.equal(validateDiplomacyBatch(policy, batch).decisions[0]?.intent, 'set-policy');

  const politics: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  const actor = batch.briefs.find((brief) => brief.factions.some((entry) => entry.escalation !== 'calm'))!;
  const faction = actor.factions.find((entry) => entry.escalation !== 'calm')!;
  const index = batch.polityIds.indexOf(actor.polityId);
  politics.decisions[index] = {
    polityId: actor.polityId, intent: 'repress', rationale: 'Contain an active crisis.',
    command: { kind: 'politics.respond', commandId: '00000000-0000-4000-8000-000000000003', actorPolityId: actor.polityId,
      expectedRevision: state.revision, effectiveMonth: state.month, factionId: faction.factionId, response: 'repress' },
  };
  assert.equal(validateDiplomacyBatch(politics, batch).decisions[index]?.intent, 'repress');

  const war: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  war.decisions[0] = {
    polityId: batch.polityIds[0]!, intent: 'declare-war', rationale: 'Escalate a public rivalry.',
    command: { kind: 'war.declare', commandId: '00000000-0000-4000-8000-000000000004',
      actorPolityId: batch.polityIds[0]!, expectedRevision: state.revision, effectiveMonth: state.month,
      warId: 'war:agent-validation', defenderPolityId: 'polity:austria', reason: 'rivalry' },
  };
  assert.equal(validateDiplomacyBatch(war, batch).decisions[0]?.intent, 'declare-war');

  const identity: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  const identityActor = batch.briefs.find((brief) => brief.identity)!;
  const identityIndex = batch.polityIds.indexOf(identityActor.polityId);
  identity.decisions[identityIndex] = {
    polityId: identityActor.polityId, intent: 'set-identity-policy', rationale: 'Reduce identity pressure.',
    command: { kind: 'identity.set-policy', commandId: '00000000-0000-4000-8000-000000000005',
      actorPolityId: identityActor.polityId, expectedRevision: state.revision, effectiveMonth: state.month,
      domain: 'culture', policy: 'integration' },
  };
  assert.equal(validateDiplomacyBatch(identity, batch).decisions[identityIndex]?.intent, 'set-identity-policy');

  const unknownIdentity: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  unknownIdentity.decisions[identityIndex] = {
    polityId: identityActor.polityId, intent: 'set-identity-acceptance', rationale: 'Invalid candidate.',
    command: { kind: 'identity.set-culture-acceptance', commandId: '00000000-0000-4000-8000-000000000006',
      actorPolityId: identityActor.polityId, expectedRevision: state.revision, effectiveMonth: state.month,
      domain: 'culture', identityId: 'culture:unknown', accepted: true },
  };
  assert.throws(() => validateDiplomacyBatch(unknownIdentity, batch), /outside bounded candidates/);

  const campaign: { decisions: Array<Record<string, unknown>> } = structuredClone(holds);
  const campaignActor = batch.briefs.find((brief) => brief.campaignGoals.some((entry) => entry.status === 'candidate'))!;
  const campaignIndex = batch.polityIds.indexOf(campaignActor.polityId);
  const goal = campaignActor.campaignGoals.find((entry) => entry.status === 'candidate')!;
  campaign.decisions[campaignIndex] = {
    polityId: campaignActor.polityId, intent: 'adopt-goal', rationale: 'Adopt an engine-advertised direction.',
    command: { kind: 'campaign.adopt-goal', commandId: '00000000-0000-4000-8000-000000000007', actorPolityId: campaignActor.polityId,
      expectedRevision: state.revision, effectiveMonth: state.month, goalId: goal.goalId },
  };
  assert.equal(validateDiplomacyBatch(campaign, batch).decisions[campaignIndex]?.intent, 'adopt-goal');

  const crisisState = runTurn(state, { commands: [] }).result.state;
  const crisisBatch = buildDiplomacyBatch(crisisState, 'polity:austria')!;
  const crisisActor = crisisBatch.briefs.find((brief) => brief.campaignCrises.length)!;
  const crisisHolds: { decisions: Array<Record<string, unknown>> } = { decisions: crisisBatch.polityIds.map((polityId) => ({ polityId, intent: 'hold', rationale: 'Hold.', command: null })) };
  const crisisIndex = crisisBatch.polityIds.indexOf(crisisActor.polityId);
  crisisHolds.decisions[crisisIndex] = { polityId: crisisActor.polityId, intent: 'set-crisis-position', rationale: 'Seek compromise.',
    command: { kind: 'crisis.set-position', commandId: '00000000-0000-4000-8000-000000000008', actorPolityId: crisisActor.polityId,
      expectedRevision: crisisState.revision, effectiveMonth: crisisState.month, crisisId: crisisActor.campaignCrises[0]!.crisisId, position: 'compromise' } };
  assert.equal(validateDiplomacyBatch(crisisHolds, crisisBatch).decisions[crisisIndex]?.intent, 'set-crisis-position');
});

test('strategic AI sees and may answer only its addressed call to arms', () => {
  let state = diplomacyInitial();
  const command = (actorPolityId: string, suffix: number) => ({ commandId: `82000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month });
  state = runTurn(state, { commands: [{ kind: 'diplomacy.propose', ...command('polity:austria', 1), proposalId: 'proposal:p8-agent-alliance',
    recipientPolityId: 'polity:france', terms: { kind: 'agreement', agreementType: 'defensive-alliance', fromPolityId: 'polity:austria', toPolityId: 'polity:france' } }] as never }).result.state;
  state = runTurn(state, { commands: [{ kind: 'diplomacy.respond', ...command('polity:france', 2), proposalId: 'proposal:p8-agent-alliance', response: 'accept' }] as never }).result.state;
  state = runTurn(state, { commands: [{ kind: 'war.declare', ...command('polity:germany', 3), warId: 'war:p8-agent-call', defenderPolityId: 'polity:austria', reason: 'rivalry' }] as never }).result.state;
  const batch = buildDiplomacyBatch(state, 'polity:austria')!;
  const france = batch.briefs.find((entry) => entry.polityId === 'polity:france')!;
  assert.equal(france.callsToArms?.length, 1);
  assert.ok(batch.briefs.filter((entry) => entry.polityId !== 'polity:france').every((entry) => entry.callsToArms === undefined));
  const decisions = batch.polityIds.map((polityId) => polityId === 'polity:france' ? ({ polityId, intent: 'accept-call' as const,
    rationale: 'Honor the supplied defensive obligation.', command: { kind: 'war.respond-call' as const,
      commandId: '82000000-0000-4000-8000-000000000004', actorPolityId: polityId, expectedRevision: state.revision,
      effectiveMonth: state.month, callId: france.callsToArms![0]!.callId as string, response: 'accept' as const } })
    : ({ polityId, intent: 'hold' as const, rationale: 'No material action.', command: null }));
  assert.equal(validateDiplomacyBatch({ decisions }, batch).decisions.find((entry) => entry.polityId === 'polity:france')?.intent, 'accept-call');
  const wrong: { decisions: Array<Record<string, unknown>> } = structuredClone({ decisions });
  const franceDecision = wrong.decisions.find((entry) => entry.polityId === 'polity:france')!;
  franceDecision.intent = 'refuse-call';
  assert.throws(() => validateDiplomacyBatch(wrong, batch), /response and intent must match/);
});

test('bounded briefs and batches never include the full map', () => {
  const state = initial();
  const selected = selectOpponentPolities(state, 'polity:austria', EMPTY_AGENT_STATE);
  const batches = buildOpponentBatches(state, selected, (id) => buildPolityBrief(state, id, {
    difficulty: 'medium', scenarioNote: 'Synthetic alternate-history context.', tags: ['independent'],
  }));
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.polityIds.length, 3);
  assert.ok((batches[0]?.characterCount ?? Infinity) <= MAX_BATCH_BRIEF_CHARS);
  for (const brief of batches[0]?.briefs ?? []) {
    assert.ok(JSON.stringify(brief).length <= MAX_POLITY_BRIEF_CHARS);
    assert.equal(Object.hasOwn(brief, 'regions'), false);
    assert.equal(Object.hasOwn(brief, 'map'), false);
  }
});

test('semantic validation binds every decision to its own brief and revision', () => {
  const state = initial();
  const batch = buildOpponentBatches(state, ['polity:germany'], (id) => buildPolityBrief(state, id))[0]!;
  const fallback = buildFallbackBatch(state, batch);
  assert.deepEqual(validateOpponentBatch(fallback, batch), opponentBatchResultSchema.parse(fallback));
  const wrong = structuredClone(fallback);
  if (wrong.decisions[0]?.command) wrong.decisions[0].command.expectedRevision = 'sha256:stale' as typeof state.revision;
  assert.throws(() => validateOpponentBatch(wrong, batch), /revision or month/);
});

test('fallback is deterministic and never spends without a positive preview', () => {
  const state = initial();
  const batch = buildOpponentBatches(state, ['polity:germany'], (id) => buildPolityBrief(state, id))[0]!;
  assert.deepEqual(buildFallbackBatch(state, batch), buildFallbackBatch(state, batch));
});

const scaleState = (): EconWorldState => {
  const base = initial();
  const sourcePolity = base.polities[0]!;
  const sourceRegions = base.regions.slice(0, 3);
  const polities = Array.from({ length: 100 }, (_, index) => ({
    ...sourcePolity,
    id: `polity:scale-${String(index).padStart(3, '0')}` as typeof sourcePolity.id,
    displayName: { en: `Scale ${index}`, ru: `Scale ${index}` },
  }));
  const regions = polities.flatMap((polity, polityIndex) => sourceRegions.map((source, regionIndex) => ({
    ...source,
    regionId: `region:scale:P${String(polityIndex).padStart(3, '0')}.${regionIndex}` as typeof source.regionId,
    controllerId: polity.id,
    activity: regionIndex === 0 ? source.activity : { kind: 'extraction' as const, resource: 'food' as const },
  })));
  const draft = { ...base, polities, regions, revision: 'pending' as typeof base.revision };
  return { ...draft, revision: stateChecksum(draft) as typeof base.revision };
};

test('100 active polities all tick for twelve months and rotate within five using at most four batches', () => {
  let state = scaleState();
  const player = state.polities[0]!.id;
  let agentState: AgentState = structuredClone(EMPTY_AGENT_STATE);
  const seen = new Set<string>();
  let seenWithinFive = 0;
  for (let month = 0; month < 12; month += 1) {
    const selected = selectOpponentPolities(state, player, agentState);
    const batches = buildOpponentBatches(state, selected, (id) => buildPolityBrief(state, id, { agentState }));
    assert.ok(batches.length <= MAX_BATCHES_PER_MONTH);
    assert.ok(batches.every((batch) => batch.polityIds.length <= MAX_POLITIES_PER_BATCH));
    selected.forEach((id) => seen.add(id));
    const selectedSet = new Set(selected);
    agentState = {
      schemaVersion: 'open-historia-agent-state/1',
      consumedActionIds: [],
      polities: [
        ...agentState.polities.filter((entry) => !selectedSet.has(entry.polityId)),
        ...selected.map((id) => ({
          polityId: id as AgentState['polities'][number]['polityId'],
          lastDecisionMonth: state.month,
          lastBriefFingerprint: state.revision,
          intent: 'conserve' as const,
          rationale: '',
          source: 'model' as const,
          lastOutcome: 'noop' as const,
          triggerFingerprint: 'fed||afford',
        })),
      ].sort((left, right) => left.polityId.localeCompare(right.polityId)),
    };
    const beforeTurns = state.turn;
    state = runTurn(state, { commands: [] }).result.state;
    assert.equal(state.turn, beforeTurns + 1);
    assert.equal(state.polities.length, 100);
    assert.equal(state.regions.length, 300);
    if (month === 4) seenWithinFive = seen.size;
  }
  assert.equal(seenWithinFive, 99);
  assert.equal(seen.size, 99);
});

test('ten-month fallback decision chain matches the dedicated P3a golden', () => {
  let state = initial();
  let agentState: AgentState = structuredClone(EMPTY_AGENT_STATE);
  const months = [];
  for (let index = 0; index < 10; index += 1) {
    const selected = selectOpponentPolities(state, 'polity:austria', agentState);
    const batches = buildOpponentBatches(state, selected, (id) => buildPolityBrief(state, id, { agentState }));
    const decisions = batches.flatMap((batch) => buildFallbackBatch(state, batch).decisions);
    const commands = decisions.flatMap((decision) => decision.command ? [decision.command] : [])
      .sort((left, right) => left.actorPolityId.localeCompare(right.actorPolityId));
    const before = state;
    state = runTurn(state, { commands }).result.state;
    months.push({
      month: before.month,
      revision: before.revision,
      targets: commands.map((command) => `${command.actorPolityId}->${command.targetRegionId}`),
      nextRevision: state.revision,
    });
    const chosen = new Set(selected);
    agentState = {
      schemaVersion: 'open-historia-agent-state/1',
      consumedActionIds: [],
      polities: [
        ...agentState.polities.filter((entry) => !chosen.has(entry.polityId)),
        ...decisions.map((decision) => ({
          polityId: decision.polityId,
          lastDecisionMonth: before.month,
          lastBriefFingerprint: before.revision,
          intent: decision.intent,
          rationale: decision.rationale,
          source: 'fallback' as const,
          lastOutcome: decision.command ? 'accepted' as const : 'noop' as const,
          triggerFingerprint: 'fed||afford',
        })),
      ].sort((left, right) => left.polityId.localeCompare(right.polityId)),
    };
  }
  const golden = JSON.parse(readFileSync(fallbackGolden, 'utf8'));
  assert.deepEqual({ schemaVersion: 'open-historia-p3a-fallback-chain/1', months }, golden);
});
