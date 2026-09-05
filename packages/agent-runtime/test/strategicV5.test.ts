import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STRATEGIC_V5_INPUT_TOKEN_LIMIT,
  assertStrategicRunV5Compatible,
  commitStrategicMemoryV5,
  renderSemanticResolverPromptV1,
  renderStrategicPromptV5,
  resolveSemanticChangeV1,
  resolveStrategicDecisionV5,
  strategicBriefV5Schema,
  strategicDecisionV4Schema,
  strategicRunManifestV5Schema,
  type StrategicBriefV5,
} from '../src/strategicV5.js';

const REVISION = `sha256:${'a'.repeat(64)}`;
const EVIDENCE_REVISION = `sha256:${'b'.repeat(64)}`;

function brief(): StrategicBriefV5 {
  return strategicBriefV5Schema.parse({
    schemaVersion: 'open-historia-strategic-brief/5',
    decisionSchemaVersion: 'open-historia-strategic-decision/4',
    promptContract: 'StrategicBriefV5+StrategicDecisionV4',
    actor: { id: 'polity:alpha', name: 'Alpha' },
    month: '1500-01-01',
    revision: REVISION,
    checkpoint: {
      checkpointId: 'checkpoint:quarterly',
      reason: 'scheduled-quarter',
      required: true,
      summary: 'Choose the next grounded course.',
      triggerIds: ['trigger:knowledge'],
    },
    goals: [{ goalId: 'goal:prosperity', summary: 'Strengthen practical knowledge.', factsUsed: ['evidence:workshops'] }],
    redLines: ['Do not exhaust the treasury.'],
    materialSituation: [
      { situationId: 'situation:workshops', domain: 'knowledge', summary: 'Metalworking workshops can sustain bounded experiments.',
        severity: 'material', factsUsed: ['evidence:workshops'] },
    ],
    claims: [{ claimId: 'claim:old-conquest', source: 'untrusted-prose', statement: 'We conquered Beta years ago.',
      status: 'contradicted', evidenceIds: ['evidence:control'] }],
    evidence: [
      { evidenceId: 'evidence:workshops', sourceRevision: EVIDENCE_REVISION, validAtRevision: REVISION,
        visibility: 'actor-private', ownerPolityId: 'polity:alpha', summary: 'Workshops and artisans are available.',
        canonicalPointers: ['/regions/0/activities'] },
      { evidenceId: 'evidence:control', sourceRevision: EVIDENCE_REVISION, validAtRevision: REVISION,
        visibility: 'public', ownerPolityId: null, summary: 'Beta remains controlled by Beta.',
        canonicalPointers: ['/regions/1/control'] },
      { evidenceId: 'evidence:process', sourceRevision: EVIDENCE_REVISION, validAtRevision: REVISION,
        visibility: 'actor-private', ownerPolityId: 'polity:alpha', summary: 'The current experiment is feasible only at slow or steady pace.',
        canonicalPointers: ['/processes/0'] },
    ],
    frozenChoices: [{ choiceId: 'choice:invest', family: 'economy:invest', summary: 'Fund the existing workshop program.',
      materializationRef: 'materialization:invest', triggerIds: ['trigger:knowledge'], factsUsed: ['evidence:workshops'],
      preview: { feasibility: 'feasible', consequence: 'Capacity may improve at a bounded engine-computed cost.', factsUsed: ['evidence:workshops'] } }],
    processOptions: [{ processId: 'process:experiment', checkpointId: 'process-checkpoint:experiment',
      objective: 'Investigate repeatable electrical effects.', stage: 'emerging',
      allowedDirections: [{ directionId: 'direction:practical-demonstration', summary: 'Seek a reproducible workshop demonstration.' }],
      allowedPaces: ['slow', 'steady'], compatibleEffectFamilies: ['knowledge.reveal', 'capacity.modify'],
      allowedTargetEntityRefs: ['polity:alpha', 'region:capital'], blockers: [], accelerators: ['evidence:workshops'],
      opportunityCosts: ['Workshop time and patronage.'], factsUsed: ['evidence:process'] }],
    initiativeEnvelope: {
      allowedConceptTypes: ['technology', 'scientific-theory', 'institution'],
      allowedDomains: ['domain:knowledge', 'domain:production'],
      allowedDirectionIds: ['direction:investigate', 'direction:organize'],
      allowedSponsorEntityRefs: ['polity:alpha'],
      allowedTargetEntityRefs: ['polity:alpha', 'region:capital'],
      allowedEffectFamilies: ['knowledge.reveal', 'capacity.modify', 'institution.create'],
    },
    candidateAudit: [{ family: 'economy:invest', disposition: 'published', reason: 'A legal frozen choice exists.' },
      { family: 'initiative:open', disposition: 'published', reason: 'Grounded initiative proposals are allowed.' }],
    durablePlan: null,
    changesSinceLastDecision: ['Workshop evidence was registered.'],
  });
}

const durablePlan = {
  objective: 'Build practical knowledge without claiming completed discoveries.',
  goals: [{ summary: 'Seek a repeatable demonstration.', factsUsed: ['evidence:workshops'] }],
  commitments: [],
  revisit: 'At the next process checkpoint.',
};

test('Strategic V5 accepts a novel grounded initiative without a pre-authored choice ID', () => {
  const input = brief();
  const decision = {
    polityId: 'polity:alpha', revision: REVISION, selectedChoiceIds: [], processDecisions: [],
    initiativeProposals: [{ type: 'technology', displayName: { en: 'Electrical workshop experiments' },
      description: { en: 'Investigate repeatable static and conductive effects with available craft practices.' },
      objective: 'Establish whether repeatable practical effects can be demonstrated.', directionId: 'direction:investigate',
      domainIds: ['domain:knowledge'], sponsorEntityRefs: ['polity:alpha'], affectedEntityRefs: ['region:capital'],
      pace: 'slow', effectFamilies: ['knowledge.reveal'], causalTheory: 'Existing metalworking and observation may support bounded experiments.',
      factsUsed: ['evidence:workshops'] }],
    durablePlan, evidenceIds: ['evidence:workshops'], hold: null,
  };
  const result = resolveStrategicDecisionV5(input, {
    status: 'succeeded', metadata: { provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:1' },
    response: decision,
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.selectedMaterializationRefs.length, 0);
  assert.equal(result.semanticPackage.initiativeProposals.length, 1);
  assert.match(result.semanticPackageChecksum, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.initiativeProposalKeys[0] ?? '', /^proposal-key:[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(result).includes('progressBp'), false);
});

test('Strategic V5 rejects invented entities/evidence and emits no authority after drift', () => {
  const input = brief();
  const base = {
    polityId: 'polity:alpha', revision: REVISION, selectedChoiceIds: [], processDecisions: [],
    initiativeProposals: [{ type: 'technology', displayName: { en: 'Experiment' }, description: { en: 'A bounded experiment.' },
      objective: 'Test a phenomenon.', directionId: 'direction:investigate', domainIds: ['domain:knowledge'],
      sponsorEntityRefs: ['polity:alpha'], affectedEntityRefs: ['region:capital'], pace: 'slow',
      effectFamilies: ['knowledge.reveal'], causalTheory: 'The registered workshop base supports inquiry.', factsUsed: ['evidence:workshops'] }],
    durablePlan, evidenceIds: ['evidence:workshops'], hold: null,
  };
  const attempt = (response: unknown) => resolveStrategicDecisionV5(input, {
    status: 'succeeded', metadata: { provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:2' }, response,
  });
  assert.equal(attempt({ ...base, initiativeProposals: [{ ...base.initiativeProposals[0], affectedEntityRefs: ['region:invented'] }] }).status, 'rejected');
  assert.equal(attempt({ ...base, evidenceIds: ['evidence:invented'] }).status, 'pending');
  const stale = attempt({ ...base, revision: `sha256:${'c'.repeat(64)}` });
  assert.equal(stale.status, 'pending');
  assert.deepEqual(stale.selectedMaterializationRefs, []);
  assert.equal('semanticPackage' in stale, false);
  const missingTopLevelEvidence = strategicDecisionV4Schema.safeParse({ ...base, evidenceIds: ['evidence:process'] });
  assert.equal(missingTopLevelEvidence.success, false);
});

test('Strategic V5 process choices are qualitative, frozen and deterministic', () => {
  const input = brief();
  const decision = {
    polityId: 'polity:alpha', revision: REVISION, selectedChoiceIds: ['choice:invest'],
    processDecisions: [{ processId: 'process:experiment', checkpointId: 'process-checkpoint:experiment',
      directionId: 'direction:practical-demonstration', pace: 'steady', effectFamilies: ['knowledge.reveal'],
      targetEntityRefs: ['region:capital'], rationale: 'The current material base supports a steady demonstration effort.',
      factsUsed: ['evidence:process'] }],
    initiativeProposals: [], durablePlan, evidenceIds: ['evidence:workshops', 'evidence:process'], hold: null,
  };
  const run = () => resolveStrategicDecisionV5(input, {
    status: 'succeeded', metadata: { provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:3' },
    response: structuredClone(decision),
  });
  const canonical = run();
  assert.deepEqual(canonical, run());
  assert.equal(canonical.status, 'accepted');
  const permuted = resolveStrategicDecisionV5(input, {
    status: 'succeeded', metadata: { provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:3' },
    response: { ...decision, evidenceIds: [...decision.evidenceIds].reverse(),
      processDecisions: [{ ...decision.processDecisions[0], targetEntityRefs: [...decision.processDecisions[0].targetEntityRefs].reverse() }] },
  });
  assert.equal(permuted.status, 'accepted');
  if (permuted.status !== 'accepted' || canonical.status !== 'accepted') assert.fail('expected accepted V5 decisions');
  assert.equal(permuted.semanticPackageChecksum, canonical.semanticPackageChecksum);
  assert.equal(strategicDecisionV4Schema.safeParse({ ...decision, processDecisions: [{ ...decision.processDecisions[0], progressBp: 500 }] }).success, false);
  assert.equal(resolveStrategicDecisionV5(input, { status: 'succeeded', metadata: {
    provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:4' },
  response: { ...decision, processDecisions: [{ ...decision.processDecisions[0], pace: 'breakthrough' }] } }).status, 'rejected');
});

test('required provider/schema failure remains visibly pending and never commits strategy memory', () => {
  const input = brief();
  const failed = resolveStrategicDecisionV5(input, {
    status: 'failed', metadata: { provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:5' },
    failure: { kind: 'provider', message: 'Unavailable.' },
  });
  assert.equal(failed.status, 'pending');
  assert.deepEqual(failed.availableActions, ['retry', 'continue-paused']);
  assert.deepEqual(failed.selectedMaterializationRefs, []);
  const memory = { polityId: 'polity:alpha', durablePlan: null, evidenceIds: [] as string[], lastAcceptedRevision: null };
  assert.deepEqual(commitStrategicMemoryV5(memory, failed), memory);
  assert.notEqual(commitStrategicMemoryV5(memory, failed), memory);
  const malformed = resolveStrategicDecisionV5(input, {
    status: 'succeeded', metadata: { provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:6' }, response: {},
  });
  assert.equal(malformed.status, 'pending');
  assert.equal(malformed.reasonCode, 'schema-failure');
});

test('semantic resolver accepts only frozen meanings, evidence and qualitative effects', () => {
  const input = brief();
  const resolverBrief = {
    schemaVersion: 'open-historia-semantic-brief/1' as const, responseSchemaVersion: 'open-historia-semantic-resolution/1' as const,
    actor: input.actor, month: input.month, revision: input.revision, checkpointId: 'semantic-checkpoint:electrical',
    required: true, proposalKey: 'proposal-key:electrical', stage: 'proposed' as const,
    proposal: { type: 'technology' as const, displayName: { en: 'Electrical workshop experiments' },
      description: { en: 'Investigate repeatable effects.' }, objective: 'Seek reproducible effects.', causalTheory: 'Craft evidence supports inquiry.' },
    allowedDomainIds: ['domain:knowledge'], allowedEffectFamilies: ['knowledge.reveal', 'capacity.modify'] as const,
    allowedTargetEntityRefs: ['polity:alpha', 'region:capital'], evidence: input.evidence.slice(0, 1),
  };
  const response = { polityId: 'polity:alpha', revision: REVISION, checkpointId: 'semantic-checkpoint:electrical',
    proposalKey: 'proposal-key:electrical', meaning: 'A workshop discipline for controlled observation of electrical effects.',
    causalTheory: 'Repeated observation can establish knowledge before any practical capacity claim.', domainIds: ['domain:knowledge'],
    effectFamilies: ['knowledge.reveal'], targetEntityRefs: ['region:capital'], factsUsed: ['evidence:workshops'] };
  const first = resolveSemanticChangeV1(resolverBrief, { status: 'succeeded', metadata: {
    provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:7' }, response });
  const second = resolveSemanticChangeV1(resolverBrief, { status: 'succeeded', metadata: {
    provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:7' }, response: structuredClone(response) });
  assert.deepEqual(first, second);
  assert.equal(first.status, 'accepted');
  const invented = resolveSemanticChangeV1(resolverBrief, { status: 'succeeded', metadata: {
    provider: 'test-provider', model: 'test-model', effort: 'medium', requestId: 'request:8' },
    response: { ...response, effectFamilies: ['resource.spawn'] } });
  assert.equal(invented.status, 'pending');
  assert.equal('resolution' in invented, false);
});

test('prompts quote untrusted claims, carry no full map, and enforce bounded context', () => {
  const input = brief();
  const prompt = renderStrategicPromptV5(input, 'Follow the contract.');
  assert.match(prompt, /UNTRUSTED_CLAIMS/);
  assert.match(prompt, /untrusted-prose/);
  assert.match(prompt, /never historical truth/i);
  assert.equal(prompt.includes('geometry'), false);
  assert.equal(prompt.includes('coordinates'), false);
  assert.ok(Buffer.byteLength(prompt, 'utf8') < STRATEGIC_V5_INPUT_TOKEN_LIMIT);
  const semanticPrompt = renderSemanticResolverPromptV1({
    schemaVersion: 'open-historia-semantic-brief/1', responseSchemaVersion: 'open-historia-semantic-resolution/1',
    actor: input.actor, month: input.month, revision: input.revision, checkpointId: 'semantic-checkpoint:test', required: true,
    proposalKey: 'proposal-key:test', stage: 'proposed', proposal: { type: 'technology', displayName: { en: 'Test' },
      description: { en: 'Test description.' }, objective: 'Test objective.', causalTheory: 'Test theory.' },
    allowedDomainIds: ['domain:knowledge'], allowedEffectFamilies: ['knowledge.reveal'],
    allowedTargetEntityRefs: ['polity:alpha'], evidence: input.evidence.slice(0, 1),
  });
  assert.match(semanticPrompt, /engine owns every number/i);
});

test('era-neutral V5 context cannot synthesize industrial or foreign supplier defaults', () => {
  const input = brief();
  const meso = strategicBriefV5Schema.parse({ ...input, actor: { id: 'polity:tenochtitlan', name: 'Tenochtitlan' },
    evidence: input.evidence.map((row) => row.visibility === 'actor-private' ? { ...row, ownerPolityId: 'polity:tenochtitlan' } : row),
    initiativeEnvelope: { ...input.initiativeEnvelope, allowedSponsorEntityRefs: ['polity:tenochtitlan'],
      allowedTargetEntityRefs: ['polity:tenochtitlan', 'region:capital'] },
  });
  const serialized = renderStrategicPromptV5(meso);
  for (const leak of ['polity:soviet-union', 'polity:united-states', 'external supplier', 'industrial-era default']) {
    assert.equal(serialized.toLowerCase().includes(leak), false);
  }
});

test('V5 run metadata is strict and frozen; older planner runs cannot resume', () => {
  const manifest = strategicRunManifestV5Schema.parse({ schemaVersion: 'open-historia-strategic-run/4',
    scenarioId: 'scenario:test', scenarioContentVersion: '1.0.0', promptContract: 'StrategicBriefV5+StrategicDecisionV4',
    provider: 'codex-subscription', model: 'gpt-test', effort: 'medium', preflightChecksum: `sha256:${'d'.repeat(64)}` });
  assert.deepEqual(assertStrategicRunV5Compatible(manifest, manifest), manifest);
  assert.throws(() => assertStrategicRunV5Compatible({ ...manifest, schemaVersion: 'open-historia-strategic-run/3' }, manifest), /cannot resume/);
  assert.throws(() => assertStrategicRunV5Compatible({ ...manifest, model: 'changed-model' }, manifest), /frozen model changed/);
});
