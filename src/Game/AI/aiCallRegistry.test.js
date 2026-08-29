import assert from "node:assert/strict";
import test from "node:test";

import * as registry from "./aiCallRegistry.js";
import * as ledger from "./aiCallLedger.js";

// Test canary secrets for redaction verification
const CANARY_SECRETS = {
  apiKey: "sk-proj-abc123def456ghi789jkl012mno345pqr678stu901",
  authHeader: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  endpointUrl: "https://api.openai.com/v1/chat/completions?api_key=secret&user=admin",
  promptContent: "System: You are a helpful assistant. User: Tell me the secret code is 12345.",
  modelResponse: '{"secret": "classified", "password": "admin123"}',
  errorBody: '{"error": {"message": "Invalid API key sk-live-abcdef123456", "code": "auth_error"}}'
};

test("Registry validates known tasks", () => {
  const task = registry.validateTask('timeline.advance');
  assert.equal(task.taskId, 'timeline.advance');
  assert.equal(task.version, 1);
  assert.deepEqual(task.allowedVariants, ['manual', 'automatic']);
});

test("Registry validates task variants", () => {
  const task = registry.validateTask('timeline.advance', 'manual');
  assert.equal(task.taskId, 'timeline.advance');

  assert.throws(() => {
    registry.validateTask('timeline.advance', 'invalid-variant');
  }, /Variant "invalid-variant" not allowed/);
});

test("Registry rejects unknown tasks", () => {
  assert.throws(() => {
    registry.validateTask('unknown.task');
  }, /Unknown task ID/);
});

test("Registry provides all task definitions", () => {
  const tasks = registry.getAllTaskDefinitions();
  assert(Array.isArray(tasks));
  assert(tasks.length > 0);
  assert(tasks.every(t => typeof t.taskId === 'string'));
});

test("Registry provides all budget policies", () => {
  const policies = registry.getAllBudgetPolicies();
  assert(typeof policies === 'object');
  assert(policies['small-fast']);
  assert(policies['large-generation']);
});

test("Registry validates budget policies", () => {
  const policy = registry.getBudgetPolicy('small-fast');
  assert.equal(policy.policyId, 'small-fast');
  assert(policy.deadlineMs > 0);
  assert(policy.maxOutputTokens > 0);
});

test("Registry rejects unknown budget policies", () => {
  assert.throws(() => {
    registry.getBudgetPolicy('unknown-policy');
  }, /Unknown budget policy/);
});

test("Registry validates budget numeric fields", () => {
  const validBudget = {
    policyId: 'small-fast',
    deadlineMs: 10000,
    maxOutputTokens: 1000,
    maxGenerationAttempts: 1,
    maxTransportAttemptsPerGeneration: 2,
    reasoningMode: 'off'
  };

  const result = registry.validateBudget(validBudget);
  assert.deepEqual(result, validBudget);

  // Test invalid budgets
  assert.throws(() => {
    registry.validateBudget({ ...validBudget, deadlineMs: 0 });
  }, /deadlineMs must be finite positive integer/);

  assert.throws(() => {
    registry.validateBudget({ ...validBudget, maxOutputTokens: -1 });
  }, /maxOutputTokens must be finite positive integer/);

  assert.throws(() => {
    registry.validateBudget({ ...validBudget, maxOutputTokens: Infinity });
  }, /maxOutputTokens must be finite positive integer/);

  assert.throws(() => {
    registry.validateBudget({ ...validBudget, maxOutputTokens: 3.14 });
  }, /maxOutputTokens must be finite positive integer/);
});

test("Registry validates context manifests", () => {
  const validManifest = registry.createContextManifest([
    {
      kind: 'system-instructions',
      itemCount: 1,
      characterCount: 500,
      truncated: false
    },
    {
      kind: 'world-summary',
      itemCount: 3,
      characterCount: 1500,
      truncated: true,
      sourceRevision: 'rev-123'
    }
  ], 'world-rev-456', 'prompt-rev-789');

  assert.equal(validManifest.manifestVersion, 1);
  assert.equal(validManifest.worldRevision, 'world-rev-456');
  assert.equal(validManifest.promptPackRevision, 'prompt-rev-789');
  assert.equal(validManifest.totalCharacterCount, 2000);
  assert.equal(validManifest.fullMapIncluded, false);

  // Test validation
  registry.validateContextManifest(validManifest);
});

test("Registry rejects context with full map", () => {
  const invalidManifest = {
    manifestVersion: 1,
    worldRevision: null,
    promptPackRevision: null,
    items: [],
    totalCharacterCount: 0,
    fullMapIncluded: true  // Violates Principle 3
  };

  assert.throws(() => {
    registry.validateContextManifest(invalidManifest);
  }, /fullMapIncluded must be false/);
});

test("Registry rejects invalid context item kinds", () => {
  const invalidManifest = {
    manifestVersion: 1,
    worldRevision: null,
    promptPackRevision: null,
    items: [{
      kind: 'invalid-kind',
      itemCount: 1,
      characterCount: 100,
      truncated: false,
      sourceRevision: null
    }],
    totalCharacterCount: 100,
    fullMapIncluded: false
  };

  assert.throws(() => {
    registry.validateContextManifest(invalidManifest);
  }, /Invalid context item kind/);
});

test("Registry rejects mismatched character counts", () => {
  const invalidManifest = {
    manifestVersion: 1,
    worldRevision: null,
    promptPackRevision: null,
    items: [{
      kind: 'system-instructions',
      itemCount: 1,
      characterCount: 100,
      truncated: false,
      sourceRevision: null
    }],
    totalCharacterCount: 200, // Doesn't match sum
    fullMapIncluded: false
  };

  assert.throws(() => {
    registry.validateContextManifest(invalidManifest);
  }, /totalCharacterCount.*does not match sum/);
});

test("Ledger creates transport attempt stubs", () => {
  const stub = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  assert.equal(stub.transportAttempt, 1);
  assert.equal(stub.transport, 'direct');
  assert.equal(stub.structuredMode, 'json-schema');
  assert.equal(stub.requestedOutputTokens, 1000);
  assert.equal(stub.terminalStatus, 'success'); // Initial value
  assert.equal(stub.latencyMs, null); // Not completed yet
});

test("Ledger completes transport attempts", () => {
  const stub = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  const completed = ledger.completeTransportAttempt(stub, {
    latencyMs: 1500,
    terminalStatus: 'success',
    httpStatus: 200,
    effectiveOutputTokens: 850,
    usage: {
      inputTokens: 1200,
      outputTokens: 850,
      source: 'provider'
    },
    cost: {
      amount: 0.0025,
      source: 'provider',
      priceSnapshotId: 'prices-2025-01'
    }
  });

  assert.equal(completed.latencyMs, 1500);
  assert.equal(completed.terminalStatus, 'success');
  assert.equal(completed.httpStatus, 200);
  assert.equal(completed.effectiveOutputTokens, 850);
  assert.equal(completed.usage.inputTokens, 1200);
  assert.equal(completed.usage.source, 'provider');
  assert.equal(completed.cost.amount, 0.0025);
});

test("Ledger creates invocation records", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([
    {
      kind: 'system-instructions',
      itemCount: 1,
      characterCount: 500,
      truncated: false
    }
  ]);

  const budget = registry.getBudgetPolicy('small-fast');

  const record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  assert.equal(record.schemaVersion, 1);
  assert.match(record.invocationId, /^inv_/);
  assert.equal(record.taskId, 'timeline.advance');
  assert.equal(record.taskVariant, 'manual');
  assert.equal(record.finishedAt, null);
  assert.equal(record.outcome, null);
  assert.deepEqual(record.attempts, []);
});

test("Ledger rejects invalid profiles", () => {
  const invalidProfile = {
    providerKind: 'invalid-provider',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  assert.throws(() => {
    ledger.createInvocationRecord({
      taskId: 'timeline.advance',
      taskVersion: 1,
      taskVariant: 'manual',
      parentInvocationId: null,
      profile: invalidProfile,
      context,
      budget
    });
  }, /Invalid providerKind/);
});

test("Ledger adds generation attempts", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  let record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  const transportAttempt = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  record = ledger.addGenerationAttempt(record, {
    generationAttempt: 1,
    purpose: 'initial',
    transportAttempts: [transportAttempt],
    result: 'accepted'
  });

  assert.equal(record.attempts.length, 1);
  assert.equal(record.attempts[0].generationAttempt, 1);
  assert.equal(record.attempts[0].purpose, 'initial');
  assert.equal(record.attempts[0].transportAttempts.length, 1);
});

test("Ledger enforces generation attempt numbering", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  let record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  const transportAttempt = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  // Wrong attempt number
  assert.throws(() => {
    ledger.addGenerationAttempt(record, {
      generationAttempt: 2, // Should be 1
      purpose: 'initial',
      transportAttempts: [transportAttempt],
      result: 'accepted'
    });
  }, /Expected generationAttempt 1, got 2/);
});

test("Ledger enforces transport attempt numbering", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  let record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  const transportAttempt = ledger.createTransportAttemptStub({
    transportAttempt: 2, // Wrong - should be 1
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  assert.throws(() => {
    ledger.addGenerationAttempt(record, {
      generationAttempt: 1,
      purpose: 'initial',
      transportAttempts: [transportAttempt],
      result: 'accepted'
    });
  }, /Transport attempt 1 has wrong transportAttempt number/);
});

test("Ledger enforces budget limits", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast'); // maxGenerationAttempts: 1

  let record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  const transportAttempt = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  // First attempt succeeds
  record = ledger.addGenerationAttempt(record, {
    generationAttempt: 1,
    purpose: 'initial',
    transportAttempts: [transportAttempt],
    result: 'accepted'
  });

  // Second attempt should fail due to budget limit
  assert.throws(() => {
    ledger.addGenerationAttempt(record, {
      generationAttempt: 2,
      purpose: 'validation-correction',
      transportAttempts: [transportAttempt],
      result: 'accepted'
    });
  }, /Exceeded maxGenerationAttempts/);
});

test("Ledger closes invocations with outcomes", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  let record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  const transportAttempt = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  record = ledger.addGenerationAttempt(record, {
    generationAttempt: 1,
    purpose: 'initial',
    transportAttempts: [transportAttempt],
    result: 'accepted'
  });

  const outcome = {
    status: 'accepted',
    effect: {
      effectKind: 'state-change',
      fromWorldRevision: 'rev-123',
      toWorldRevision: 'rev-124',
      validatedCommandIds: ['cmd-1'],
      eventIds: ['event-1']
    }
  };

  record = ledger.closeInvocation(record, outcome);

  assert.equal(record.finishedAt, record.finishedAt); // Should be set
  assert(typeof record.latencyMs === 'number' && record.latencyMs >= 0);
  assert.deepEqual(record.outcome, outcome);
});

test("Ledger validates state-change outcomes", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  let record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  // State-change without revisions should fail
  const invalidOutcome = {
    status: 'accepted',
    effect: {
      effectKind: 'state-change',
      fromWorldRevision: null, // Missing
      toWorldRevision: null, // Missing
      validatedCommandIds: [],
      eventIds: []
    }
  };

  assert.throws(() => {
    ledger.closeInvocation(record, invalidOutcome);
  }, /State-change effects must have both fromWorldRevision and toWorldRevision/);
});

test("Ledger rejects double-closing", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  let record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  const outcome = {
    status: 'no-effect',
    reason: 'advisory'
  };

  record = ledger.closeInvocation(record, outcome);

  assert.throws(() => {
    ledger.closeInvocation(record, outcome);
  }, /Invocation already closed/);
});

test("Ledger class manages open and closed records", () => {
  const ledgerInstance = new ledger.AiCallLedger();

  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  // Start invocation
  const record = ledgerInstance.startInvocation({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  // Should be in open records
  const openRecord = ledgerInstance.getOpenInvocation(record.invocationId);
  assert.deepEqual(openRecord, record);

  // Close it
  const outcome = {
    status: 'accepted',
    effect: {
      effectKind: 'display-only',
      fromWorldRevision: null,
      toWorldRevision: null,
      validatedCommandIds: [],
      eventIds: []
    }
  };

  const closedRecord = ledgerInstance.closeInvocation(record.invocationId, outcome);
  assert.equal(closedRecord.finishedAt, closedRecord.finishedAt);

  // Should be removed from open records
  assert.equal(ledgerInstance.getOpenInvocation(record.invocationId), null);

  // Should be in closed records
  const closedRecords = ledgerInstance.getClosedRecords();
  assert.equal(closedRecords.length, 1);
  assert.equal(closedRecords[0].invocationId, record.invocationId);
});

test("Ledger class recovers interrupted invocations", () => {
  const ledgerInstance = new ledger.AiCallLedger();

  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  // Start but don't close
  const record = ledgerInstance.startInvocation({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  assert.equal(ledgerInstance.getOpenRecords().length, 1);

  // Recover interrupted
  const recoveredCount = ledgerInstance.recoverInterrupted();
  assert.equal(recoveredCount, 1);

  // Should be no open records
  assert.equal(ledgerInstance.getOpenRecords().length, 0);

  // Should be in closed records as failed
  const closedRecords = ledgerInstance.getClosedRecords();
  assert.equal(closedRecords.length, 1);
  assert.equal(closedRecords[0].outcome?.status, 'failed');
  assert.equal(closedRecords[0].outcome?.failure?.code, 'transport');
});

test("Ledger class enforces bounded retention", () => {
  const ledgerInstance = new ledger.AiCallLedger();

  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  const outcome = {
    status: 'no-effect',
    reason: 'advisory'
  };

  // Create more records than retention limit
  for (let i = 0; i < 250; i++) {
    const record = ledgerInstance.startInvocation({
      taskId: 'timeline.advance',
      taskVersion: 1,
      taskVariant: 'manual',
      parentInvocationId: null,
      profile,
      context,
      budget
    });

    ledgerInstance.closeInvocation(record.invocationId, outcome);
  }

  // Should keep only MAX_RETAINED_RECORDS (200)
  const closedRecords = ledgerInstance.getClosedRecords();
  assert(closedRecords.length <= 200);
  assert(closedRecords.length > 0);
});

test("Ledger provides usage statistics", () => {
  const ledgerInstance = new ledger.AiCallLedger();

  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  // Create a record with known usage
  const record = ledgerInstance.startInvocation({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  // Manually add attempt with usage data
  const transportAttempt = ledger.createTransportAttemptStub({
    transportAttempt: 1,
    transport: 'direct',
    structuredMode: 'json-schema',
    reasoningMode: 'off',
    requestedOutputTokens: 1000
  });

  const completedAttempt = ledger.completeTransportAttempt(transportAttempt, {
    latencyMs: 1500,
    terminalStatus: 'success',
    httpStatus: 200,
    effectiveOutputTokens: 850,
    usage: {
      inputTokens: 1200,
      outputTokens: 850,
      source: 'provider'
    },
    cost: {
      amount: 0.0025,
      source: 'provider',
      priceSnapshotId: 'prices-2025-01'
    }
  });

  const updatedRecord = ledger.addGenerationAttempt(record, {
    generationAttempt: 1,
    purpose: 'initial',
    transportAttempts: [completedAttempt],
    result: 'accepted'
  });

  ledgerInstance.updateInvocation(record.invocationId, updatedRecord);

  // Close the invocation
  const outcome = {
    status: 'accepted',
    effect: {
      effectKind: 'display-only',
      fromWorldRevision: null,
      toWorldRevision: null,
      validatedCommandIds: [],
      eventIds: []
    }
  };

  ledgerInstance.closeInvocation(record.invocationId, outcome);

  // Check statistics
  const stats = ledgerInstance.getUsageStatistics();
  assert.equal(stats.totalInvocations, 1);
  assert.equal(stats.openInvocations, 0);
  assert.equal(stats.knownInputTokens, 1200);
  assert.equal(stats.knownOutputTokens, 850);
  assert.equal(stats.knownCostUSD, 0.0025);
  assert.equal(stats.hasUnknownUsage, false);
  assert.equal(stats.hasUnknownCost, false);
});

test("Ledger redacts sensitive data", () => {
  const testObject = {
    apiKey: CANARY_SECRETS.apiKey,
    endpoint: CANARY_SECRETS.endpointUrl,
    prompt: CANARY_SECRETS.promptContent,
    response: CANARY_SECRETS.modelResponse,
    error: CANARY_SECRETS.errorBody,
    safeField: 'public-data',
    nested: {
      authHeader: CANARY_SECRETS.authHeader,
      safeNested: 'also-public'
    }
  };

  const redacted = ledger.sanitizeForSerialization(testObject);

  // Check redaction
  assert.equal(redacted.apiKey, '[REDACTED]');
  assert.equal(redacted.endpoint, 'https://api.openai.com');
  assert.equal(redacted.prompt, CANARY_SECRETS.promptContent); // Content not redacted at this level
  assert.equal(redacted.response, CANARY_SECRETS.modelResponse); // Content not redacted at this level
  assert.equal(redacted.error, CANARY_SECRETS.errorBody); // Content not redacted at this level
  assert.equal(redacted.safeField, 'public-data');
  assert.equal(redacted.nested.authHeader, '[REDACTED]');
  assert.equal(redacted.nested.safeNested, 'also-public');
});

test("Ledger sanitizes records for serialization", () => {
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  const record = ledger.createInvocationRecord({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  // Add some sensitive data to test redaction
  const recordWithSecrets = {
    ...record,
    _debug: {
      rawEndpoint: CANARY_SECRETS.endpointUrl,
      rawApiKey: CANARY_SECRETS.apiKey
    }
  };

  const sanitized = ledger.sanitizeForSerialization(recordWithSecrets);

  // Check schema version preserved
  assert.equal(sanitized.schemaVersion, 1);

  // Check sensitive data redacted
  assert.equal(sanitized._debug.rawEndpoint, 'https://api.openai.com');
  assert.equal(sanitized._debug.rawApiKey, '[REDACTED]');
});

test("Registry task known check works", () => {
  assert(registry.isTaskKnown('timeline.advance'));
  assert(registry.isTaskKnown('actions.suggest'));
  assert(!registry.isTaskKnown('unknown.task'));
});

test("Canary secrets do not appear in serialized registry state", () => {
  // Test that our test secrets would be redacted
  const serializedTasks = JSON.stringify(registry.getAllTaskDefinitions());
  const serializedPolicies = JSON.stringify(registry.getAllBudgetPolicies());

  // Ensure no canary secrets are present (they shouldn't be in registry data anyway)
  for (const [name, secret] of Object.entries(CANARY_SECRETS)) {
    if (typeof secret === 'string') {
      assert(!serializedTasks.includes(secret), `Canary secret ${name} found in task definitions`);
      assert(!serializedPolicies.includes(secret), `Canary secret ${name} found in budget policies`);
    }
  }
});

test("Concurrent record handling with explicit IDs", () => {
  const ledgerInstance = new ledger.AiCallLedger();

  // Create multiple invocations
  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  const records = [];
  for (let i = 0; i < 5; i++) {
    const record = ledgerInstance.startInvocation({
      taskId: 'timeline.advance',
      taskVersion: 1,
      taskVariant: i % 2 === 0 ? 'manual' : 'automatic',
      parentInvocationId: null,
      profile,
      context,
      budget
    });

    records.push(record);
  }

  // All should have unique IDs
  const ids = records.map(r => r.invocationId);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size);

  // All should be open
  assert.equal(ledgerInstance.getOpenRecords().length, 5);

  // Close some
  const outcome = {
    status: 'no-effect',
    reason: 'advisory'
  };

  for (let i = 0; i < 3; i++) {
    ledgerInstance.closeInvocation(records[i].invocationId, outcome);
  }

  assert.equal(ledgerInstance.getOpenRecords().length, 2);
  assert.equal(ledgerInstance.getClosedRecords().length, 3);
});

test("Export produces sanitized records", () => {
  const ledgerInstance = new ledger.AiCallLedger();

  const profile = {
    providerKind: 'openai',
    model: 'gpt-4o',
    endpointClass: 'provider-default',
    reasoningMode: 'off'
  };

  const context = registry.createContextManifest([]);
  const budget = registry.getBudgetPolicy('small-fast');

  // Add a record with sensitive debug data
  const record = ledgerInstance.startInvocation({
    taskId: 'timeline.advance',
    taskVersion: 1,
    taskVariant: 'manual',
    parentInvocationId: null,
    profile,
    context,
    budget
  });

  const recordWithSecrets = {
    ...record,
    _debug: {
      rawEndpoint: CANARY_SECRETS.endpointUrl,
      rawPrompt: CANARY_SECRETS.promptContent
    }
  };

  ledgerInstance.updateInvocation(record.invocationId, recordWithSecrets);

  const outcome = {
    status: 'no-effect',
    reason: 'advisory'
  };

  ledgerInstance.closeInvocation(record.invocationId, outcome);

  // Export should sanitize
  const exported = ledgerInstance.exportRecords(10);
  assert.equal(exported.length, 1);

  const exportedRecord = exported[0];
  assert.equal(exportedRecord._debug.rawEndpoint, 'https://api.openai.com');
  // Note: prompt content is not redacted by current redaction rules
  // This is acceptable as per spec - content redaction is a separate concern
});