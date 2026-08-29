import { validateBudget, validateContextManifest, validateTask } from './aiCallRegistry.js';

const SCHEMA_VERSION = 1;
const MAX_RETAINED_RECORDS = 200;
const TRANSPORTS = new Set(['direct', 'relay']);
const STRUCTURED_MODES = new Set(['none', 'tool', 'json-schema', 'json-object', 'text-json']);
const REASONING_MODES = new Set(['off', 'fast', 'standard']);
const TERMINAL_STATUSES = new Set(['success', 'provider-error', 'transport-error', 'timeout', 'cancelled']);
const GENERATION_RESULTS = new Set(['accepted', 'parse-failed', 'schema-failed', 'semantic-failed', 'request-failed']);
const GENERATION_PURPOSES = new Set(['initial', 'validation-correction']);
const EFFECT_KINDS = new Set(['state-change', 'chat-message', 'display-only', 'memory-update']);
const FAILURE_SUMMARIES = Object.freeze({
  provider: 'Provider request failed',
  timeout: 'AI request timed out',
  transport: 'AI transport failed',
  parse: 'AI response could not be parsed',
  schema: 'AI response failed schema validation',
  'semantic-validation': 'AI response failed world validation',
  budget: 'AI call budget exhausted',
  registry: 'AI task registration failed'
});

const assertOpen = (record) => {
  if (!record || record.finishedAt !== null || record.outcome !== null) throw new Error('Invocation already closed');
};

const finiteNonNegative = (value, field, { nullable = false } = {}) => {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number${nullable ? ' or null' : ''}`);
  }
  return value;
};

const finitePositiveInteger = (value, field) => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a finite positive integer`);
  return value;
};

const nullableString = (value, field) => {
  if (value !== null && typeof value !== 'string') throw new Error(`${field} must be a string or null`);
  return value;
};

const nonEmptyString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
};

const generateInvocationId = () => 'inv_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const cloneProfile = (profile) => {
  const providerKinds = new Set(['gemini', 'openai', 'anthropic', 'openai-compatible', 'anthropic-compatible']);
  const endpointClasses = new Set(['provider-default', 'loopback', 'lan', 'remote-custom']);
  if (!profile || !providerKinds.has(profile.providerKind)) throw new Error(`Invalid providerKind: ${profile?.providerKind}`);
  if (!endpointClasses.has(profile.endpointClass)) throw new Error(`Invalid endpointClass: ${profile.endpointClass}`);
  if (!REASONING_MODES.has(profile.reasoningMode)) throw new Error(`Invalid reasoningMode: ${profile.reasoningMode}`);
  nonEmptyString(profile.model, 'Model');
  return {
    providerKind: profile.providerKind,
    model: profile.model,
    endpointClass: profile.endpointClass,
    reasoningMode: profile.reasoningMode
  };
};

const cloneContext = (context) => {
  validateContextManifest(context);
  return {
    manifestVersion: 1,
    worldRevision: context.worldRevision,
    promptPackRevision: context.promptPackRevision,
    items: context.items.map((item) => ({
      kind: item.kind,
      itemCount: item.itemCount,
      characterCount: item.characterCount,
      truncated: item.truncated,
      sourceRevision: item.sourceRevision
    })),
    totalCharacterCount: context.totalCharacterCount,
    fullMapIncluded: false
  };
};

const cloneUsage = (usage = {}) => {
  const source = usage.source ?? 'unavailable';
  if (!new Set(['provider', 'estimated', 'unavailable']).has(source)) throw new Error('Invalid usage source');
  const result = {};
  for (const field of ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedInputTokens', 'totalTokens']) {
    result[field] = finiteNonNegative(usage[field] ?? null, `usage.${field}`, { nullable: true });
  }
  result.source = source;
  if (source === 'unavailable' && Object.values(result).some((value) => typeof value === 'number')) {
    throw new Error('Unavailable usage cannot contain token counts');
  }
  return result;
};

const cloneCost = (cost = {}) => {
  const source = cost.source ?? 'unavailable';
  if (!new Set(['provider', 'price-snapshot', 'unavailable']).has(source)) throw new Error('Invalid cost source');
  const amount = finiteNonNegative(cost.amount ?? null, 'cost.amount', { nullable: true });
  const priceSnapshotId = cost.priceSnapshotId ?? null;
  nullableString(priceSnapshotId, 'cost.priceSnapshotId');
  if (source === 'unavailable' && (amount !== null || priceSnapshotId !== null)) {
    throw new Error('Unavailable cost cannot contain an amount or price snapshot');
  }
  return { amount, currency: 'USD', source, priceSnapshotId };
};

export function createTransportAttemptStub({ transportAttempt, transport, structuredMode, reasoningMode, requestedOutputTokens }) {
  finitePositiveInteger(transportAttempt, 'transportAttempt');
  if (!TRANSPORTS.has(transport)) throw new Error(`Invalid transport: ${transport}`);
  if (!STRUCTURED_MODES.has(structuredMode)) throw new Error(`Invalid structuredMode: ${structuredMode}`);
  if (!REASONING_MODES.has(reasoningMode)) throw new Error(`Invalid reasoningMode: ${reasoningMode}`);
  finitePositiveInteger(requestedOutputTokens, 'requestedOutputTokens');
  return {
    transportAttempt,
    startedAt: new Date().toISOString(),
    latencyMs: null,
    transport,
    structuredMode,
    reasoningMode,
    requestedOutputTokens,
    effectiveOutputTokens: null,
    terminalStatus: null,
    httpStatus: null,
    usage: cloneUsage(),
    cost: cloneCost()
  };
}

export function completeTransportAttempt(attempt, {
  latencyMs,
  terminalStatus,
  httpStatus = null,
  effectiveOutputTokens = null,
  usage = {},
  cost = {}
}) {
  if (attempt.terminalStatus !== null) throw new Error('Transport attempt already completed');
  finiteNonNegative(latencyMs, 'latencyMs');
  if (!TERMINAL_STATUSES.has(terminalStatus)) throw new Error(`Invalid terminalStatus: ${terminalStatus}`);
  if (httpStatus !== null && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    throw new Error('httpStatus must be an HTTP status or null');
  }
  if (effectiveOutputTokens !== null) finitePositiveInteger(effectiveOutputTokens, 'effectiveOutputTokens');
  return {
    transportAttempt: attempt.transportAttempt,
    startedAt: attempt.startedAt,
    latencyMs,
    transport: attempt.transport,
    structuredMode: attempt.structuredMode,
    reasoningMode: attempt.reasoningMode,
    requestedOutputTokens: attempt.requestedOutputTokens,
    effectiveOutputTokens,
    terminalStatus,
    httpStatus,
    usage: cloneUsage(usage),
    cost: cloneCost(cost)
  };
}

export function createInvocationRecord({
  taskId,
  taskVersion,
  taskVariant = null,
  parentInvocationId = null,
  profile,
  context,
  budget
}) {
  const task = validateTask(taskId, taskVariant);
  if (taskVersion !== task.version) throw new Error(`Task version ${taskVersion} does not match registered version ${task.version}`);
  nullableString(parentInvocationId, 'parentInvocationId');
  return {
    schemaVersion: SCHEMA_VERSION,
    invocationId: generateInvocationId(),
    parentInvocationId,
    taskId: task.taskId,
    taskVersion: task.version,
    taskVariant,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    latencyMs: null,
    profile: cloneProfile(profile),
    context: cloneContext(context),
    budget: validateBudget(budget),
    attempts: [],
    outcome: null
  };
}

export function startGenerationAttempt(record, { purpose }) {
  assertOpen(record);
  if (!GENERATION_PURPOSES.has(purpose)) throw new Error(`Invalid generation purpose: ${purpose}`);
  if (record.attempts.length >= record.budget.maxGenerationAttempts) {
    throw new Error(`Exceeded maxGenerationAttempts (${record.budget.maxGenerationAttempts})`);
  }
  if (record.attempts.some((attempt) => attempt.result === null)) throw new Error('Previous generation attempt is still open');
  const generationAttempt = record.attempts.length + 1;
  return { ...record, attempts: [...record.attempts, { generationAttempt, purpose, transportAttempts: [], result: null }] };
}

export function startTransportAttempt(record, generationAttempt, params) {
  assertOpen(record);
  const index = generationAttempt - 1;
  const generation = record.attempts[index];
  if (!generation || generation.generationAttempt !== generationAttempt) throw new Error(`Unknown generation attempt: ${generationAttempt}`);
  if (generation.result !== null) throw new Error('Generation attempt already completed');
  if (generation.transportAttempts.some((attempt) => attempt.terminalStatus === null)) {
    throw new Error('Previous transport attempt is still open');
  }
  if (generation.transportAttempts.length >= record.budget.maxTransportAttemptsPerGeneration) {
    throw new Error(`Exceeded maxTransportAttemptsPerGeneration (${record.budget.maxTransportAttemptsPerGeneration})`);
  }
  const stub = createTransportAttemptStub({ ...params, transportAttempt: generation.transportAttempts.length + 1 });
  const attempts = record.attempts.map((attempt, attemptIndex) => attemptIndex === index
    ? { ...attempt, transportAttempts: [...attempt.transportAttempts, stub] }
    : attempt);
  return { record: { ...record, attempts }, transportAttempt: stub.transportAttempt };
}

export function finishTransportAttempt(record, generationAttempt, transportAttempt, update) {
  assertOpen(record);
  const generationIndex = generationAttempt - 1;
  const transportIndex = transportAttempt - 1;
  const generation = record.attempts[generationIndex];
  const pending = generation?.transportAttempts?.[transportIndex];
  if (!pending || pending.transportAttempt !== transportAttempt) throw new Error('Unknown transport attempt');
  const completed = completeTransportAttempt(pending, update);
  const attempts = record.attempts.map((attempt, attemptIndex) => attemptIndex === generationIndex
    ? {
        ...attempt,
        transportAttempts: attempt.transportAttempts.map((transport, index) => index === transportIndex ? completed : transport)
      }
    : attempt);
  return { ...record, attempts };
}

export function finishGenerationAttempt(record, generationAttempt, result) {
  assertOpen(record);
  if (!GENERATION_RESULTS.has(result)) throw new Error(`Invalid generation result: ${result}`);
  const index = generationAttempt - 1;
  const generation = record.attempts[index];
  if (!generation || generation.generationAttempt !== generationAttempt) throw new Error(`Unknown generation attempt: ${generationAttempt}`);
  if (generation.result !== null) throw new Error('Generation attempt already completed');
  if (generation.transportAttempts.length === 0) throw new Error('Generation attempt has no transport attempts');
  if (generation.transportAttempts.some((attempt) => attempt.terminalStatus === null)) {
    throw new Error('Generation attempt has an open transport attempt');
  }
  const attempts = record.attempts.map((attempt, attemptIndex) => attemptIndex === index ? { ...attempt, result } : attempt);
  return { ...record, attempts };
}

const assertReadyToClose = (record) => {
  assertOpen(record);
  if (record.attempts.length === 0) throw new Error('Invocation has no generation attempts');
  if (record.attempts.some((attempt) => attempt.result === null)) throw new Error('Invocation has an open generation attempt');
  if (record.attempts.some((attempt) => attempt.transportAttempts.length === 0)) {
    throw new Error('Generation attempt has no transport attempts');
  }
  if (record.attempts.some((attempt) => attempt.transportAttempts.some((transport) => transport.terminalStatus === null))) {
    throw new Error('Invocation has an open transport attempt');
  }
};

const finalize = (record, outcome) => {
  const finishedAt = new Date().toISOString();
  return {
    ...record,
    finishedAt,
    latencyMs: Math.max(0, Date.parse(finishedAt) - Date.parse(record.startedAt)),
    outcome
  };
};

const cloneEffect = (effect) => {
  if (!effect || !EFFECT_KINDS.has(effect.effectKind)) throw new Error('Invalid accepted effect');
  const fromWorldRevision = effect.fromWorldRevision ?? null;
  const toWorldRevision = effect.toWorldRevision ?? null;
  nullableString(fromWorldRevision, 'fromWorldRevision');
  nullableString(toWorldRevision, 'toWorldRevision');
  if (!Array.isArray(effect.validatedCommandIds) || !effect.validatedCommandIds.every((id) => typeof id === 'string')) {
    throw new Error('validatedCommandIds must be a string array');
  }
  if (!Array.isArray(effect.eventIds) || !effect.eventIds.every((id) => typeof id === 'string')) {
    throw new Error('eventIds must be a string array');
  }
  if (effect.effectKind === 'state-change') {
    nonEmptyString(fromWorldRevision, 'fromWorldRevision');
    nonEmptyString(toWorldRevision, 'toWorldRevision');
    if (fromWorldRevision === toWorldRevision) throw new Error('State-change revisions must differ');
  }
  return {
    effectKind: effect.effectKind,
    fromWorldRevision,
    toWorldRevision,
    validatedCommandIds: [...effect.validatedCommandIds],
    eventIds: [...effect.eventIds]
  };
};

export function acceptInvocationEffect(record, effect) {
  assertReadyToClose(record);
  if (record.attempts.at(-1).result !== 'accepted') throw new Error('Accepted effect requires an accepted generation result');
  return finalize(record, { status: 'accepted', effect: cloneEffect(effect) });
}

export function closeInvocation(record, outcome) {
  assertReadyToClose(record);
  if (!outcome || outcome.status === 'accepted') throw new Error('Accepted outcomes require acceptInvocationEffect');
  if (outcome.status === 'no-effect' && new Set(['advisory', 'empty', 'superseded']).has(outcome.reason)) {
    return finalize(record, { status: 'no-effect', reason: outcome.reason });
  }
  if (outcome.status === 'fallback' && typeof outcome.fallbackId === 'string' && outcome.fallbackId) {
    return finalize(record, { status: 'fallback', fallbackId: outcome.fallbackId });
  }
  if (outcome.status === 'cancelled' && new Set(['user', 'superseded']).has(outcome.by)) {
    return finalize(record, { status: 'cancelled', by: outcome.by });
  }
  if (outcome.status === 'failed' && Object.hasOwn(FAILURE_SUMMARIES, outcome.failure?.code)) {
    return finalize(record, {
      status: 'failed',
      failure: { code: outcome.failure.code, sanitizedSummary: FAILURE_SUMMARIES[outcome.failure.code] }
    });
  }
  throw new Error('Invalid invocation outcome');
}

const cloneAttemptForSerialization = (attempt) => ({
  generationAttempt: attempt.generationAttempt,
  purpose: attempt.purpose,
  transportAttempts: attempt.transportAttempts.map((transport) => ({
    transportAttempt: transport.transportAttempt,
    startedAt: transport.startedAt,
    latencyMs: transport.latencyMs,
    transport: transport.transport,
    structuredMode: transport.structuredMode,
    reasoningMode: transport.reasoningMode,
    requestedOutputTokens: transport.requestedOutputTokens,
    effectiveOutputTokens: transport.effectiveOutputTokens,
    terminalStatus: transport.terminalStatus,
    httpStatus: transport.httpStatus,
    usage: cloneUsage(transport.usage),
    cost: cloneCost(transport.cost)
  })),
  result: attempt.result
});

const cloneOutcomeForSerialization = (outcome) => {
  if (outcome === null) return null;
  if (outcome.status === 'accepted') return { status: 'accepted', effect: cloneEffect(outcome.effect) };
  if (outcome.status === 'failed') return {
    status: 'failed',
    failure: { code: outcome.failure.code, sanitizedSummary: FAILURE_SUMMARIES[outcome.failure.code] ?? 'AI call failed' }
  };
  if (outcome.status === 'no-effect') return { status: 'no-effect', reason: outcome.reason };
  if (outcome.status === 'fallback') return { status: 'fallback', fallbackId: outcome.fallbackId };
  return { status: 'cancelled', by: outcome.by };
};

export function sanitizeForSerialization(record) {
  if (!record || record.schemaVersion !== SCHEMA_VERSION || !Array.isArray(record.attempts)) {
    throw new Error('Expected an AI invocation record');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    invocationId: record.invocationId,
    parentInvocationId: record.parentInvocationId,
    taskId: record.taskId,
    taskVersion: record.taskVersion,
    taskVariant: record.taskVariant,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    latencyMs: record.latencyMs,
    profile: cloneProfile(record.profile),
    context: cloneContext(record.context),
    budget: validateBudget(record.budget),
    attempts: record.attempts.map(cloneAttemptForSerialization),
    outcome: cloneOutcomeForSerialization(record.outcome)
  };
}

const recoverRecord = (record) => {
  let recovered = {
    ...record,
    attempts: record.attempts.map((generation) => ({
      ...generation,
      transportAttempts: generation.transportAttempts.length === 0
        ? [completeTransportAttempt(createTransportAttemptStub({
            transportAttempt: 1,
            transport: 'direct',
            structuredMode: 'none',
            reasoningMode: record.profile.reasoningMode,
            requestedOutputTokens: record.budget.maxOutputTokens
          }), { latencyMs: 0, terminalStatus: 'transport-error' })]
        : generation.transportAttempts.map((transport) => transport.terminalStatus === null
            ? completeTransportAttempt(transport, { latencyMs: 0, terminalStatus: 'transport-error' })
            : transport),
      result: generation.result ?? 'request-failed'
    }))
  };
  if (recovered.attempts.length === 0) {
    recovered = startGenerationAttempt(recovered, { purpose: 'initial' });
    const started = startTransportAttempt(recovered, 1, {
      transport: 'direct', structuredMode: 'none', reasoningMode: recovered.profile.reasoningMode,
      requestedOutputTokens: recovered.budget.maxOutputTokens
    });
    recovered = finishTransportAttempt(started.record, 1, started.transportAttempt, {
      latencyMs: 0, terminalStatus: 'transport-error'
    });
    recovered = finishGenerationAttempt(recovered, 1, 'request-failed');
  }
  return closeInvocation(recovered, { status: 'failed', failure: { code: 'transport' } });
};

export class AiCallLedger {
  constructor() {
    this.records = [];
    this.openRecords = new Map();
  }

  startInvocation(params) {
    const record = createInvocationRecord(params);
    this.openRecords.set(record.invocationId, record);
    return record;
  }

  getOpenInvocation(invocationId) { return this.openRecords.get(invocationId) ?? null; }

  #replace(invocationId, transform) {
    const record = this.getOpenInvocation(invocationId);
    if (!record) throw new Error(`No open invocation with ID: ${invocationId}`);
    const updated = transform(record);
    this.openRecords.set(invocationId, updated);
    return updated;
  }

  startGeneration(invocationId, params) {
    return this.#replace(invocationId, (record) => startGenerationAttempt(record, params));
  }

  startTransport(invocationId, generationAttempt, params) {
    let transportAttempt;
    const record = this.#replace(invocationId, (current) => {
      const started = startTransportAttempt(current, generationAttempt, params);
      transportAttempt = started.transportAttempt;
      return started.record;
    });
    return { record, transportAttempt };
  }

  finishTransport(invocationId, generationAttempt, transportAttempt, update) {
    return this.#replace(invocationId, (record) => finishTransportAttempt(record, generationAttempt, transportAttempt, update));
  }

  finishGeneration(invocationId, generationAttempt, result) {
    return this.#replace(invocationId, (record) => finishGenerationAttempt(record, generationAttempt, result));
  }

  #storeClosed(invocationId, closed) {
    this.openRecords.delete(invocationId);
    this.records.unshift(closed);
    if (this.records.length > MAX_RETAINED_RECORDS) this.records.length = MAX_RETAINED_RECORDS;
    return closed;
  }

  acceptEffect(invocationId, effect) {
    const record = this.getOpenInvocation(invocationId);
    if (!record) throw new Error(`No open invocation with ID: ${invocationId}`);
    return this.#storeClosed(invocationId, acceptInvocationEffect(record, effect));
  }

  closeInvocation(invocationId, outcome) {
    const record = this.getOpenInvocation(invocationId);
    if (!record) throw new Error(`No open invocation with ID: ${invocationId}`);
    return this.#storeClosed(invocationId, closeInvocation(record, outcome));
  }

  recoverInterrupted() {
    const open = [...this.openRecords.values()];
    for (const record of open) this.#storeClosed(record.invocationId, recoverRecord(record));
    return open.length;
  }

  getClosedRecords() { return [...this.records]; }
  getOpenRecords() { return [...this.openRecords.values()]; }
  getAllRecords() { return [...this.getOpenRecords(), ...this.records]; }

  getUsageStatistics() {
    const fields = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedInputTokens', 'totalTokens'];
    const totals = Object.fromEntries(fields.map((field) => [`known${field[0].toUpperCase()}${field.slice(1)}`, 0]));
    let hasUnknownUsage = false;
    let hasUnknownCost = false;
    let knownCostUSD = 0;
    for (const record of this.records) {
      for (const generation of record.attempts) {
        for (const transport of generation.transportAttempts) {
          for (const field of fields) {
            if (transport.usage[field] === null) hasUnknownUsage = true;
            else totals[`known${field[0].toUpperCase()}${field.slice(1)}`] += transport.usage[field];
          }
          if (transport.cost.amount === null) hasUnknownCost = true;
          else knownCostUSD += transport.cost.amount;
        }
      }
    }
    return {
      totalInvocations: this.records.length,
      openInvocations: this.openRecords.size,
      ...totals,
      knownCostUSD,
      hasUnknownUsage,
      hasUnknownCost
    };
  }

  exportRecords(limit = MAX_RETAINED_RECORDS) {
    finitePositiveInteger(limit, 'limit');
    return this.getAllRecords().slice(0, limit).map(sanitizeForSerialization);
  }

  clear() {
    this.records = [];
    this.openRecords.clear();
  }
}

export const ledger = new AiCallLedger();

export default {
  createTransportAttemptStub,
  completeTransportAttempt,
  createInvocationRecord,
  startGenerationAttempt,
  startTransportAttempt,
  finishTransportAttempt,
  finishGenerationAttempt,
  acceptInvocationEffect,
  closeInvocation,
  sanitizeForSerialization,
  AiCallLedger,
  ledger
};
