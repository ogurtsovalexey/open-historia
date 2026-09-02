import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { currentPoliticalStrategy, initState, parseScenario, parseTurnCommands, resolveMonth, type EconWorldState } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenarioRaw = JSON.parse(readFileSync(resolve(here, '../../fixtures/scenario-dev-map-6c/scenario.json'), 'utf8'));
const scenario = parseScenario(scenarioRaw);
const commandId = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const base = (state: EconWorldState, actorPolityId: string, suffix: number) => ({
  commandId: commandId(suffix), actorPolityId, expectedRevision: state.revision, effectiveMonth: state.month,
});
const tick = (state: EconWorldState, commands: unknown[] = []) => resolveMonth(state, parseTurnCommands({ commands }));
const strategyScenario = () => {
  const raw = structuredClone(scenarioRaw);
  const polity = raw.politics.polities.find((entry: { polityId: string }) => entry.polityId === 'polity:austria');
  polity.strategyAuthority = {
    headOfStateCharacterId: 'character:austria-ruler',
    headOfGovernmentCharacterId: 'character:austria-ruler',
    decisionAuthorityCharacterId: 'character:austria-ruler',
    rulingFactionId: 'faction:austria-establishment',
    currentConstraints: ['Preserve sovereign government.', 'Avoid diplomatic isolation.'],
  };
  const identity = {
    nativeLabel: 'Bundesstaat Österreich', legitimacyBases: ['Federal constitution'],
    governingPrinciples: ['Preserve Austrian independence'], strategicPreferences: ['Seek external guarantees'],
    taboos: ['Unforced loss of sovereignty'], riskAttitude: 'cautious',
  };
  raw.politics.factions.find((entry: { factionId: string }) => entry.factionId === 'faction:austria-establishment').politicalIdentity = identity;
  for (const characterId of ['character:austria-ruler', 'character:austria-heir']) {
    raw.politics.characters.find((entry: { characterId: string }) => entry.characterId === characterId).leaderCard = {
      historical: false, factCard: ['Exercises only authority defined by this fixture.'],
      knowledgePolicy: 'scenario-only', sourceRefs: ['source:fixture:politics'],
    };
  }
  return raw;
};

describe('P4 internal politics and characters (canon 13)', () => {
  it('materialises authored factions, characters and unique offices', () => {
    const state = initState(scenario);
    assert.equal(state.politics?.polities.length, 6);
    assert.equal(state.politics?.factions.length, 18);
    assert.equal(state.politics?.characters.length, 24);
    for (const polity of state.polities) {
      assert.equal(state.politics?.factions.filter((entry) => entry.polityId === polity.id).length, 3);
      const heldOffices: Array<string | null> = state.politics?.characters.filter((entry) => entry.polityId === polity.id && entry.office).map((entry) => entry.office) ?? [];
      assert.equal(new Set(heldOffices).size, heldOffices.length);
    }
  });

  it('materialises authored strategic authority and updates it in the power-transfer revision', () => {
    const initial = initState(parseScenario(strategyScenario()));
    const before = currentPoliticalStrategy(initial.politics!, 'polity:austria');
    assert.equal(before.decisionAuthority.characterId, 'character:austria-ruler');
    assert.equal(before.identity.nativeLabel, 'Bundesstaat Österreich');
    assert.deepEqual(before.currentConstraints, ['Preserve sovereign government.', 'Avoid diplomatic isolation.']);
    const abdicated = tick(initial, [{ kind: 'politics.abdicate', ...base(initial, 'polity:austria', 20) }]);
    const after = currentPoliticalStrategy(abdicated.state.politics!, 'polity:austria');
    assert.equal(after.headOfState.characterId, 'character:austria-heir');
    assert.equal(after.decisionAuthority.characterId, 'character:austria-heir');
    assert.equal(after.rulingFaction.factionId, 'faction:austria-establishment');
    assert.equal(after.identity.nativeLabel, 'Bundesstaat Österreich');
    assert.throws(() => currentPoliticalStrategy(initial.politics!, 'polity:france'), /authority missing/);
  });

  it('rejects strategic authority without same-polity leader cards and a faction identity', () => {
    const raw = strategyScenario();
    delete raw.politics.characters.find((entry: { characterId: string }) => entry.characterId === 'character:austria-ruler').leaderCard;
    assert.throws(() => parseScenario(raw), /strategic authority requires/);
    const prior = strategyScenario();
    prior.politics.characters.find((entry: { characterId: string }) => entry.characterId === 'character:austria-ruler').leaderCard = {
      historical: false, factCard: ['Invalid prior.'], knowledgePolicy: 'authored-card-plus-pre-scenario-prior',
      sourceRefs: ['source:fixture:politics'],
    };
    assert.throws(() => parseScenario(prior), /non-historical leaders require scenario-only knowledge/);
  });

  it('rejects unknown political references and duplicate authored offices', () => {
    const unknownLeader = structuredClone(scenarioRaw);
    unknownLeader.politics.factions[0].leaderCharacterId = 'character:missing';
    assert.throws(() => parseScenario(unknownLeader), /faction leader/);
    const duplicateOffice = structuredClone(scenarioRaw);
    duplicateOffice.politics.characters[2].office = 'ruler';
    assert.throws(() => parseScenario(duplicateOffice), /duplicate political office/);
  });

  it('derives policy support and escalation deterministically with an auditable ledger', () => {
    const initial = initState(scenario);
    const policy = {
      kind: 'finance.set-policy', ...base(initial, 'polity:austria', 1), taxBurdenBp: 15000, exemptionBp: 0,
      priorities: { administration: 1000, science: 1000, industry: 1000, security: 1000, military: 6000 },
    };
    const left = tick(initial, [policy]);
    const right = tick(initial, [policy]);
    assert.deepEqual(left, right);
    const labor = left.state.politics?.factions.find((entry) => entry.factionId === 'faction:austria-labor');
    assert.ok(labor && labor.supportBp < 2800);
    assert.equal(labor?.escalation, 'protest');
    const record = left.ledger.politics?.factionChanges.find((entry) => entry.factionId === labor?.factionId);
    assert.ok(record && record.taxEffect < 0 && record.budgetEffect < 0);
  });

  it('concedes a demand with conserved treasury and records the political spend', () => {
    const initial = initState(scenario);
    const opening = initial.polities.find((entry) => entry.id === 'polity:austria')!.treasury;
    const result = tick(initial, [{
      kind: 'politics.respond', ...base(initial, 'polity:austria', 2),
      factionId: 'faction:austria-labor', response: 'concede',
    }]);
    assert.equal(result.rejections.length, 0);
    const politicalSpend = result.ledger.polities.find((entry) => entry.polityId === 'polity:austria')?.politicalSpend;
    assert.ok(politicalSpend && politicalSpend > 0);
    const polityLedger = result.ledger.polities.find((entry) => entry.polityId === 'polity:austria')!;
    assert.equal(polityLedger.treasuryClosing, opening + polityLedger.taxTotal - politicalSpend - (polityLedger.finance?.interestPaid ?? 0));
    assert.equal(result.state.politics?.factions.find((entry) => entry.factionId === 'faction:austria-labor')?.escalation, 'calm');
  });

  it('creates and appoints a fictional official, then transfers power to the lawful heir', () => {
    const initial = initState(scenario);
    const created = tick(initial, [{
      kind: 'character.create', ...base(initial, 'polity:austria', 3), characterId: 'character:austria-player-minister',
      displayName: { en: 'Mara Adler', ru: 'Мара Адлер' }, origin: 'fictional-runtime', factionId: 'faction:austria-establishment',
      aptitudeTrait: 'administrator', loyaltyBand: 'high', ambitionBand: 'medium',
    }]);
    const appointed = tick(created.state, [{
      kind: 'politics.appoint', ...base(created.state, 'polity:austria', 4),
      characterId: 'character:austria-player-minister', office: 'finance',
    }]);
    assert.equal(appointed.state.politics?.characters.find((entry) => entry.characterId === 'character:austria-player-minister')?.office, 'finance');
    const before = appointed.state.politics!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    const abdicated = tick(appointed.state, [{ kind: 'politics.abdicate', ...base(appointed.state, 'polity:austria', 5) }]);
    const after = abdicated.state.politics!.polities.find((entry) => entry.polityId === 'polity:austria')!;
    assert.equal(after.rulerCharacterId, before.heirCharacterId);
    assert.equal(after.governmentChanges, 1);
    assert.ok(abdicated.events.some((entry) => entry.type === 'power-transferred' && entry.cause === 'abdication'));
  });

  it('executes a deterministic coup chain without deleting the playable polity', () => {
    let state = initState(scenario);
    for (let month = 0; month < 3; month += 1) state = tick(state).state;
    const politics = state.politics!.polities.find((entry) => entry.polityId === 'polity:germany')!;
    assert.equal(politics.rulerCharacterId, 'character:germany-nationalist');
    assert.equal(politics.governmentChanges, 1);
    assert.ok(state.polities.some((entry) => entry.id === 'polity:germany'));
    assert.equal(state.politics?.factions.find((entry) => entry.factionId === 'faction:germany-national')?.escalation, 'calm');
    const offices = state.politics!.characters.filter((entry) => entry.polityId === 'polity:germany' && entry.office).map((entry) => entry.office);
    assert.equal(new Set(offices).size, offices.length);
  });

  it('rejects stale, foreign, calm and invalid succession actions without partial mutation', () => {
    const initial = initState(scenario);
    const result = tick(initial, [
      { kind: 'politics.respond', ...base(initial, 'polity:austria', 6), factionId: 'faction:germany-national', response: 'repress' },
      { kind: 'politics.respond', ...base(initial, 'polity:austria', 7), factionId: 'faction:austria-establishment', response: 'refuse' },
      { kind: 'politics.appoint', ...base(initial, 'polity:austria', 8), expectedRevision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', characterId: 'character:austria-labor', office: 'finance' },
    ]);
    assert.deepEqual(result.rejections.map((entry) => entry.reason), ['unauthorized', 'inactive-crisis', 'stale-revision']);
    assert.equal(result.state.politics?.characters.find((entry) => entry.characterId === 'character:austria-labor')?.office, null);
  });
});
