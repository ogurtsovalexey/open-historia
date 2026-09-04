import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';

let temp;
const script = path.resolve('scripts/strategic-gate0.mjs');
const run = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], {
  cwd: path.resolve('.'), encoding: 'utf8',
  env: { ...process.env, CAMPAIGN_LAB_RUNS_DIR: temp, OPENAI_API_KEY: '', GEMINI_API_KEY: '' },
}));

before(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-gate0-')); });
after(() => { fs.rmSync(temp, { recursive: true, force: true }); });

test('production Gate 0 mock freezes bounded single-actor V4 packages without model calls', () => {
  const result = run('run', '--mode', 'mock', '--run', 'gate0-mock');
  assert.equal(result.status, 'mock-pass');
  assert.equal(result.completedModelTurns, 0);
  assert.equal(result.baseCompletedModelTurnCap, 40);
  assert.equal(result.ownerApprovedExtraTurns, 0);
  assert.equal(result.maxCompletedModelTurns, 40);
  assert.equal(result.probes.length, 13);
  assert.equal(new Set(result.probes.map((entry) => entry.probeId)).size, 13);

  for (const [index, probe] of result.probes.entries()) {
    const directory = path.join(temp, 'gate0-mock', `${String(index + 1).padStart(2, '0')}-${probe.probeId}`);
    const brief = JSON.parse(fs.readFileSync(path.join(directory, 'brief.json'), 'utf8'));
    const schema = JSON.parse(fs.readFileSync(path.join(directory, 'output-schema.json'), 'utf8'));
    const validation = JSON.parse(fs.readFileSync(path.join(directory, 'validation.json'), 'utf8'));
    const prompt = fs.readFileSync(path.join(directory, 'prompt.txt'), 'utf8');
    assert.equal(brief.schemaVersion, 'open-historia-strategic-brief/4');
    assert.equal(brief.promptContract, 'StrategicBriefV4+StrategicDecisionV3');
    assert.equal(brief.actor.id, probe.polityId);
    assert.deepEqual(schema.properties.polityId.enum, [probe.polityId]);
    assert.deepEqual(schema.properties.revision.enum, [brief.revision]);
    assert.equal(schema.properties.rejectedChoices.minItems, brief.choices.length > 1 ? 1 : 0);
    assert.ok(brief.inputTokenCount <= 8000);
    assert.match(prompt, /\[CANDIDATE_AUDIT\]/);
    assert.match(prompt, /\[FROZEN_CHOICES\]/);
    assert.equal(validation.resolution.status, 'accepted');
    assert.equal(validation.stateMutated, false);
  }

  const czechBrief = JSON.parse(fs.readFileSync(path.join(temp, 'gate0-mock', '09-czech-accept', 'brief.json'), 'utf8'));
  const czechAccept = czechBrief.choices.find((entry) => entry.family === 'respond-proposal' && entry.action.response === 'accept');
  assert.deepEqual(czechAccept.context.terms, {
    kind: 'territorial-settlement',
    fromPolity: { id: 'polity:czechoslovakia', name: 'Czechoslovakia' },
    toPolity: { id: 'polity:germany', name: 'Germany' },
    regions: [{ id: 'region:europe-1935:cs-sudety', name: 'Sudety' }],
  });
  assert.ok(czechAccept.preview.deltas.some((entry) => entry.path === 'regions.region:europe-1935:cs-sudety.controllerId'
    && entry.before === 'polity:czechoslovakia' && entry.after === 'polity:germany'));

  const strategicCzech = JSON.parse(fs.readFileSync(path.join(temp, 'gate0-mock', '11-czech-strategic', 'brief.json'), 'utf8'));
  assert.equal(strategicCzech.invocation.detail, 'Choose freely whether to accept or reject the bounded Sudeten settlement.');

  const polandThreat = JSON.parse(fs.readFileSync(path.join(temp, 'gate0-mock', '12-poland-real-threat', 'validation.json'), 'utf8'));
  assert.ok(polandThreat.selectedFamilies.some((family) => ['mobilize', 'issue-order', 'negotiate-peace'].includes(family)));
  const mobilizationDirectory = path.join(temp, 'gate0-mock', '13-poland-mobilization');
  const mobilizationBrief = JSON.parse(fs.readFileSync(path.join(mobilizationDirectory, 'brief.json'), 'utf8'));
  const mobilizationChoices = mobilizationBrief.choices.filter((entry) => entry.family === 'mobilize');
  assert.ok(mobilizationChoices.length >= 3 && mobilizationChoices.length <= 8);
  assert.ok(mobilizationChoices.every((entry) => entry.action.deployments.length >= 1 && entry.action.deployments.length <= 3));
  assert.ok(mobilizationChoices.some((entry) => entry.action.deployments.length > 1));
  assert.ok(mobilizationChoices.some((entry) => entry.action.deployments[0].locationRegionId === 'region:ohm-1935:2741476'),
    'the supplied Poznań front must outrank lexicographic Wilno');
  assert.ok(mobilizationChoices.every((entry) => entry.context.kind === 'mobilization-plan'
    && entry.context.equipmentCoverageBp >= 5000));
  assert.deepEqual(mobilizationChoices.map((entry) => entry.preview.deltas.find((delta) => delta.path === 'military.mobilizationPlan').after)
    .map((entry) => ({ manpower: entry.totalManpower, equipment: entry.totalEquipment, coverage: entry.equipmentCoverageBp }))
    .sort((left, right) => left.manpower - right.manpower), [
    { manpower: 308000, equipment: 308000, coverage: 10000 },
    { manpower: 560000, equipment: 420000, coverage: 7500 },
    { manpower: 840000, equipment: 420000, coverage: 5000 },
  ]);
  assert.ok(mobilizationBrief.publicData.fronts.some((entry) => entry.ownRegion.id === 'region:ohm-1935:2741476'
    && entry.hostileRegion.id === 'region:europe-1935:de-pommern'
    && entry.ownForceBand === 'substantial' && entry.hostileForceBand === 'substantial'));
  const mobilization = JSON.parse(fs.readFileSync(path.join(mobilizationDirectory, 'validation.json'), 'utf8'));
  assert.deepEqual(mobilization.selectedFamilies, ['mobilize']);
  assert.ok(mobilization.resolution.commands.length > 1, 'one bounded plan may create several formations atomically');
});

test('production Gate 0 rejects old manifests and prompt snapshots are reproducible', () => {
  const first = run('run', '--mode', 'mock', '--run', 'gate0-repeat-a');
  const second = run('run', '--mode', 'mock', '--run', 'gate0-repeat-b');
  assert.equal(first.packageChecksum, second.packageChecksum);
  fs.mkdirSync(path.join(temp, 'legacy-v2'));
  fs.writeFileSync(path.join(temp, 'legacy-v2', 'manifest.json'), JSON.stringify({
    schemaVersion: 'open-historia-campaign-lab-run/2', promptContract: 'StrategicDecisionV2',
  }));
  assert.throws(() => run('resume', '--run', 'legacy-v2'), /incompatible strategic run/);
});

test('production Gate 0 can run an explicit unique probe subset without reordering it', () => {
  const result = run('run', '--mode', 'mock', '--run', 'gate0-subset', '--only', 'czech-reject,poland-mobilization');
  assert.deepEqual(result.probes.map((entry) => entry.probeId), ['czech-reject', 'poland-mobilization']);
  assert.throws(() => run('run', '--mode', 'mock', '--run', 'gate0-bad-subset', '--only', 'unknown'), /unknown Gate 0 probe/);
});

test('committed Gate 0 evidence is redacted and cannot claim owner acceptance while criteria remain unmet', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve('docs/reports/europe-1935-strategic-gate0.json'), 'utf8'));
  assert.equal(report.schemaVersion, 'open-historia-strategic-gate0-aggregate/1');
  assert.equal(report.budget.completedTurns, report.budget.maximumTurns);
  assert.equal(report.budget.remainingTurns, 0);
  assert.equal(report.canonicalAutomatedCoverage.probeCount, 12);
  assert.equal(report.canonicalAutomatedCoverage.structuredOutputRate, 1);
  assert.equal(report.canonicalAutomatedCoverage.actorAndTriggerCoverageRate, 1);
  assert.equal(report.canonicalAutomatedCoverage.legalMaterializationRate, 1);
  assert.ok(report.canonicalAutomatedCoverage.maximumApplicationInputTokens <= report.canonicalAutomatedCoverage.applicationInputTokenLimit);
  assert.equal(report.canonicalAutomatedCoverage.evaluatorMutationCount, 0);
  assert.equal(report.canonicalAutomatedCoverage.inventedReferenceCount, 0);
  assert.equal(report.redaction.rawPromptsIncluded, false);
  assert.equal(report.redaction.rawResponsesIncluded, false);
  assert.equal(report.redaction.threadIdsIncluded, false);
  assert.equal(report.ownerAssessment.status, 'pending');
  assert.equal(report.status, 'blocked');
  assert.equal(report.postBudgetDeterministicCorrections.status, 'terra-live-revalidated');
  assert.equal(report.postBudgetDeterministicCorrections.modelTurns, 0);
  assert.equal(report.postBudgetDeterministicCorrections.mockProbeCount, 13);
  assert.ok(report.postBudgetDeterministicCorrections.maximumApplicationInputTokens <= 8000);
  assert.equal(report.terraPostFixValidation.model, 'gpt-5.6-terra');
  assert.equal(report.terraPostFixValidation.effort, 'medium');
  assert.equal(report.terraPostFixValidation.schemaPreflightTurns + report.terraPostFixValidation.decisionTurns, 4);
  assert.equal(report.terraPostFixValidation.structuredOutputRate, 1);
  assert.equal(report.terraPostFixValidation.legalMaterializationRate, 1);
  assert.equal(report.terraPostFixValidation.evaluatorMutationCount, 0);
  assert.ok(report.unmetAcceptanceCriteria.length > 0);
});
