// Canonical six-projection world revision core.
// Exports one frozen canonical six-key list and pure validation/comparison functions.
// No writes, notifications, filesystem, IndexedDB, provider or global-state actions.

// --- Constants and types (mirroring atomic-world-revision.md) ---

/**
 * The six canonical projection keys.
 * @type {readonly string[]}
 */
export const WORLD_PROJECTION_KEYS = Object.freeze([
  "actions",
  "chat",
  "events",
  "game",
  "world",
  "colors",
]);

/**
 * @typedef {typeof WORLD_PROJECTION_KEYS[number]} WorldProjectionKey
 */

/**
 * @typedef {object} ProjectionDescriptor
 * @property {string} checksum - SHA-256 hex digest of canonical UTF-8 bytes
 * @property {number} byteLength - Length of canonical UTF-8 bytes
 */

/**
 * @typedef {object} WorldRevisionManifestV1
 * @property {string} schema - "open-historia-world-revision/1"
 * @property {string} gameId - Non‑blank game identifier
 * @property {string} revision - Opaque revision identifier
 * @property {string|null} parentRevision - Parent revision or null for root
 * @property {string} committedAt - ISO‑8601 timestamp
 * @property {"turn"|"pregame"|"rollback"|"compat-write"} reason - Revision reason
 * @property {string|null} rollbackOf - For rollback revisions, the rolled‑back revision
 * @property {Record<WorldProjectionKey, ProjectionDescriptor>} projections - Descriptors for all six projections
 */

/**
 * @typedef {object} AtomicWorldBundle
 * @property {WorldRevisionManifestV1} manifest
 * @property {Record<WorldProjectionKey, unknown>} projections
 */

/**
 * @typedef {object} CommitWorldRevisionRequest
 * @property {string} gameId
 * @property {string|null} expectedRevision
 * @property {WorldRevisionManifestV1["reason"]} reason
 * @property {string|null} [rollbackOf]
 * @property {Record<WorldProjectionKey, unknown>} projections
 */

/**
 * @typedef {object} CommitSuccess
 * @property {"committed"} status
 * @property {AtomicWorldBundle} bundle
 */

/**
 * @typedef {object} CommitConflict
 * @property {"conflict"} status
 * @property {string|null} currentRevision
 */

/**
 * @typedef {CommitSuccess|CommitConflict} CommitWorldRevisionResult
 */

// --- Error types ---

export class WorldRevisionError extends Error {
  /**
   * @param {string} code - Machine-readable error code
   * @param {string} message - Human-readable message
   * @param {string} [path] - JSON path to offending value
   */
  constructor(code, message, path) {
    super(message);
    this.name = "WorldRevisionError";
    this.code = code;
    this.path = path;
  }
}

// --- SHA‑256 for browser/WebView and Node (crypto.subtle.digest) ---

/**
 * SHA-256 hex digest of UTF-8 bytes.
 * Works in browser/WebView and Node.js ≥15.
 * @param {string|Uint8Array} input - UTF-8 string or exact bytes
 * @returns {Promise<string>} Hex digest
 */
async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Canonical JSON serialization and validation ---

/**
 * Determines whether a value is supported in canonical JSON.
 * Canonical JSON must be serializable with deterministic order,
 * no undefined, functions, symbols, non-finite numbers, or sparse arrays.
 * @param {unknown} value - Value to check
 * @param {string} [path] - Current JSON path for diagnostics
 * @returns {string[]} Array of error messages, empty if valid
 */
function validateCanonicalValue(value, path = "", ancestors = new Set()) {
  const errors = [];

  if (value === undefined) {
    errors.push(`undefined at ${path || "(root)"}`);
    return errors;
  }

  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(`${typeof value} at ${path || "(root)"}`);
    return errors;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push(`non-finite number (${value}) at ${path || "(root)"}`);
    return errors;
  }

  if (value === null) {
    return errors; // null is valid JSON
  }

  if (typeof value === "object") {
    if (ancestors.has(value)) {
      errors.push(`cyclic reference at ${path || "(root)"}`);
      return errors;
    }
    ancestors.add(value);

    if (Array.isArray(value)) {
      // Check for sparse arrays - length should equal number of own enumerable properties with integer keys
      const ownKeys = Object.keys(value).filter(k => {
        const n = Number(k);
        return Number.isInteger(n) && n >= 0 && n < value.length;
      });
      if (value.length !== ownKeys.length) {
        errors.push(`sparse array at ${path || "(root)"}`);
      }
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateCanonicalValue(value[i], path ? `${path}[${i}]` : `[${i}]`, ancestors));
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        errors.push(`non-plain object at ${path || "(root)"}`);
        ancestors.delete(value);
        return errors;
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        errors.push(`symbol-keyed property at ${path || "(root)"}`);
      }
      let unsupportedDescriptor = false;
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (descriptor.get || descriptor.set) {
          errors.push(`accessor property at ${path ? `${path}.${key}` : key}`);
          unsupportedDescriptor = true;
        } else if (!descriptor.enumerable) {
          errors.push(`non-enumerable property at ${path ? `${path}.${key}` : key}`);
          unsupportedDescriptor = true;
        }
      }
      if (unsupportedDescriptor) {
        ancestors.delete(value);
        return errors;
      }
      for (const [key, val] of Object.entries(value)) {
        errors.push(...validateCanonicalValue(val, path ? `${path}.${key}` : key, ancestors));
      }
    }
    ancestors.delete(value);
  }

  return errors;
}

/**
 * Serializes a value to canonical JSON with deterministic key order.
 * Rejects unsupported values before serialization.
 * @param {unknown} value - Value to canonicalize
 * @returns {Promise<{bytes: Uint8Array, canonical: string}>} Canonical UTF‑8 bytes and string
 * @throws {WorldRevisionError} If value contains unsupported JSON
 */
async function canonicalizeProjection(value) {
  const validationErrors = validateCanonicalValue(value);
  if (validationErrors.length > 0) {
    throw new WorldRevisionError(
      "INVALID_JSON_VALUE",
      `Projection contains unsupported JSON values: ${validationErrors.join(", ")}`,
      validationErrors[0].split(" at ")[1] || ""
    );
  }

  // Ensure deterministic key order by recursively sorting object keys
  function canonicalize(value) {
    if (value === null || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }

    // Plain object - sort keys alphabetically
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }

  const canonical = canonicalize(value);
  const json = JSON.stringify(canonical);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);

  return { bytes, canonical: json };
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

// --- Projection bundle validation ---

/**
 * Validates a projection bundle contains exactly the six canonical keys.
 * @param {Record<WorldProjectionKey, unknown>} projections
 * @throws {WorldRevisionError} If keys are missing, extra, or malformed
 */
function validateProjectionKeys(projections) {
  if (typeof projections !== "object" || projections === null) {
    throw new WorldRevisionError(
      "INVALID_PROJECTIONS",
      "Projections must be an object",
      ""
    );
  }

  const keys = new Set(Object.keys(projections));
  const expected = new Set(WORLD_PROJECTION_KEYS);

  // Check for missing keys
  for (const key of expected) {
    if (!keys.has(key)) {
      throw new WorldRevisionError(
        "MISSING_PROJECTION",
        `Missing required projection: ${key}`,
        ""
      );
    }
  }

  // Check for extra keys
  for (const key of keys) {
    if (!expected.has(key)) {
      throw new WorldRevisionError(
        "EXTRA_PROJECTION",
        `Extra projection not allowed: ${key}`,
        ""
      );
    }
  }

  // Check that values are not null/undefined (they can be empty objects/arrays)
  for (const key of WORLD_PROJECTION_KEYS) {
    if (projections[key] === undefined) {
      throw new WorldRevisionError(
        "UNDEFINED_PROJECTION",
        `Projection ${key} must not be undefined`,
        key
      );
    }
  }
}

/**
 * Computes descriptors for all six projections.
 * @param {Record<WorldProjectionKey, unknown>} projections
 * @returns {Promise<Record<WorldProjectionKey, ProjectionDescriptor>>}
 * @throws {WorldRevisionError} If any projection fails canonicalization
 */
async function computeProjectionDescriptors(projections) {
  validateProjectionKeys(projections);

  const descriptors = /** @type {Record<WorldProjectionKey, ProjectionDescriptor>} */ ({});

  for (const key of WORLD_PROJECTION_KEYS) {
    const { bytes } = await canonicalizeProjection(projections[key]);
    const checksum = await sha256Hex(bytes);

    descriptors[key] = {
      checksum,
      byteLength: bytes.byteLength,
    };
  }

  return descriptors;
}

// --- Manifest validation ---

const MANIFEST_KEYS = Object.freeze([
  "schema",
  "gameId",
  "revision",
  "parentRevision",
  "committedAt",
  "reason",
  "rollbackOf",
  "projections",
]);

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isCanonicalOpaqueToken(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isValidCommittedAt(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHourText !== undefined) {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return true;
}

function validateDescriptorMap(descriptors, pathPrefix = "projections") {
  if (typeof descriptors !== "object" || descriptors === null || Array.isArray(descriptors)) {
    throw new WorldRevisionError("INVALID_PROJECTIONS_FIELD", "projections must be an object", pathPrefix);
  }
  for (const key of WORLD_PROJECTION_KEYS) {
    if (!(key in descriptors)) {
      throw new WorldRevisionError("MISSING_PROJECTION_DESCRIPTOR", `Missing descriptor for projection: ${key}`, `${pathPrefix}.${key}`);
    }
  }
  const extraKeys = Object.keys(descriptors).filter(key => !WORLD_PROJECTION_KEYS.includes(key));
  if (extraKeys.length > 0) {
    throw new WorldRevisionError("EXTRA_PROJECTION_DESCRIPTOR", `Extra projection descriptors not allowed: ${extraKeys.join(", ")}`, pathPrefix);
  }
  for (const key of WORLD_PROJECTION_KEYS) {
    const desc = descriptors[key];
    if (typeof desc !== "object" || desc === null || Array.isArray(desc)) {
      throw new WorldRevisionError("INVALID_DESCRIPTOR", `Descriptor for ${key} must be an object`, `${pathPrefix}.${key}`);
    }
    if (!hasExactKeys(desc, ["checksum", "byteLength"])) {
      throw new WorldRevisionError("INVALID_DESCRIPTOR_KEYS", `Descriptor for ${key} has unexpected fields`, `${pathPrefix}.${key}`);
    }
    if (typeof desc.checksum !== "string" || !/^[a-f0-9]{64}$/.test(desc.checksum)) {
      throw new WorldRevisionError("INVALID_CHECKSUM", `checksum for ${key} must be a 64-character hex string`, `${pathPrefix}.${key}.checksum`);
    }
    if (typeof desc.byteLength !== "number" || !Number.isSafeInteger(desc.byteLength) || desc.byteLength < 0) {
      throw new WorldRevisionError("INVALID_BYTE_LENGTH", `byteLength for ${key} must be a non-negative safe integer`, `${pathPrefix}.${key}.byteLength`);
    }
  }
}

/**
 * Validates a manifest against schema invariants.
 * @param {unknown} manifest - Candidate manifest
 * @returns {WorldRevisionManifestV1} Validated manifest
 * @throws {WorldRevisionError} If manifest is invalid
 */
function validateManifest(manifest) {
  if (typeof manifest !== "object" || manifest === null) {
    throw new WorldRevisionError("INVALID_MANIFEST", "Manifest must be an object", "");
  }

  const canonicalErrors = validateCanonicalValue(manifest);
  if (canonicalErrors.length > 0) {
    throw new WorldRevisionError("INVALID_MANIFEST_VALUE", canonicalErrors[0], "");
  }

  const m = /** @type {any} */ (manifest);

  if (!hasExactKeys(m, MANIFEST_KEYS)) {
    throw new WorldRevisionError("INVALID_MANIFEST_KEYS", "Manifest must contain exactly the accepted fields", "");
  }

  if (m.schema !== "open-historia-world-revision/1") {
    throw new WorldRevisionError("INVALID_SCHEMA", 'schema must be "open-historia-world-revision/1"', "schema");
  }

  if (!isCanonicalOpaqueToken(m.gameId)) {
    throw new WorldRevisionError("INVALID_GAME_ID", "gameId must be a non‑blank string", "gameId");
  }

  if (!isCanonicalOpaqueToken(m.revision)) {
    throw new WorldRevisionError("INVALID_REVISION", "revision must be a non‑blank string", "revision");
  }

  if (m.parentRevision !== null && !isCanonicalOpaqueToken(m.parentRevision)) {
    throw new WorldRevisionError("INVALID_PARENT_REVISION", "parentRevision must be null or a non‑blank string", "parentRevision");
  }

  if (!isValidCommittedAt(m.committedAt)) {
    throw new WorldRevisionError("INVALID_COMMITTED_AT", "committedAt must be a valid ISO‑8601 timestamp", "committedAt");
  }

  const validReasons = new Set(["turn", "pregame", "rollback", "compat-write"]);
  if (!validReasons.has(m.reason)) {
    throw new WorldRevisionError("INVALID_REASON", `reason must be one of: ${Array.from(validReasons).join(", ")}`, "reason");
  }

  if (m.rollbackOf !== null && !isCanonicalOpaqueToken(m.rollbackOf)) {
    throw new WorldRevisionError("INVALID_ROLLBACK_OF", "rollbackOf must be null or a non‑blank string", "rollbackOf");
  }

  // rollbackOf must be null unless reason is "rollback"
  if (m.reason !== "rollback" && m.rollbackOf !== null) {
    throw new WorldRevisionError("INVALID_ROLLBACK_OF", "rollbackOf must be null when reason is not 'rollback'", "rollbackOf");
  }
  if (m.reason === "rollback" && m.rollbackOf === null) {
    throw new WorldRevisionError("INVALID_ROLLBACK_OF", "rollbackOf must be non‑null when reason is 'rollback'", "rollbackOf");
  }

  validateDescriptorMap(m.projections);

  return /** @type {WorldRevisionManifestV1} */ (m);
}

/**
 * Validates that projection bytes match their descriptors.
 * @param {Record<WorldProjectionKey, unknown>} projections
 * @param {Record<WorldProjectionKey, ProjectionDescriptor>} descriptors
 * @throws {WorldRevisionError} If any projection fails verification
 */
async function verifyProjectionDescriptors(projections, descriptors) {
  validateProjectionKeys(projections);
  validateDescriptorMap(descriptors);
  for (const key of WORLD_PROJECTION_KEYS) {
    const { bytes } = await canonicalizeProjection(projections[key]);
    const actualChecksum = await sha256Hex(new TextDecoder().decode(bytes));
    const expected = descriptors[key];

    if (actualChecksum !== expected.checksum) {
      throw new WorldRevisionError(
        "CHECKSUM_MISMATCH",
        `Checksum mismatch for projection ${key}: expected ${expected.checksum.slice(0, 16)}..., got ${actualChecksum.slice(0, 16)}...`,
        key
      );
    }

    if (bytes.byteLength !== expected.byteLength) {
      throw new WorldRevisionError(
        "BYTE_LENGTH_MISMATCH",
        `Byte length mismatch for projection ${key}: expected ${expected.byteLength}, got ${bytes.byteLength}`,
        key
      );
    }
  }
}

// --- Bundle construction ---

/**
 * Builds a complete validated atomic world bundle.
 * @param {object} params
 * @param {string} params.gameId - Non‑blank game identifier
 * @param {string} params.revision - Opaque revision identifier
 * @param {string|null} params.parentRevision - Parent revision or null for root
 * @param {string} params.committedAt - ISO‑8601 timestamp (injected, not generated)
 * @param {"turn"|"pregame"|"rollback"|"compat-write"} params.reason - Revision reason
 * @param {string|null} params.rollbackOf - For rollback revisions, the rolled‑back revision
 * @param {Record<WorldProjectionKey, unknown>} params.projections - Six projection values
 * @returns {Promise<AtomicWorldBundle>} Validated immutable bundle
 * @throws {WorldRevisionError} If validation fails
 */
export async function buildWorldBundle({
  gameId,
  revision,
  parentRevision,
  committedAt,
  reason,
  rollbackOf = null,
  projections,
}) {
  // Validate basic parameters
  if (!isCanonicalOpaqueToken(gameId)) {
    throw new WorldRevisionError("INVALID_GAME_ID", "gameId must be a non‑blank string", "gameId");
  }
  if (!isCanonicalOpaqueToken(revision)) {
    throw new WorldRevisionError("INVALID_REVISION", "revision must be a non‑blank string", "revision");
  }
  if (parentRevision !== null && !isCanonicalOpaqueToken(parentRevision)) {
    throw new WorldRevisionError("INVALID_PARENT_REVISION", "parentRevision must be null or a non‑blank string", "parentRevision");
  }
  if (!isValidCommittedAt(committedAt)) {
    throw new WorldRevisionError("INVALID_COMMITTED_AT", "committedAt must be a valid ISO‑8601 timestamp", "committedAt");
  }
  const validReasons = new Set(["turn", "pregame", "rollback", "compat-write"]);
  if (!validReasons.has(reason)) {
    throw new WorldRevisionError("INVALID_REASON", `reason must be one of: ${Array.from(validReasons).join(", ")}`, "reason");
  }
  if (rollbackOf !== null && !isCanonicalOpaqueToken(rollbackOf)) {
    throw new WorldRevisionError("INVALID_ROLLBACK_OF", "rollbackOf must be null or a non‑blank string", "rollbackOf");
  }
  if (reason !== "rollback" && rollbackOf !== null) {
    throw new WorldRevisionError("INVALID_ROLLBACK_OF", "rollbackOf must be null when reason is not 'rollback'", "rollbackOf");
  }
  if (reason === "rollback" && rollbackOf === null) {
    throw new WorldRevisionError("INVALID_ROLLBACK_OF", "rollbackOf must be non‑null when reason is 'rollback'", "rollbackOf");
  }

  validateProjectionKeys(projections);
  const normalizedProjections = /** @type {Record<WorldProjectionKey, unknown>} */ ({});
  const descriptors = /** @type {Record<WorldProjectionKey, ProjectionDescriptor>} */ ({});
  for (const key of WORLD_PROJECTION_KEYS) {
    const { bytes, canonical } = await canonicalizeProjection(projections[key]);
    normalizedProjections[key] = deepFreeze(JSON.parse(canonical));
    descriptors[key] = deepFreeze({
      checksum: await sha256Hex(bytes),
      byteLength: bytes.byteLength,
    });
  }
  deepFreeze(descriptors);
  deepFreeze(normalizedProjections);

  // Build manifest
  const manifest = /** @type {WorldRevisionManifestV1} */ ({
    schema: "open-historia-world-revision/1",
    gameId,
    revision,
    parentRevision,
    committedAt,
    reason,
    rollbackOf,
    projections: descriptors,
  });

  // Verify manifest passes its own validation
  validateManifest(manifest);

  // Return frozen bundle
  return deepFreeze({
    manifest,
    projections: normalizedProjections,
  });
}

// --- Compare‑and‑swap planning ---

/**
 * Pure compare‑and‑swap planning operation.
 * Validates the complete candidate but performs no write.
 * @param {object} params
 * @param {string} params.gameId - Game identifier
 * @param {string|null} params.expectedRevision - Revision advertised by the caller
 * @param {string} params.newRevision - Opaque identifier for the candidate revision (injected)
 * @param {string|null} params.currentRevision - Actual current revision (injected)
 * @param {string} params.committedAt - ISO‑8601 timestamp (injected)
 * @param {CommitWorldRevisionRequest} params.request - Commit request
 * @returns {Promise<CommitWorldRevisionResult>}
 * @throws {WorldRevisionError} If validation fails (not a conflict)
 */
export async function planWorldRevisionCommit({
  gameId,
  expectedRevision,
  newRevision,
  currentRevision,
  committedAt,
  request,
}) {
  if (typeof request !== "object" || request === null) {
    throw new WorldRevisionError("INVALID_REQUEST", "request must be an object", "request");
  }

  // Game ID must match
  if (gameId !== request.gameId) {
    throw new WorldRevisionError(
      "GAME_ID_MISMATCH",
      `gameId mismatch: expected ${gameId}, got ${request.gameId}`,
      "gameId"
    );
  }

  if (request.expectedRevision !== expectedRevision) {
    throw new WorldRevisionError(
      "EXPECTED_REVISION_MISMATCH",
      "request.expectedRevision must match the advertised expectedRevision",
      "expectedRevision"
    );
  }

  for (const [path, revisionValue] of [["expectedRevision", expectedRevision], ["currentRevision", currentRevision]]) {
    if (revisionValue !== null && !isCanonicalOpaqueToken(revisionValue)) {
      throw new WorldRevisionError("INVALID_REVISION", `${path} must be null or a canonical non-blank token`, path);
    }
  }

  // Check for conflict first (before expensive canonicalization)
  if (currentRevision !== expectedRevision) {
    return {
      status: "conflict",
      currentRevision,
    };
  }

  // Build the complete bundle (validates everything)
  const bundle = await buildWorldBundle({
    gameId,
    revision: newRevision,
    parentRevision: currentRevision,
    committedAt,
    reason: request.reason,
    rollbackOf: request.rollbackOf ?? null,
    projections: request.projections,
  });

  // Verify the new revision is different from parent (except for root where parent is null)
  if (currentRevision !== null && bundle.manifest.revision === currentRevision) {
    throw new WorldRevisionError(
      "REVISION_COLLISION",
      "New revision must differ from parent revision",
      "revision"
    );
  }

  return {
    status: "committed",
    bundle,
  };
}

// --- Utility exports for testing and adapters ---

export {
  sha256Hex,
  validateCanonicalValue,
  canonicalizeProjection,
  validateProjectionKeys,
  computeProjectionDescriptors,
  validateManifest,
  validateDescriptorMap,
  verifyProjectionDescriptors,
};
