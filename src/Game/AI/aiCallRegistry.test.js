import assert from 'node:assert/strict';
import test from 'node:test';

import * as registry from './aiCallRegistry.js';
import * as ledger from './aiCallLedger.js';

const profile = Object.freeze({
  providerKind: 'openai',
  model: 'gpt-4o',
  endpointClass: 'provider-default',
  reasoningMode: 'off'
});

const context = () => registry.createContextManifest([
  { kind: 'system-instructions', itemCount: 1, characterCount: 12 },
  { kind: 'world-summary', itemCount: 1, characterCount: 24, sourceRevision: 'rev-1' }
], 'rev-1', 'prompts-1');

const invocation = (policyId = 'small-fast') => ledger.createInvocationRecord({
  taskId: 'timeline.advance',
  taskVersion: 1,
  taskVariant: 'manual',
  parentInvocationId: null,
  profile,
  context: context(),
  budget: registry.getBudgetPolicy(policyId)
});

const successfulGeneration = (record, { transports = 1, result = 'accepted' } = {}) => {
  let current = ledger.startGenerationAttempt(record, {
    purpose: record.attempts.length === 0 ? 'initial' : 'validation-correction'
  });
  const generationAttempt = current.attempts.length;
  for (let index = 0; index < transports; index += 1) {
    const started = ledger.startTransportAttempt(current, generationAttempt, {
      transport: 'direct',
      structuredMode: 'json-schema',
      reasoningMode: 'off',
      requestedOutputTokens: current.budget.maxOutputTokens
    });
    current = ledger.finishTransportAttempt(started.record, generationAttempt, started.transportAttempt, {
      latencyMs: 5,
      terminalStatus: 'success',
      httpStatus: 200,
      effectiveOutputTokens: 10,
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 30,
        source: 'provider'
      },
      cost: { amount: 0.01, source: 'provider', priceSnapshotId: null }
    });
  }
  return ledger.finishGenerationAttempt(current, generationAttempt, result);
};

const acceptedEffect = () => ({
  effectKind: 'state-change',
  fromWorldRevision: 'rev-1',
  toWorldRevision: 'rev-2',
  validatedCommandIds: ['cmd-1'],
  eventIds: ['event-1']
});

test('registry exposes every accepted Phase 1 task and immutable definitions', () => {
  const tasks = registry.getAllTaskDefinitions();
  assert.equal(tasks.length, 19);
  assert.equal(registry.validateTask('orders.interpret-economy').outputContractId, 'player-economy-orders-schema');
  assert.equal(registry.validateTask('opponents.plan-economy').fallbackPolicy, 'deterministic');
  assert.equal(registry.validateTask('reports.explain-economy').authority, 'explanation');
  assert.deepEqual(registry.validateTask('timeline.advance', 'manual').allowedVariants, ['manual', 'automatic']);
  assert.throws(() => { registry.validateTask('timeline.advance').taskId = 'mutated'; });
  assert.throws(() => registry.validateTask('timeline.advance', 'other'), /not allowed/);
  assert.throws(() => registry.validateTask('prompt-invented.task'), /Unknown task ID/);
  assert.throws(() => { tasks[0].allowedVariants.push('unsafe'); });
});

test('every task is routed to an explicit utility or strategic model role', () => {
  const tasks = registry.getAllTaskDefinitions();
  assert.ok(tasks.every((task) => ['utility', 'strategic'].includes(task.modelRole)));
  assert.equal(registry.validateTask('opponents.plan-economy').modelRole, 'utility');
  assert.equal(registry.validateTask('reports.explain-economy').modelRole, 'utility');
  assert.equal(registry.validateTask('chat.diplomacy.plan').modelRole, 'strategic');
  assert.equal(registry.validateTask('opponents.plan-diplomacy').modelRole, 'strategic');
  assert.equal(registry.validateTask('timeline.advance', 'manual').modelRole, 'strategic');
});

test('production unknown-task path returns a stable non-dispatchable registry failure', () => {
  assert.throws(() => registry.resolveTaskForDispatch('unknown.task'), /Unknown task ID/);
  assert.deepEqual(registry.resolveTaskForDispatch('unknown.task', null, { production: true }), {
    ok: false,
    safetyRecord: {
      taskId: 'registry.unknown',
      outcome: {
        status: 'failed',
        failure: { code: 'registry', sanitizedSummary: 'Unknown or invalid AI task registration' }
      }
    }
  });
});

test('budgets are finite, complete and cannot override registered policy', () => {
  const budget = registry.getBudgetPolicy('small-fast');
  assert.deepEqual(registry.validateBudget(budget), budget);
  for (const field of ['deadlineMs', 'maxOutputTokens', 'maxGenerationAttempts', 'maxTransportAttemptsPerGeneration']) {
    const missing = { ...budget };
    delete missing[field];
    assert.throws(() => registry.validateBudget(missing), new RegExp(`missing ${field}`));
    assert.throws(() => registry.validateBudget({ ...budget, [field]: 0 }), /finite positive integer/);
  }
  assert.throws(() => registry.validateBudget({ ...budget, deadlineMs: budget.deadlineMs + 1 }), /must match registered policy/);
});

test('context manifests store counts/revisions only and reject a full map', () => {
  const manifest = registry.createContextManifest([
    { kind: 'events', itemCount: 2, characterCount: 50, prompt: 'must disappear' }
  ]);
  assert.deepEqual(Object.keys(manifest.items[0]).sort(), [
    'characterCount', 'itemCount', 'kind', 'sourceRevision', 'truncated'
  ]);
  assert.equal(manifest.fullMapIncluded, false);
  assert.throws(() => registry.validateContextManifest({ ...manifest, fullMapIncluded: true }), /must be false/);
  assert.throws(() => registry.validateContextManifest({ ...manifest, items: 'not-an-array' }), /must be an array/);
  assert.throws(() => registry.validateContextManifest({
    ...manifest,
    items: [{ ...manifest.items[0], itemCount: 0.5 }]
  }), /Invalid itemCount/);
});

test('invocation validates the registered task version and copies allowlisted inputs', () => {
  const record = invocation();
  assert.match(record.invocationId, /^inv_[0-9a-f]{32}$/);
  assert.equal(record.outcome, null);
  assert.deepEqual(record.attempts, []);
  assert.throws(() => ledger.createInvocationRecord({
    ...record,
    taskVersion: 2,
    budget: registry.getBudgetPolicy('small-fast')
  }), /does not match registered version/);
});

test('transport attempt is pending before dispatch and terminal exactly once', () => {
  const stub = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 100
  });
  assert.equal(stub.terminalStatus, null);
  assert.equal(stub.latencyMs, null);
  const completed = ledger.completeTransportAttempt(stub, {
    latencyMs: 9,
    terminalStatus: 'timeout'
  });
  assert.equal(completed.terminalStatus, 'timeout');
  assert.throws(() => ledger.completeTransportAttempt(completed, {
    latencyMs: 10,
    terminalStatus: 'success'
  }), /already completed/);
});

test('staged lifecycle records the stub before completion and enforces both attempt budgets', () => {
  let record = ledger.startGenerationAttempt(invocation(), { purpose: 'initial' });
  const first = ledger.startTransportAttempt(record, 1, {
    transport: 'direct', structuredMode: 'json-schema', reasoningMode: 'off', requestedOutputTokens: 1000
  });
  record = first.record;
  assert.equal(record.attempts[0].transportAttempts[0].terminalStatus, null);
  assert.throws(() => ledger.startTransportAttempt(record, 1, {
    transport: 'direct', structuredMode: 'json-schema', reasoningMode: 'off', requestedOutputTokens: 1000
  }), /still open/);
  record = ledger.finishTransportAttempt(record, 1, 1, { latencyMs: 1, terminalStatus: 'transport-error' });
  const second = ledger.startTransportAttempt(record, 1, {
    transport: 'relay', structuredMode: 'text-json', reasoningMode: 'off', requestedOutputTokens: 1000
  });
  record = ledger.finishTransportAttempt(second.record, 1, 2, { latencyMs: 1, terminalStatus: 'success' });
  assert.throws(() => ledger.startTransportAttempt(record, 1, {
    transport: 'direct', structuredMode: 'none', reasoningMode: 'off', requestedOutputTokens: 1
  }), /Exceeded maxTransportAttemptsPerGeneration/);
  record = ledger.finishGenerationAttempt(record, 1, 'accepted');
  assert.throws(() => ledger.startGenerationAttempt(record, { purpose: 'validation-correction' }), /Exceeded maxGenerationAttempts/);
});

test('two generations with three transports each remain one invocation and six billable attempts', () => {
  let record = invocation('large-generation');
  record = successfulGeneration(record, { transports: 3, result: 'schema-failed' });
  record = successfulGeneration(record, { transports: 3, result: 'accepted' });
  assert.equal(record.attempts.length, 2);
  assert.equal(record.attempts.flatMap((attempt) => attempt.transportAttempts).length, 6);
});

test('generic close cannot claim acceptance and committed effects require a later explicit call', () => {
  const generated = successfulGeneration(invocation());
  assert.throws(() => ledger.closeInvocation(generated, {
    status: 'accepted', effect: acceptedEffect()
  }), /require acceptInvocationEffect/);
  assert.throws(() => ledger.acceptInvocationEffect(generated, {
    ...acceptedEffect(), toWorldRevision: null
  }), /non-empty string/);
  const closed = ledger.acceptInvocationEffect(generated, acceptedEffect());
  assert.equal(closed.outcome.status, 'accepted');
  assert.equal(closed.outcome.effect.toWorldRevision, 'rev-2');
  assert.throws(() => ledger.acceptInvocationEffect(closed, acceptedEffect()), /already closed/);
});

test('validation failure cannot later become an accepted effect', () => {
  const failed = successfulGeneration(invocation(), { result: 'schema-failed' });
  assert.throws(() => ledger.acceptInvocationEffect(failed, acceptedEffect()), /requires an accepted generation result/);
  const closed = ledger.closeInvocation(failed, {
    status: 'failed',
    failure: { code: 'schema', sanitizedSummary: 'raw provider response must not survive' }
  });
  assert.deepEqual(closed.outcome, {
    status: 'failed',
    failure: { code: 'schema', sanitizedSummary: 'AI response failed schema validation' }
  });
});

test('allowlist serialization drops arbitrary prompt, response, endpoint and debug objects', () => {
  const canaries = [
    'sk-secret-key',
    'https://user:pass@example.test/path?token=secret',
    'SYSTEM PROMPT CANARY',
    '{"providerResponse":"CANARY"}'
  ];
  const record = {
    ...successfulGeneration(invocation()),
    prompt: canaries[2],
    response: canaries[3],
    endpoint: canaries[1],
    provider: { apiKey: canaries[0] },
    _debug: canaries
  };
  const serialized = JSON.stringify(ledger.sanitizeForSerialization(record));
  for (const canary of canaries) assert.equal(serialized.includes(canary), false);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    'attempts', 'budget', 'context', 'finishedAt', 'invocationId', 'latencyMs', 'outcome',
    'parentInvocationId', 'profile', 'schemaVersion', 'startedAt', 'taskId', 'taskVariant', 'taskVersion'
  ]);
});

test('aggregate usage and cost preserve partial/unknown distinctions', () => {
  const store = new ledger.AiCallLedger();
  const first = store.startInvocation({
    taskId: 'timeline.advance', taskVersion: 1, taskVariant: 'manual', parentInvocationId: null,
    profile, context: context(), budget: registry.getBudgetPolicy('small-fast')
  });
  store.startGeneration(first.invocationId, { purpose: 'initial' });
  const started = store.startTransport(first.invocationId, 1, {
    transport: 'direct', structuredMode: 'json-schema', reasoningMode: 'off', requestedOutputTokens: 1000
  });
  store.finishTransport(first.invocationId, 1, started.transportAttempt, {
    latencyMs: 2,
    terminalStatus: 'success',
    usage: { inputTokens: 20, outputTokens: null, source: 'provider' }
  });
  store.finishGeneration(first.invocationId, 1, 'accepted');
  store.acceptEffect(first.invocationId, { ...acceptedEffect(), effectKind: 'display-only', fromWorldRevision: null, toWorldRevision: null });
  const stats = store.getUsageStatistics();
  assert.equal(stats.knownInputTokens, 20);
  assert.equal(stats.knownOutputTokens, 0);
  assert.equal(stats.hasUnknownUsage, true);
  assert.equal(stats.knownCostUSD, 0);
  assert.equal(stats.hasUnknownCost, true);
});

test('concurrent invocation IDs remain isolated without global current state', () => {
  const store = new ledger.AiCallLedger();
  const ids = Array.from({ length: 5 }, (_, index) => store.startInvocation({
    taskId: 'timeline.advance', taskVersion: 1, taskVariant: index % 2 ? 'automatic' : 'manual',
    parentInvocationId: null, profile, context: context(), budget: registry.getBudgetPolicy('small-fast')
  }).invocationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids.slice(0, 3)) {
    store.startGeneration(id, { purpose: 'initial' });
    const started = store.startTransport(id, 1, {
      transport: 'direct', structuredMode: 'none', reasoningMode: 'off', requestedOutputTokens: 1
    });
    store.finishTransport(id, 1, started.transportAttempt, { latencyMs: 1, terminalStatus: 'cancelled' });
    store.finishGeneration(id, 1, 'request-failed');
    store.closeInvocation(id, { status: 'cancelled', by: 'superseded' });
  }
  assert.equal(store.getOpenRecords().length, 2);
  assert.equal(store.getClosedRecords().length, 3);
});

test('interrupted records recover deterministically with terminal transport failure', () => {
  const store = new ledger.AiCallLedger();
  const record = store.startInvocation({
    taskId: 'timeline.advance', taskVersion: 1, taskVariant: 'manual', parentInvocationId: null,
    profile, context: context(), budget: registry.getBudgetPolicy('small-fast')
  });
  store.startGeneration(record.invocationId, { purpose: 'initial' });
  store.startTransport(record.invocationId, 1, {
    transport: 'direct', structuredMode: 'json-schema', reasoningMode: 'off', requestedOutputTokens: 1000
  });
  assert.equal(store.recoverInterrupted(), 1);
  const recovered = store.getClosedRecords()[0];
  assert.equal(recovered.attempts[0].transportAttempts[0].terminalStatus, 'transport-error');
  assert.equal(recovered.attempts[0].result, 'request-failed');
  assert.equal(recovered.outcome.status, 'failed');
  assert.equal(recovered.outcome.failure.code, 'transport');
});

test('recovery also terminalizes a generation interrupted before dispatch', () => {
  const store = new ledger.AiCallLedger();
  const record = store.startInvocation({
    taskId: 'timeline.advance', taskVersion: 1, taskVariant: 'manual', parentInvocationId: null,
    profile, context: context(), budget: registry.getBudgetPolicy('small-fast')
  });
  store.startGeneration(record.invocationId, { purpose: 'initial' });
  store.recoverInterrupted();
  const recovered = store.getClosedRecords()[0];
  assert.equal(recovered.attempts[0].transportAttempts.length, 1);
  assert.equal(recovered.attempts[0].transportAttempts[0].terminalStatus, 'transport-error');
});

test('retention keeps the latest 200 closed records and never evicts open records', () => {
  const store = new ledger.AiCallLedger();
  const open = store.startInvocation({
    taskId: 'timeline.advance', taskVersion: 1, taskVariant: 'manual', parentInvocationId: null,
    profile, context: context(), budget: registry.getBudgetPolicy('small-fast')
  });
  const closedIds = [];
  for (let index = 0; index < 205; index += 1) {
    const record = store.startInvocation({
      taskId: 'timeline.advance', taskVersion: 1, taskVariant: 'manual', parentInvocationId: null,
      profile, context: context(), budget: registry.getBudgetPolicy('small-fast')
    });
    closedIds.push(record.invocationId);
    store.startGeneration(record.invocationId, { purpose: 'initial' });
    const started = store.startTransport(record.invocationId, 1, {
      transport: 'direct', structuredMode: 'none', reasoningMode: 'off', requestedOutputTokens: 1
    });
    store.finishTransport(record.invocationId, 1, started.transportAttempt, { latencyMs: 0, terminalStatus: 'cancelled' });
    store.finishGeneration(record.invocationId, 1, 'request-failed');
    store.closeInvocation(record.invocationId, { status: 'cancelled', by: 'user' });
  }
  assert.equal(store.getClosedRecords().length, 200);
  assert.equal(store.getClosedRecords().at(-1).invocationId, closedIds[5]);
  assert.equal(store.getOpenInvocation(open.invocationId).invocationId, open.invocationId);
});
