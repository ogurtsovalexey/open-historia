import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { CommandId, PolityId, WorldRevisionId } from '@open-historia/domain';
import type { EconCommand, StatecraftCommand } from '../src/commands.js';
import { stateChecksum } from '../src/canonical.js';
import { parseScenario } from '../src/scenario.js';
import { initState, type EconWorldState } from '../src/state.js';
import { resolveMonth } from '../src/tick.js';
import { FIXTURES_DIR } from './helpers.js';

const scenario = parseScenario(JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-6c', 'scenario.json'), 'utf8')));
const AUSTRIA = 'polity:austria' as PolityId;
let sequence = 1;
const commandId = (): CommandId => `30000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}` as CommandId;
const common = (state: EconWorldState) => ({ commandId: commandId(), actorPolityId: AUSTRIA, expectedRevision: state.revision, effectiveMonth: state.month });
const start = (state: EconWorldState, projectId: string, templateId: string, extra: Partial<Extract<StatecraftCommand, { kind: 'project.start' }>> = {}): StatecraftCommand => ({
  kind: 'project.start', ...common(state), projectId, templateId,
  monthlyFunding: 1000, priority: 3, ...extra,
} as StatecraftCommand);

describe('P3c finance (canon 12)', () => {
  it('applies tax policy, bond issuance and debt service through an auditable ledger', () => {
    const state = initState(scenario);
    const before = state.polities.find((entry) => entry.id === AUSTRIA)!.treasury;
    const commands: StatecraftCommand[] = [{
      kind: 'finance.set-policy', ...common(state), taxBurdenBp: 15000, exemptionBp: 0,
      priorities: { administration: 2000, science: 2000, industry: 3000, security: 1000, military: 2000 },
    }, { kind: 'finance.issue-bonds', ...common(state), amount: 1000 }];
    const result = resolveMonth(state, { commands: commands as EconCommand[] });
    assert.deepEqual(result.rejections, []);
    const record = result.ledger.statecraft!.finance.find((entry) => entry.polityId === AUSTRIA)!;
    assert.equal(record.bondsIssued, 1000);
    assert.ok(record.taxEffective > record.taxBase);
    assert.equal(record.debtClosing, 1000);
    assert.equal(result.state.finance!.polities.find((entry) => entry.polityId === AUSTRIA)!.taxBurdenBp, 15000);
    assert.equal(result.state.polities.find((entry) => entry.id === AUSTRIA)!.treasury, before + 1000 + record.taxEffective - record.interestPaid);
    assert.ok(result.invariantsChecked.includes('debt-identity'));
  });

  it('rejects issuance beyond credit and voluntarily restructures deterministically', () => {
    const state = initState(scenario);
    const row = state.finance!.polities.find((entry) => entry.polityId === AUSTRIA)!;
    const rejected = resolveMonth(state, { commands: [{ kind: 'finance.issue-bonds', ...common(state), amount: row.creditLimit + 1 }] });
    assert.equal(rejected.rejections[0]?.reason, 'credit-limit');
    const issued = resolveMonth(state, { commands: [{ kind: 'finance.issue-bonds', ...common(state), amount: 1000 }] });
    const restructured = resolveMonth(issued.state, { commands: [{ kind: 'finance.restructure', ...common(issued.state) }] });
    const record = restructured.ledger.statecraft!.finance.find((entry) => entry.polityId === AUSTRIA)!;
    assert.equal(record.voluntaryHaircut, 100);
    assert.equal(record.debtClosing, 900);
    assert.equal(restructured.state.finance!.polities.find((entry) => entry.polityId === AUSTRIA)!.defaultCount, 1);
  });

  it('automatically defaults without negative treasury and damages trust', () => {
    const base = initState(scenario);
    const draft = structuredClone(base);
    const polity = draft.polities.find((entry) => entry.id === AUSTRIA)!;
    polity.treasury = 0;
    const finance = draft.finance!.polities.find((entry) => entry.polityId === AUSTRIA)!;
    finance.debtPrincipal = 10000000; finance.creditLimit = 10000000; finance.annualInterestBp = 10000;
    draft.revision = stateChecksum({ ...draft, revision: 'pending' as WorldRevisionId }) as WorldRevisionId;
    const trustBefore = draft.diplomacy!.relations.find((entry) => entry.polities.includes(AUSTRIA))!.trust;
    const result = resolveMonth(draft, { commands: [] });
    const record = result.ledger.statecraft!.finance.find((entry) => entry.polityId === AUSTRIA)!;
    assert.equal(record.defaulted, true);
    assert.equal(record.automaticHaircut, 2000000);
    assert.equal(result.state.polities.find((entry) => entry.id === AUSTRIA)!.treasury, 0);
    assert.equal(result.state.diplomacy!.relations.find((entry) => entry.polities.includes(AUSTRIA))!.trust, trustBefore - 750);
  });
});

describe('P3c unified projects and intelligence (canon 12)', () => {
  it('allocates shared capacity by priority and stable id with visible opportunity cost', () => {
    const state = initState(scenario);
    const result = resolveMonth(state, { commands: [
      start(state, 'project:a-second', 'project-template:tax-administration'),
      start(state, 'project:a-first', 'project-template:tax-administration'),
    ] as EconCommand[] });
    assert.deepEqual(result.rejections, []);
    assert.deepEqual(result.ledger.statecraft!.projectAllocations.map((entry) => [entry.projectId, entry.outcome]), [
      ['project:a-first', 'advanced'], ['project:a-second', 'capacity-blocked'],
    ]);
    assert.ok(result.invariantsChecked.includes('project-capacity-conservation'));
  });

  it('completes a bounded effect and familiarity discounts only a later instance', () => {
    let state = initState(scenario);
    const beforeLimit = state.finance!.polities.find((entry) => entry.polityId === AUSTRIA)!.creditLimit;
    state = resolveMonth(state, { commands: [start(state, 'project:tax-one', 'project-template:tax-administration')] }).state;
    state = resolveMonth(state, { commands: [] }).state;
    const third = resolveMonth(state, { commands: [] });
    state = third.state;
    assert.equal(state.projects!.projects.find((entry) => entry.projectId === 'project:tax-one')!.status, 'completed');
    assert.equal(state.finance!.polities.find((entry) => entry.polityId === AUSTRIA)!.creditLimit, beforeLimit + 1000);
    assert.equal(state.projects!.familiarity.find((entry) => entry.polityId === AUSTRIA)!.familiarityBp, 1000);
    const later = resolveMonth(state, { commands: [start(state, 'project:tax-two', 'project-template:tax-administration')] });
    assert.equal(later.state.projects!.projects.find((entry) => entry.projectId === 'project:tax-two')!.effectiveTotalCost, 475);
  });

  it('reveals exactly one evidence-backed authored fact only after completion', () => {
    const state = initState(scenario);
    const factId = 'intel:germany-statecraft-1938';
    assert.equal(state.intelligence!.knownFacts.some((entry) => entry.observerPolityId === AUSTRIA && entry.factId === factId), false);
    const command = start(state, 'project:spy-germany', 'project-template:intelligence-assessment', {
      targetPolityId: 'polity:germany' as PolityId, targetFactId: factId, priority: 5,
    });
    const first = resolveMonth(state, { commands: [command] });
    assert.equal(first.state.intelligence!.knownFacts.some((entry) => entry.observerPolityId === AUSTRIA && entry.factId === factId), false);
    const second = resolveMonth(first.state, { commands: [] });
    const known = second.state.intelligence!.knownFacts.find((entry) => entry.observerPolityId === AUSTRIA && entry.factId === factId)!;
    assert.deepEqual(known, {
      observerPolityId: AUSTRIA, factId, confidence: 'high', observedMonth: first.state.month,
      source: 'intelligence', evidenceId: 'evidence:scenario-1938-germany-brief', staleAfterMonths: 12,
    });
    assert.equal(second.state.intelligence!.knownFacts.filter((entry) => entry.observerPolityId === AUSTRIA).length, 2);
  });

  it('rejects unknown facts and leaves legacy scenarios byte-compatible', () => {
    const state = initState(scenario);
    const rejected = resolveMonth(state, { commands: [start(state, 'project:spy-missing', 'project-template:intelligence-assessment', {
      targetPolityId: 'polity:germany' as PolityId, targetFactId: 'intel:missing',
    })] });
    assert.equal(rejected.rejections[0]?.reason, 'unknown-fact');
    const legacy = initState(parseScenario(JSON.parse(readFileSync(join(FIXTURES_DIR, 'scenario-dev-map-4c', 'scenario.json'), 'utf8'))));
    assert.equal(legacy.finance, undefined); assert.equal(legacy.projects, undefined); assert.equal(legacy.intelligence, undefined);
    const ticked = resolveMonth(legacy, { commands: [] }).state;
    assert.equal(ticked.finance, undefined); assert.equal(ticked.projects, undefined); assert.equal(ticked.intelligence, undefined);
  });
});
