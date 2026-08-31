/**
 * AI Call Registry - Core definitions and validation for AI task registry
 *
 * Implements the Phase 1 AI call registry contract from docs/spec/ai-call-registry.md
 */

/**
 * @typedef {Object} AiTaskDefinition
 * @property {string} taskId - Stable dotted identifier
 * @property {number} version - Task version
 * @property {'structured'|'conversation'} kind - Task kind
 * @property {'proposal'|'explanation'|'classification'|'compression'} authority - Task authority
 * @property {string} contextPolicyId - Context policy identifier
 * @property {string} budgetPolicyId - Budget policy identifier
 * @property {string|null} outputContractId - Output schema contract ID or null for conversation
 * @property {string[]} allowedVariants - Allowed variant strings
 * @property {'deterministic'|'surface-error'|'silent-none'} fallbackPolicy - Fallback behavior
 * @property {boolean} mayMutateState - Whether validated output may lead to state effects
 */

/**
 * @typedef {Object} AiProfileSnapshot
 * @property {'gemini'|'openai'|'anthropic'|'openai-compatible'|'anthropic-compatible'} providerKind
 * @property {string} model - Model identifier
 * @property {'provider-default'|'loopback'|'lan'|'remote-custom'} endpointClass
 * @property {'off'|'fast'|'standard'} reasoningMode
 */

/**
 * @typedef {Object} AiContextManifest
 * @property {number} manifestVersion - Always 1
 * @property {string|null} worldRevision - World revision ID or null
 * @property {string|null} promptPackRevision - Prompt pack revision ID or null
 * @property {Array<{
 *   kind: 'system-instructions'|'scenario-rules'|'world-summary'|'map-semantics'|'events'|'actions'|'chat'|'campaign-memory'|'country-dossier'|'user-input'|'retry-feedback',
 *   itemCount: number,
 *   characterCount: number,
 *   truncated: boolean,
 *   sourceRevision: string|null
 * }>} items - Context items
 * @property {number} totalCharacterCount - Total characters after truncation
 * @property {false} fullMapIncluded - Always false (enforces Principle 3)
 */

/**
 * @typedef {Object} AiBudgetSnapshot
 * @property {string} policyId - Budget policy identifier
 * @property {number} deadlineMs - Finite positive integer
 * @property {number} maxOutputTokens - Finite positive integer
 * @property {number} maxGenerationAttempts - Finite positive integer
 * @property {number} maxTransportAttemptsPerGeneration - Finite positive integer
 * @property {'off'|'fast'|'standard'} reasoningMode
 */

/**
 * @typedef {Object} AiUsage
 * @property {number|null} inputTokens
 * @property {number|null} outputTokens
 * @property {number|null} reasoningTokens
 * @property {number|null} cachedInputTokens
 * @property {number|null} totalTokens
 * @property {'provider'|'estimated'|'unavailable'} source
 */

/**
 * @typedef {Object} AiCost
 * @property {number|null} amount
 * @property {'USD'} currency
 * @property {'provider'|'price-snapshot'|'unavailable'} source
 * @property {string|null} priceSnapshotId
 */

/**
 * @typedef {Object} AiTransportAttempt
 * @property {number} transportAttempt - 1-indexed attempt number
 * @property {string} startedAt - ISO 8601 timestamp
 * @property {number|null} latencyMs - Null if incomplete
 * @property {'direct'|'relay'} transport
 * @property {'none'|'tool'|'json-schema'|'json-object'|'text-json'} structuredMode
 * @property {'off'|'fast'|'standard'} reasoningMode
 * @property {number} requestedOutputTokens
 * @property {number|null} effectiveOutputTokens - Null if unknown
 * @property {'success'|'provider-error'|'transport-error'|'timeout'|'cancelled'|null} terminalStatus
 * @property {number|null} httpStatus - HTTP status code or null
 * @property {AiUsage} usage
 * @property {AiCost} cost
 */

/**
 * @typedef {Object} AiGenerationAttempt
 * @property {number} generationAttempt - 1-indexed attempt number
 * @property {'initial'|'validation-correction'} purpose
 * @property {AiTransportAttempt[]} transportAttempts
 * @property {'accepted'|'parse-failed'|'schema-failed'|'semantic-failed'|'request-failed'|null} result
 */

/**
 * @typedef {Object} AiFailure
 * @property {'provider'|'timeout'|'transport'|'parse'|'schema'|'semantic-validation'|'budget'|'registry'} code
 * @property {string} sanitizedSummary - Redacted error summary
 */

/**
 * @typedef {Object} AiAcceptedEffect
 * @property {'state-change'|'chat-message'|'display-only'|'memory-update'} effectKind
 * @property {string|null} fromWorldRevision
 * @property {string|null} toWorldRevision
 * @property {string[]} validatedCommandIds
 * @property {string[]} eventIds
 */

/**
 * @typedef {Object} AiInvocationOutcome
 * @property {'accepted'} status
 * @property {AiAcceptedEffect} effect
 * } | {
 * @property {'no-effect'} status
 * @property {'advisory'|'empty'|'superseded'} reason
 * } | {
 * @property {'fallback'} status
 * @property {string} fallbackId
 * } | {
 * @property {'failed'} status
 * @property {AiFailure} failure
 * } | {
 * @property {'cancelled'} status
 * @property {'user'|'superseded'} by
 */

/**
 * @typedef {Object} AiInvocationRecord
 * @property {number} schemaVersion - Always 1
 * @property {string} invocationId - Random UUID-like ID
 * @property {string|null} parentInvocationId - Parent invocation ID or null
 * @property {string} taskId - Registered task ID
 * @property {number} taskVersion - Task definition version
 * @property {string|null} taskVariant - Null or allowed variant
 * @property {string} startedAt - ISO 8601 timestamp
 * @property {string|null} finishedAt - Null if incomplete
 * @property {number|null} latencyMs - Null if incomplete
 * @property {AiProfileSnapshot} profile
 * @property {AiContextManifest} context
 * @property {AiBudgetSnapshot} budget
 * @property {AiGenerationAttempt[]} attempts
 * @property {AiInvocationOutcome|null} outcome - Null if incomplete
 */

// Phase 1 task definitions from spec
/** @type {AiTaskDefinition[]} */
const TASK_DEFINITIONS = [
  {
    taskId: 'orders.interpret-economy',
    version: 1,
    kind: 'structured',
    authority: 'proposal',
    contextPolicyId: 'player-order-interpreter',
    budgetPolicyId: 'medium-classification',
    outputContractId: 'player-economy-orders-schema',
    allowedVariants: [],
    fallbackPolicy: 'surface-error',
    mayMutateState: true
  },
  {
    taskId: 'opponents.plan-economy',
    version: 1,
    kind: 'structured',
    authority: 'proposal',
    contextPolicyId: 'opponent-economy-batch',
    budgetPolicyId: 'medium-generation',
    outputContractId: 'opponent-economy-batch-schema',
    allowedVariants: [],
    fallbackPolicy: 'deterministic',
    mayMutateState: true
  },
  {
    taskId: 'reports.explain-economy',
    version: 1,
    kind: 'structured',
    authority: 'explanation',
    contextPolicyId: 'player-economy-report',
    budgetPolicyId: 'medium-generation',
    outputContractId: 'player-economy-report-schema',
    allowedVariants: [],
    fallbackPolicy: 'deterministic',
    mayMutateState: false
  },
  {
    taskId: 'timeline.advance',
    version: 1,
    kind: 'structured',
    authority: 'proposal',
    contextPolicyId: 'world-advance',
    budgetPolicyId: 'large-generation',
    outputContractId: 'timeline-advance-schema',
    allowedVariants: ['manual', 'automatic'],
    fallbackPolicy: 'deterministic',
    mayMutateState: true
  },
  {
    taskId: 'actions.suggest',
    version: 1,
    kind: 'structured',
    authority: 'proposal',
    contextPolicyId: 'action-suggest',
    budgetPolicyId: 'medium-classification',
    outputContractId: 'action-suggest-schema',
    allowedVariants: [],
    fallbackPolicy: 'surface-error',
    mayMutateState: false
  },
  {
    taskId: 'actions.refine',
    version: 1,
    kind: 'conversation',
    authority: 'explanation',
    contextPolicyId: 'action-refine',
    budgetPolicyId: 'small-fast',
    outputContractId: null,
    allowedVariants: [],
    fallbackPolicy: 'silent-none',
    mayMutateState: false
  },
  {
    taskId: 'memory.consolidate',
    version: 1,
    kind: 'structured',
    authority: 'compression',
    contextPolicyId: 'memory-consolidate',
    budgetPolicyId: 'medium-generation',
    outputContractId: 'memory-consolidate-schema',
    allowedVariants: [],
    fallbackPolicy: 'deterministic',
    mayMutateState: true
  },
  {
    taskId: 'catalyst.create',
    version: 1,
    kind: 'structured',
    authority: 'proposal',
    contextPolicyId: 'catalyst-create',
    budgetPolicyId: 'medium-generation',
    outputContractId: 'catalyst-create-schema',
    allowedVariants: [],
    fallbackPolicy: 'surface-error',
    mayMutateState: true
  },
  {
    taskId: 'catalyst.advance',
    version: 1,
    kind: 'structured',
    authority: 'proposal',
    contextPolicyId: 'catalyst-advance',
    budgetPolicyId: 'medium-generation',
    outputContractId: 'catalyst-advance-schema',
    allowedVariants: [],
    fallbackPolicy: 'surface-error',
    mayMutateState: true
  },
  {
    taskId: 'catalyst.summarize',
    version: 1,
    kind: 'structured',
    authority: 'compression',
    contextPolicyId: 'catalyst-summarize',
    budgetPolicyId: 'small-fast',
    outputContractId: 'catalyst-summarize-schema',
    allowedVariants: [],
    fallbackPolicy: 'silent-none',
    mayMutateState: false
  },
  {
    taskId: 'game-master.resolve',
    version: 1,
    kind: 'structured',
    authority: 'classification',
    contextPolicyId: 'game-master',
    budgetPolicyId: 'small-fast',
    outputContractId: 'game-master-schema',
    allowedVariants: [],
    fallbackPolicy: 'deterministic',
    mayMutateState: true
  },
  {
    taskId: 'country.stat-sheet',
    version: 1,
    kind: 'conversation',
    authority: 'explanation',
    contextPolicyId: 'country-stats',
    budgetPolicyId: 'medium-generation',
    outputContractId: null,
    allowedVariants: [],
    fallbackPolicy: 'silent-none',
    mayMutateState: false
  },
  {
    taskId: 'history.pregame',
    version: 1,
    kind: 'conversation',
    authority: 'explanation',
    contextPolicyId: 'pregame-history',
    budgetPolicyId: 'large-generation',
    outputContractId: null,
    allowedVariants: [],
    fallbackPolicy: 'silent-none',
    mayMutateState: false
  },
  {
    taskId: 'country.briefing',
    version: 1,
    kind: 'conversation',
    authority: 'explanation',
    contextPolicyId: 'intelligence-briefing',
    budgetPolicyId: 'medium-generation',
    outputContractId: null,
    allowedVariants: [],
    fallbackPolicy: 'silent-none',
    mayMutateState: false
  },
  {
    taskId: 'chat.advisor.reply',
    version: 1,
    kind: 'conversation',
    authority: 'explanation',
    contextPolicyId: 'advisor-chat',
    budgetPolicyId: 'small-fast',
    outputContractId: null,
    allowedVariants: [],
    fallbackPolicy: 'silent-none',
    mayMutateState: false
  },
  {
    taskId: 'chat.diplomacy.plan',
    version: 1,
    kind: 'structured',
    authority: 'proposal',
    contextPolicyId: 'diplomacy-plan',
    budgetPolicyId: 'medium-generation',
    outputContractId: 'diplomacy-plan-schema',
    allowedVariants: [],
    fallbackPolicy: 'surface-error',
    mayMutateState: false
  },
  {
    taskId: 'chat.diplomacy.reply',
    version: 1,
    kind: 'conversation',
    authority: 'explanation',
    contextPolicyId: 'diplomacy-chat',
    budgetPolicyId: 'medium-generation',
    outputContractId: null,
    allowedVariants: [],
    fallbackPolicy: 'silent-none',
    mayMutateState: false
  },
  {
    taskId: 'chat.diplomacy.next-speaker',
    version: 1,
    kind: 'structured',
    authority: 'classification',
    contextPolicyId: 'speaker-selection',
    budgetPolicyId: 'small-fast',
    outputContractId: 'speaker-selection-schema',
    allowedVariants: [],
    fallbackPolicy: 'deterministic',
    mayMutateState: false
  }
];

for (const task of TASK_DEFINITIONS) {
  Object.freeze(task.allowedVariants);
  Object.freeze(task);
}
Object.freeze(TASK_DEFINITIONS);

// Budget policies - concrete numbers TBD per implementation
/** @type {Record<string, AiBudgetSnapshot>} */
const BUDGET_POLICIES = {
  'small-fast': {
    policyId: 'small-fast',
    deadlineMs: 10000,
    maxOutputTokens: 1000,
    maxGenerationAttempts: 1,
    maxTransportAttemptsPerGeneration: 2,
    reasoningMode: 'off'
  },
  'medium-classification': {
    policyId: 'medium-classification',
    deadlineMs: 15000,
    maxOutputTokens: 2000,
    maxGenerationAttempts: 2,
    maxTransportAttemptsPerGeneration: 3,
    reasoningMode: 'off'
  },
  'medium-generation': {
    policyId: 'medium-generation',
    deadlineMs: 30000,
    maxOutputTokens: 4000,
    maxGenerationAttempts: 2,
    maxTransportAttemptsPerGeneration: 3,
    reasoningMode: 'off'
  },
  'large-generation': {
    policyId: 'large-generation',
    deadlineMs: 60000,
    maxOutputTokens: 8000,
    maxGenerationAttempts: 3,
    maxTransportAttemptsPerGeneration: 4,
    reasoningMode: 'off'
  }
};

for (const policy of Object.values(BUDGET_POLICIES)) Object.freeze(policy);
Object.freeze(BUDGET_POLICIES);

/**
 * Validate a task ID and variant against registry
 * @param {string} taskId
 * @param {string|null} variant
 * @returns {AiTaskDefinition}
 * @throws {Error} If task not found or variant not allowed
 */
export function validateTask(taskId, variant = null) {
  const definition = TASK_DEFINITIONS.find(t => t.taskId === taskId);
  if (!definition) {
    throw new Error(`Unknown task ID: ${taskId}`);
  }

  if (variant !== null && !definition.allowedVariants.includes(variant)) {
    throw new Error(`Variant "${variant}" not allowed for task "${taskId}". Allowed: ${definition.allowedVariants.join(', ') || 'none'}`);
  }

  return definition;
}

/**
 * Resolve a task at the dispatch boundary. Development callers fail loudly;
 * production callers receive a stable non-dispatchable safety record instead
 * of inventing a task from prompt prose.
 */
export function resolveTaskForDispatch(taskId, variant = null, { production = false } = {}) {
  try {
    return { ok: true, definition: validateTask(taskId, variant) };
  } catch (error) {
    if (!production) throw error;
    return Object.freeze({
      ok: false,
      safetyRecord: Object.freeze({
        taskId: 'registry.unknown',
        outcome: Object.freeze({
          status: 'failed',
          failure: Object.freeze({
            code: 'registry',
            sanitizedSummary: 'Unknown or invalid AI task registration'
          })
        })
      })
    });
  }
}

/**
 * Get budget policy by ID
 * @param {string} policyId
 * @returns {AiBudgetSnapshot}
 * @throws {Error} If policy not found
 */
export function getBudgetPolicy(policyId) {
  const policy = BUDGET_POLICIES[policyId];
  if (!policy) {
    throw new Error(`Unknown budget policy: ${policyId}`);
  }
  return { ...policy }; // Return copy
}

/**
 * Validate and normalize budget snapshot
 * @param {Partial<AiBudgetSnapshot>} budget
 * @returns {AiBudgetSnapshot}
 * @throws {Error} If budget invalid
 */
export function validateBudget(budget) {
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) {
    throw new Error('Budget must be an object');
  }
  if (!Object.hasOwn(budget, 'policyId') || !budget.policyId) {
    throw new Error('Budget missing policyId');
  }

  const basePolicy = getBudgetPolicy(budget.policyId);
  const fields = [
    'policyId',
    'deadlineMs',
    'maxOutputTokens',
    'maxGenerationAttempts',
    'maxTransportAttemptsPerGeneration',
    'reasoningMode'
  ];
  for (const field of fields) {
    if (!Object.hasOwn(budget, field)) {
      throw new Error(`Budget missing ${field}`);
    }
  }

  // Validate numeric fields are finite positive integers
  const numericFields = ['deadlineMs', 'maxOutputTokens', 'maxGenerationAttempts', 'maxTransportAttemptsPerGeneration'];
  for (const field of numericFields) {
    const value = budget[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`Budget ${field} must be finite positive integer, got: ${value}`);
    }
  }

  for (const field of fields) {
    if (budget[field] !== basePolicy[field]) {
      throw new Error(`Budget ${field} must match registered policy ${budget.policyId}`);
    }
  }

  return { ...basePolicy };
}

/**
 * Validate context manifest
 * @param {AiContextManifest} manifest
 * @throws {Error} If manifest invalid
 */
export function validateContextManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Context manifest must be an object');
  }
  if (manifest.manifestVersion !== 1) {
    throw new Error(`Invalid manifest version: ${manifest.manifestVersion}`);
  }

  if (manifest.fullMapIncluded !== false) {
    throw new Error('fullMapIncluded must be false (Principle 3)');
  }

  if (!Array.isArray(manifest.items)) {
    throw new Error('Context manifest items must be an array');
  }

  for (const field of ['worldRevision', 'promptPackRevision']) {
    if (manifest[field] !== null && typeof manifest[field] !== 'string') {
      throw new Error(`${field} must be a string or null`);
    }
  }

  // Validate items
  const allowedKinds = ['system-instructions', 'scenario-rules', 'world-summary', 'map-semantics', 'events', 'actions', 'chat', 'campaign-memory', 'country-dossier', 'user-input', 'retry-feedback'];

  let totalCalculated = 0;
  for (const item of manifest.items) {
    if (!allowedKinds.includes(item.kind)) {
      throw new Error(`Invalid context item kind: ${item.kind}`);
    }

    if (!Number.isInteger(item.itemCount) || item.itemCount < 0) {
      throw new Error(`Invalid itemCount for ${item.kind}: ${item.itemCount}`);
    }

    if (!Number.isInteger(item.characterCount) || item.characterCount < 0) {
      throw new Error(`Invalid characterCount for ${item.kind}: ${item.characterCount}`);
    }

    if (typeof item.truncated !== 'boolean') {
      throw new Error(`Invalid truncated for ${item.kind}: ${item.truncated}`);
    }

    if (item.sourceRevision !== null && typeof item.sourceRevision !== 'string') {
      throw new Error(`Invalid sourceRevision for ${item.kind}`);
    }

    totalCalculated += item.characterCount;
  }

  if (manifest.totalCharacterCount !== totalCalculated) {
    throw new Error(`totalCharacterCount (${manifest.totalCharacterCount}) does not match sum of item characterCounts (${totalCalculated})`);
  }
}

/**
 * Create a new context manifest
 * @param {Array<{
 *   kind: AiContextManifest['items'][0]['kind'],
 *   itemCount: number,
 *   characterCount: number,
 *   truncated?: boolean,
 *   sourceRevision?: string|null
 * }>} items
 * @param {string|null} worldRevision
 * @param {string|null} promptPackRevision
 * @returns {AiContextManifest}
 */
export function createContextManifest(items, worldRevision = null, promptPackRevision = null) {
  const totalCharacterCount = items.reduce((sum, item) => sum + item.characterCount, 0);

  const manifest = {
    manifestVersion: 1,
    worldRevision,
    promptPackRevision,
    items: items.map(item => ({
      kind: item.kind,
      itemCount: item.itemCount,
      characterCount: item.characterCount,
      truncated: item.truncated ?? false,
      sourceRevision: item.sourceRevision ?? null
    })),
    totalCharacterCount,
    fullMapIncluded: false
  };

  validateContextManifest(manifest);
  return manifest;
}

/**
 * Check if task ID is known (for production safety path)
 * @param {string} taskId
 * @returns {boolean}
 */
export function isTaskKnown(taskId) {
  return TASK_DEFINITIONS.some(t => t.taskId === taskId);
}

/**
 * Get all task definitions (read-only)
 * @returns {ReadonlyArray<AiTaskDefinition>}
 */
export function getAllTaskDefinitions() {
  return Object.freeze(TASK_DEFINITIONS.map((task) => Object.freeze({
    ...task,
    allowedVariants: Object.freeze([...task.allowedVariants])
  })));
}

/**
 * Get all budget policies (read-only)
 * @returns {Readonly<Record<string, AiBudgetSnapshot>>}
 */
export function getAllBudgetPolicies() {
  return Object.freeze(Object.fromEntries(
    Object.entries(BUDGET_POLICIES).map(([key, policy]) => [key, Object.freeze({ ...policy })])
  ));
}

export default {
  validateTask,
  resolveTaskForDispatch,
  getBudgetPolicy,
  validateBudget,
  validateContextManifest,
  createContextManifest,
  isTaskKnown,
  getAllTaskDefinitions,
  getAllBudgetPolicies
};
