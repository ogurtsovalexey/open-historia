/**
 * AI Call Ledger - Record management, redaction, and bounded storage for AI calls
 *
 * Implements the Phase 1 AI call registry contract from docs/spec/ai-call-registry.md
 */

import { validateTask, validateBudget, validateContextManifest } from './aiCallRegistry.js';

/**
 * @typedef {import('./aiCallRegistry.js').AiInvocationRecord} AiInvocationRecord
 * @typedef {import('./aiCallRegistry.js').AiGenerationAttempt} AiGenerationAttempt
 * @typedef {import('./aiCallRegistry.js').AiTransportAttempt} AiTransportAttempt
 * @typedef {import('./aiCallRegistry.js').AiUsage} AiUsage
 * @typedef {import('./aiCallRegistry.js').AiCost} AiCost
 * @typedef {import('./aiCallRegistry.js').AiProfileSnapshot} AiProfileSnapshot
 * @typedef {import('./aiCallRegistry.js').AiContextManifest} AiContextManifest
 * @typedef {import('./aiCallRegistry.js').AiBudgetSnapshot} AiBudgetSnapshot
 * @typedef {import('./aiCallRegistry.js').AiInvocationOutcome} AiInvocationOutcome
 * @typedef {import('./aiCallRegistry.js').AiFailure} AiFailure
 * @typedef {import('./aiCallRegistry.js').AiAcceptedEffect} AiAcceptedEffect
 */

const SCHEMA_VERSION = 1;
const MAX_RETAINED_RECORDS = 200;

/**
 * Generate a random invocation ID
 * @returns {string}
 */
function generateInvocationId() {
  return 'inv_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a transport attempt stub (must be created before network dispatch)
 * @param {Object} params
 * @param {number} transportAttempt - 1-indexed attempt number
 * @param {'direct'|'relay'} transport
 * @param {'none'|'tool'|'json-schema'|'json-object'|'text-json'} structuredMode
 * @param {'off'|'fast'|'standard'} reasoningMode
 * @param {number} requestedOutputTokens
 * @returns {AiTransportAttempt}
 */
export function createTransportAttemptStub({
  transportAttempt,
  transport,
  structuredMode,
  reasoningMode,
  requestedOutputTokens
}) {
  const now = new Date().toISOString();

  return {
    transportAttempt,
    startedAt: now,
    latencyMs: null,
    transport,
    structuredMode,
    reasoningMode,
    requestedOutputTokens,
    effectiveOutputTokens: null,
    terminalStatus: 'success', // Will be updated when attempt completes
    httpStatus: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cachedInputTokens: null,
      totalTokens: null,
      source: 'unavailable'
    },
    cost: {
      amount: null,
      currency: 'USD',
      source: 'unavailable',
      priceSnapshotId: null
    }
  };
}

/**
 * Update transport attempt with completion data
 * @param {AiTransportAttempt} attempt
 * @param {Object} update
 * @param {number|null} latencyMs
 * @param {'success'|'provider-error'|'transport-error'|'timeout'|'cancelled'} terminalStatus
 * @param {number|null} httpStatus
 * @param {number|null} effectiveOutputTokens
 * @param {Partial<AiUsage>} usage
 * @param {Partial<AiCost>} cost
 * @returns {AiTransportAttempt}
 */
export function completeTransportAttempt(attempt, {
  latencyMs,
  terminalStatus,
  httpStatus,
  effectiveOutputTokens,
  usage = {},
  cost = {}
}) {
  return {
    ...attempt,
    latencyMs,
    terminalStatus,
    httpStatus,
    effectiveOutputTokens,
    usage: {
      ...attempt.usage,
      ...usage
    },
    cost: {
      ...attempt.cost,
      ...cost
    }
  };
}

/**
 * Create a new invocation record envelope
 * @param {Object} params
 * @param {string} taskId
 * @param {number} taskVersion
 * @param {string|null} taskVariant
 * @param {string|null} parentInvocationId
 * @param {AiProfileSnapshot} profile
 * @param {AiContextManifest} context
 * @param {AiBudgetSnapshot} budget
 * @returns {AiInvocationRecord}
 */
export function createInvocationRecord({
  taskId,
  taskVersion,
  taskVariant,
  parentInvocationId,
  profile,
  context,
  budget
}) {
  const now = new Date().toISOString();

  // Validate inputs
  validateTask(taskId, taskVariant);
  validateContextManifest(context);
  validateBudget(budget);

  // Validate profile
  const allowedProviderKinds = ['gemini', 'openai', 'anthropic', 'openai-compatible', 'anthropic-compatible'];
  const allowedEndpointClasses = ['provider-default', 'loopback', 'lan', 'remote-custom'];
  const allowedReasoningModes = ['off', 'fast', 'standard'];

  if (!allowedProviderKinds.includes(profile.providerKind)) {
    throw new Error(`Invalid providerKind: ${profile.providerKind}`);
  }
  if (!allowedEndpointClasses.includes(profile.endpointClass)) {
    throw new Error(`Invalid endpointClass: ${profile.endpointClass}`);
  }
  if (!allowedReasoningModes.includes(profile.reasoningMode)) {
    throw new Error(`Invalid reasoningMode: ${profile.reasoningMode}`);
  }
  if (typeof profile.model !== 'string' || !profile.model.trim()) {
    throw new Error('Model must be non-empty string');
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    invocationId: generateInvocationId(),
    parentInvocationId,
    taskId,
    taskVersion,
    taskVariant,
    startedAt: now,
    finishedAt: null,
    latencyMs: null,
    profile,
    context,
    budget,
    attempts: [],
    outcome: null
  };
}

/**
 * Add a generation attempt to invocation record
 * @param {AiInvocationRecord} record
 * @param {Object} params
 * @param {number} generationAttempt - 1-indexed attempt number
 * @param {'initial'|'validation-correction'} purpose
 * @param {AiTransportAttempt[]} transportAttempts
 * @param {'accepted'|'parse-failed'|'schema-failed'|'semantic-failed'|'request-failed'} result
 * @returns {AiInvocationRecord}
 */
export function addGenerationAttempt(record, {
  generationAttempt,
  purpose,
  transportAttempts,
  result
}) {
  // Check attempt numbering
  const expectedAttemptNumber = record.attempts.length + 1;
  if (generationAttempt !== expectedAttemptNumber) {
    throw new Error(`Expected generationAttempt ${expectedAttemptNumber}, got ${generationAttempt}`);
  }

  // Check transport attempt numbering
  for (let i = 0; i < transportAttempts.length; i++) {
    if (transportAttempts[i].transportAttempt !== i + 1) {
      throw new Error(`Transport attempt ${i + 1} has wrong transportAttempt number: ${transportAttempts[i].transportAttempt}`);
    }
  }

  // Check budget limits
  if (record.attempts.length >= record.budget.maxGenerationAttempts) {
    throw new Error(`Exceeded maxGenerationAttempts (${record.budget.maxGenerationAttempts})`);
  }

  const newAttempt = {
    generationAttempt,
    purpose,
    transportAttempts,
    result
  };

  return {
    ...record,
    attempts: [...record.attempts, newAttempt]
  };
}

/**
 * Close invocation record with outcome
 * @param {AiInvocationRecord} record
 * @param {AiInvocationOutcome} outcome
 * @returns {AiInvocationRecord}
 */
export function closeInvocation(record, outcome) {
  if (record.finishedAt !== null) {
    throw new Error('Invocation already closed');
  }

  const finishedAt = new Date().toISOString();
  const startedAt = new Date(record.startedAt);
  const latencyMs = Math.max(0, new Date(finishedAt).getTime() - startedAt.getTime());

  // Validate state-change outcomes have required revisions
  if (outcome.status === 'accepted' && outcome.effect.effectKind === 'state-change') {
    if (outcome.effect.fromWorldRevision === null || outcome.effect.toWorldRevision === null) {
      throw new Error('State-change effects must have both fromWorldRevision and toWorldRevision');
    }
  }

  return {
    ...record,
    finishedAt,
    latencyMs,
    outcome
  };
}

/**
 * Redact sensitive data from objects (enforces redaction boundary)
 * @param {any} obj
 * @returns {any} Redacted copy
 */
function redactSensitiveData(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  // Create shallow copy
  const result = { ...obj };

  // Redact known sensitive fields
  for (const [key, value] of Object.entries(result)) {
    // Redact URLs
    if (typeof value === 'string' && (
      key.toLowerCase().includes('url') ||
      key.toLowerCase().includes('endpoint') ||
      key.toLowerCase().includes('host') ||
      value.startsWith('http://') ||
      value.startsWith('https://')
    )) {
      // Remove query strings and user-info, keep only scheme and host
      try {
        const url = new URL(value);
        url.search = '';
        url.hash = '';
        url.username = '';
        url.password = '';
        result[key] = url.origin;
      } catch {
        // Not a valid URL, redact completely
        result[key] = '[REDACTED_URL]';
      }
    }

    // Redact API keys, tokens, secrets
    if (typeof value === 'string' && (
      key.toLowerCase().includes('key') ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('auth')
    )) {
      result[key] = '[REDACTED]';
    }

    // Recursively process nested objects
    else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    }
  }

  return result;
}

/**
 * Create a sanitized serializable copy of invocation record
 * @param {AiInvocationRecord} record
 * @returns {AiInvocationRecord}
 */
export function sanitizeForSerialization(record) {
  // Deep clone and redact
  const sanitized = redactSensitiveData(record);

  // Ensure schema version
  sanitized.schemaVersion = SCHEMA_VERSION;

  return sanitized;
}

/**
 * In-memory ledger storage with bounded retention
 */
export class AiCallLedger {
  constructor() {
    /** @type {AiInvocationRecord[]} */
    this.records = [];
    /** @type {Map<string, AiInvocationRecord>} */
    this.openRecords = new Map();
  }

  /**
   * Start tracking a new invocation
   * @param {Parameters<typeof createInvocationRecord>[0]} params
   * @returns {AiInvocationRecord}
   */
  startInvocation(params) {
    const record = createInvocationRecord(params);
    this.openRecords.set(record.invocationId, record);
    return record;
  }

  /**
   * Get open invocation by ID
   * @param {string} invocationId
   * @returns {AiInvocationRecord|null}
   */
  getOpenInvocation(invocationId) {
    return this.openRecords.get(invocationId) ?? null;
  }

  /**
   * Update an open invocation
   * @param {string} invocationId
   * @param {AiInvocationRecord} updatedRecord
   */
  updateInvocation(invocationId, updatedRecord) {
    if (!this.openRecords.has(invocationId)) {
      throw new Error(`No open invocation with ID: ${invocationId}`);
    }

    // Ensure ID doesn't change
    if (updatedRecord.invocationId !== invocationId) {
      throw new Error('Cannot change invocationId');
    }

    this.openRecords.set(invocationId, updatedRecord);
  }

  /**
   * Close an invocation and move to closed storage
   * @param {string} invocationId
   * @param {AiInvocationOutcome} outcome
   * @returns {AiInvocationRecord}
   */
  closeInvocation(invocationId, outcome) {
    const openRecord = this.openRecords.get(invocationId);
    if (!openRecord) {
      throw new Error(`No open invocation with ID: ${invocationId}`);
    }

    const closedRecord = closeInvocation(openRecord, outcome);
    this.openRecords.delete(invocationId);

    // Add to records and enforce bounded retention
    this.records.unshift(closedRecord); // Newest first

    // Keep only MAX_RETAINED_RECORDS closed records
    if (this.records.length > MAX_RETAINED_RECORDS) {
      this.records = this.records.slice(0, MAX_RETAINED_RECORDS);
    }

    return closedRecord;
  }

  /**
   * Recover interrupted open records as failed/transport
   * Call on startup to clean up interrupted calls
   */
  recoverInterrupted() {
    const now = new Date().toISOString();

    for (const [invocationId, record] of this.openRecords.entries()) {
      // Mark as transport failure
      const failure = {
        code: 'transport',
        sanitizedSummary: 'Interrupted before completion'
      };

      const outcome = {
        status: 'failed',
        failure
      };

      const recoveredRecord = {
        ...record,
        finishedAt: now,
        latencyMs: Math.max(0, new Date(now).getTime() - new Date(record.startedAt).getTime()),
        outcome
      };

      // Move to closed storage
      this.records.unshift(recoveredRecord);

      // Enforce bounded retention
      if (this.records.length > MAX_RETAINED_RECORDS) {
        this.records = this.records.slice(0, MAX_RETAINED_RECORDS);
      }
    }

    // Clear open records
    const count = this.openRecords.size;
    this.openRecords.clear();
    return count;
  }

  /**
   * Get all records (closed only, newest first)
   * @returns {AiInvocationRecord[]}
   */
  getClosedRecords() {
    return [...this.records];
  }

  /**
   * Get open records
   * @returns {AiInvocationRecord[]}
   */
  getOpenRecords() {
    return Array.from(this.openRecords.values());
  }

  /**
   * Get all records including open (for diagnostics)
   * @returns {AiInvocationRecord[]}
   */
  getAllRecords() {
    return [...this.getOpenRecords(), ...this.records];
  }

  /**
   * Get aggregated usage statistics
   * @returns {{
   *   totalInvocations: number,
   *   openInvocations: number,
   *   knownInputTokens: number,
   *   knownOutputTokens: number,
   *   knownCostUSD: number,
   *   hasUnknownUsage: boolean,
   *   hasUnknownCost: boolean
   * }}
   */
  getUsageStatistics() {
    let knownInputTokens = 0;
    let knownOutputTokens = 0;
    let knownCostUSD = 0;
    let hasUnknownUsage = false;
    let hasUnknownCost = false;

    for (const record of this.records) {
      for (const attempt of record.attempts) {
        for (const transport of attempt.transportAttempts) {
          // Usage
          if (transport.usage.inputTokens !== null) {
            knownInputTokens += transport.usage.inputTokens;
          } else {
            hasUnknownUsage = true;
          }

          if (transport.usage.outputTokens !== null) {
            knownOutputTokens += transport.usage.outputTokens;
          } else {
            hasUnknownUsage = true;
          }

          // Cost
          if (transport.cost.amount !== null && transport.cost.currency === 'USD') {
            knownCostUSD += transport.cost.amount;
          } else {
            hasUnknownCost = true;
          }
        }
      }
    }

    return {
      totalInvocations: this.records.length,
      openInvocations: this.openRecords.size,
      knownInputTokens,
      knownOutputTokens,
      knownCostUSD,
      hasUnknownUsage,
      hasUnknownCost
    };
  }

  /**
   * Export sanitized records for diagnostics
   * @param {number} limit - Maximum number of records to export
   * @returns {AiInvocationRecord[]}
   */
  exportRecords(limit = MAX_RETAINED_RECORDS) {
    const records = this.getAllRecords();
    return records
      .slice(0, limit)
      .map(sanitizeForSerialization);
  }

  /**
   * Clear all records (for testing)
   */
  clear() {
    this.records = [];
    this.openRecords.clear();
  }
}

// Singleton ledger instance (production-agnostic - adapters will manage persistence)
export const ledger = new AiCallLedger();

export default {
  createTransportAttemptStub,
  completeTransportAttempt,
  createInvocationRecord,
  addGenerationAttempt,
  closeInvocation,
  sanitizeForSerialization,
  AiCallLedger,
  ledger
};