/*! Open Historia — atomic world revision filesystem adapter.
 *  Canonical six-projection world state, staged durably off the current
 *  pointer, descriptor-verified, then published via atomic pointer rename. */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "./dataDir.js";

// Core validation/comparison primitives (pure, no side effects).
import {
  WORLD_PROJECTION_KEYS,
  WorldRevisionError,
  validateManifest,
  validateProjectionKeys,
  verifyProjectionDescriptors,
  planWorldRevisionCommit,
  buildWorldBundle,
  canonicalizeProjection,
} from "../src/runtime/worldRevisionCore.js";

export {
  WORLD_PROJECTION_KEYS,
  WorldRevisionError,
  validateManifest,
  validateProjectionKeys,
  verifyProjectionDescriptors,
  planWorldRevisionCommit,
};

// --- Constants ---

const REVISION_STORE_SUBDIR = "revisions";
const CURRENT_POINTER_FILE = "current-revision.json";
const MANIFEST_FILE = "manifest.json";

// --- Path utilities ---

function getGameRootPath(gameId) {
  assertPathToken(gameId, "gameId");
  return path.join(DATA_DIR, "games", gameId);
}

function getGameRevisionStorePath(gameId) {
  return path.join(getGameRootPath(gameId), REVISION_STORE_SUBDIR);
}

function getRevisionDirectory(gameId, revision) {
  assertPathToken(revision, "revision");
  return path.join(getGameRevisionStorePath(gameId), revision);
}

function getManifestPath(gameId, revision) {
  return path.join(getRevisionDirectory(gameId, revision), MANIFEST_FILE);
}

function getProjectionPath(gameId, revision, projectionKey) {
  if (!WORLD_PROJECTION_KEYS.includes(projectionKey)) {
    throw new WorldRevisionError("INVALID_PROJECTION_KEY", `Unknown projection ${projectionKey}`, "projectionKey");
  }
  return path.join(getRevisionDirectory(gameId, revision), `${projectionKey}.json`);
}

function getCurrentPointerPath(gameId) {
  return path.join(getGameRootPath(gameId), CURRENT_POINTER_FILE);
}

function getLegacyStoragePath(gameId) {
  return path.join(getGameRootPath(gameId), "storage");
}

function getLegacyGameJsonPath(gameId, assetKey) {
  return path.join(getLegacyStoragePath(gameId), `${assetKey}.json`);
}

// --- File system utilities ---

function assertPathToken(value, field) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new WorldRevisionError("INVALID_PATH_TOKEN", `${field} must be a safe opaque path token`, field);
  }
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonFile(filePath, data) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function writeExactFile(filePath, bytes) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, bytes, { flag: "wx" });
}

function readJsonFile(filePath, defaultValue = null) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT" && defaultValue !== null) {
      return defaultValue;
    }
    throw error;
  }
}

function atomicRename(source, target) {
  // fs.renameSync is atomic on POSIX and the best available primitive on
  // Windows when replacing files within the same filesystem.
  fs.renameSync(source, target);
}

// Durability is part of the publication contract. File sync failures are never
// ignored. A few platforms reject directory fsync even though file fsync is
// supported; only those explicit unsupported-operation codes are tolerated.
function fsyncFileWithParent(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(path.dirname(filePath));
}

function fsyncDirectory(directoryPath) {
  try {
    const dirFd = fs.openSync(directoryPath, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (error) {
    if (!["EINVAL", "EPERM", "ENOTSUP", "EISDIR"].includes(error?.code)) {
      throw error;
    }
  }
}

let testHooks = Object.freeze({});

/**
 * Installs deterministic pause/failure hooks into the real production adapter.
 * Intended for contract tests; an empty object restores normal production use.
 */
export function setWorldRevisionFilesystemTestHooks(hooks = {}) {
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new TypeError("filesystem revision hooks must be an object");
  }
  const previous = testHooks;
  testHooks = Object.freeze({ ...hooks });
  return () => {
    testHooks = previous;
  };
}

async function runHook(name, context) {
  const hook = testHooks[name];
  if (hook !== undefined) {
    if (typeof hook !== "function") throw new TypeError(`hook ${name} must be a function`);
    await hook(Object.freeze({ ...context }));
  }
}

// --- Current pointer management ---

function readCurrentRevision(gameId) {
  const pointerPath = getCurrentPointerPath(gameId);
  try {
    const pointer = readJsonFile(pointerPath, null);
    if (pointer && typeof pointer === "object" && pointer.revision) {
      return pointer.revision;
    }
  } catch {
    // Unreadable pointer is treated as "no current revision".
  }
  return null;
}

// --- Per-game commit serialization (compare-and-swap boundary) ---

// A single-process mutex per game. Plan/validate and publish happen inside the
// critical section so two commits based on the same expectedRevision cannot
// both win. Cross-process locking is out of scope; on the embedded server a
// single Node process is the writer, matching the single-player contract.
const gameCommitGates = new Map();

function acquireCommitGate(gameId) {
  const previous = gameCommitGates.get(gameId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  gameCommitGates.set(gameId, tail);
  return previous.then(() => ({
    release() {
      release();
      if (gameCommitGates.get(gameId) === tail) gameCommitGates.delete(gameId);
    },
  }));
}

// --- Legacy compatibility ---

function hasLegacyStorage(gameId) {
  return fs.existsSync(getLegacyStoragePath(gameId));
}

function readLegacyProjections(gameId) {
  const projections = {};
  for (const key of WORLD_PROJECTION_KEYS) {
    const filePath = getLegacyGameJsonPath(gameId, key);
    try {
      projections[key] = readJsonFile(filePath, {});
    } catch {
      projections[key] = {};
    }
  }
  return projections;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const parts = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

function legacyRevisionId(gameId, projections) {
  const hash = crypto.createHash("sha256");
  hash.update(gameId);
  for (const key of WORLD_PROJECTION_KEYS) {
    hash.update(stableStringify(projections[key]));
  }
  return `legacy-${hash.digest("hex").slice(0, 16)}`;
}

function legacyCommittedAt(gameId) {
  let mtimeMs = 0;
  for (const key of WORLD_PROJECTION_KEYS) {
    try {
      const stat = fs.statSync(getLegacyGameJsonPath(gameId, key));
      mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
    } catch {
      // Missing file — keep current max.
    }
  }
  return new Date(mtimeMs > 0 ? mtimeMs : 0).toISOString();
}

// A game with only legacy per-projection storage is exposed as a synthetic
// "legacy-*" baseline so readers always receive a coherent bundle.
async function synthesizeLegacyBaseline(gameId) {
  const projections = readLegacyProjections(gameId);
  const revision = legacyRevisionId(gameId, projections);
  return buildWorldBundle({
    gameId,
    revision,
    parentRevision: null,
    committedAt: legacyCommittedAt(gameId),
    reason: "compat-write",
    rollbackOf: null,
    projections,
  });
}

// Resolves the revision a compare-and-swap should race against. A game without
// a published pointer but with legacy storage races against its deterministic
// legacy baseline id, so a compatibility writer that loaded that baseline can
// commit against it, and two racing writers produce exactly one winner.
function resolveCurrentRevisionForCas(gameId) {
  const pointer = readCurrentRevision(gameId);
  if (pointer) {
    return pointer;
  }
  if (hasLegacyStorage(gameId)) {
    return legacyRevisionId(gameId, readLegacyProjections(gameId));
  }
  return null;
}

// --- Revision bundle storage ---

async function loadRevisionBundle(gameId, revision) {
  assertPathToken(gameId, "gameId");
  assertPathToken(revision, "revision");
  const manifestPath = getManifestPath(gameId, revision);
  if (!fs.existsSync(manifestPath)) {
    throw new WorldRevisionError(
      "INVALID_MANIFEST",
      `Manifest not found for revision ${revision}`,
      ""
    );
  }
  const manifest = readJsonFile(manifestPath);
  const validatedManifest = validateManifest(manifest);
  if (validatedManifest.gameId !== gameId) {
    throw new WorldRevisionError("GAME_ID_MISMATCH", `Manifest belongs to ${validatedManifest.gameId}, not ${gameId}`, "gameId");
  }
  if (validatedManifest.revision !== revision) {
    throw new WorldRevisionError("REVISION_PATH_MISMATCH", `Manifest revision ${validatedManifest.revision} does not match directory ${revision}`, "revision");
  }

  const projections = {};
  for (const key of WORLD_PROJECTION_KEYS) {
    const projectionPath = getProjectionPath(gameId, revision, key);
    if (!fs.existsSync(projectionPath)) {
      throw new WorldRevisionError(
        "MISSING_PROJECTION",
        `Projection ${key} missing for revision ${revision}`,
        key
      );
    }
    projections[key] = readJsonFile(projectionPath);
  }

  // A revision is complete only when every stored projection verifies against
  // the manifest descriptors.
  await verifyProjectionDescriptors(projections, validatedManifest.projections);

  return {
    manifest: validatedManifest,
    projections,
  };
}

// Stages a complete bundle into a `.tmp` directory, verifies the stored bytes
// against the manifest descriptors, then atomically renames it into place.
async function stageAndVerifyRevision(gameId, bundle) {
  const revision = bundle.manifest.revision;
  const tempDir = getRevisionDirectory(gameId, `${revision}.tmp`);
  const finalDir = getRevisionDirectory(gameId, revision);

  if (fs.existsSync(finalDir)) {
    throw new WorldRevisionError("REVISION_COLLISION", `Revision ${revision} already exists`, "revision");
  }
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  ensureDirectory(tempDir);

  await runHook("beforeStageWrites", { gameId, revision });
  writeJsonFile(path.join(tempDir, MANIFEST_FILE), bundle.manifest);
  await runHook("afterManifestWrite", { gameId, revision });
  for (const key of WORLD_PROJECTION_KEYS) {
    const { bytes } = await canonicalizeProjection(bundle.projections[key]);
    writeExactFile(path.join(tempDir, `${key}.json`), bytes);
    await runHook("afterProjectionWrite", { gameId, revision, projectionKey: key });
  }

  // Make staged bytes durable while still unreachable from the pointer.
  for (const key of WORLD_PROJECTION_KEYS) {
    fsyncFileWithParent(path.join(tempDir, `${key}.json`));
    await runHook("afterProjectionSync", { gameId, revision, projectionKey: key });
  }
  fsyncFileWithParent(path.join(tempDir, MANIFEST_FILE));
  await runHook("afterManifestSync", { gameId, revision });

  // Verify the bytes actually on disk round-trip to the published descriptors.
  const storedProjections = {};
  for (const key of WORLD_PROJECTION_KEYS) {
    storedProjections[key] = readJsonFile(path.join(tempDir, `${key}.json`));
  }
  await verifyProjectionDescriptors(storedProjections, bundle.manifest.projections);
  await runHook("afterStoredDescriptorVerification", { gameId, revision });

  atomicRename(tempDir, finalDir);
  fsyncDirectory(getGameRevisionStorePath(gameId));
  await runHook("afterRevisionDirectoryPublish", { gameId, revision });
}

async function publishCurrentRevision(gameId, revision) {
  const pointerPath = getCurrentPointerPath(gameId);
  const tempPointerPath = `${pointerPath}.tmp`;
  if (fs.existsSync(tempPointerPath)) fs.rmSync(tempPointerPath, { force: true });
  await runHook("beforePointerWrite", { gameId, revision });
  writeJsonFile(tempPointerPath, { revision });
  fsyncFileWithParent(tempPointerPath);
  await runHook("afterPointerSync", { gameId, revision });
  atomicRename(tempPointerPath, pointerPath);
  await runHook("afterPointerPublish", { gameId, revision });
  fsyncFileWithParent(pointerPath);
  await runHook("afterPointerDurable", { gameId, revision });
}

// --- Public API ---

/**
 * Reads the current coherent world revision bundle for a game.
 * @param {string} gameId - Game identifier
 * @returns {Promise<{manifest: Object, projections: Object}>}
 */
export async function readGameStateBundle(gameId) {
  assertPathToken(gameId, "gameId");
  const currentRevision = readCurrentRevision(gameId);

  if (currentRevision) {
    return loadRevisionBundle(gameId, currentRevision);
  }

  // No published revision yet: expose legacy per-projection saves as a
  // synthesized baseline, otherwise the game does not exist.
  if (hasLegacyStorage(gameId)) {
    return synthesizeLegacyBaseline(gameId);
  }

  throw new WorldRevisionError(
    "NO_CURRENT_REVISION",
    `No current revision for game ${gameId}`,
    ""
  );
}

/**
 * Commits a new world revision with compare-and-swap semantics.
 * @param {Object} request - Commit request
 * @param {string} request.gameId - Game identifier
 * @param {string|null} request.expectedRevision - Expected current revision
 * @param {string} request.reason - Revision reason
 * @param {string|null} request.rollbackOf - For rollback revisions
 * @param {Object} request.projections - Six projection values
 * @returns {Promise<{status: "committed", bundle: Object}|{status: "conflict", currentRevision: string|null}>}
 */
export async function commitWorldRevision(request) {
  if (typeof request !== "object" || request === null) {
    throw new WorldRevisionError("INVALID_REQUEST", "request must be an object", "request");
  }
  const {
    gameId,
    expectedRevision,
    reason,
    rollbackOf = null,
    projections,
  } = request;

  assertPathToken(gameId, "gameId");

  const { release } = await acquireCommitGate(gameId);
  try {
    // Read the published revision and compare-and-swap inside the transaction.
    const currentRevision = resolveCurrentRevisionForCas(gameId);

    // Step 2: the pure planner reports conflict before any byte is written.
    const planResult = await planWorldRevisionCommit({
      gameId,
      expectedRevision,
      newRevision: `rev-${crypto.randomBytes(8).toString("hex")}`,
      currentRevision,
      committedAt: new Date().toISOString(),
      request: {
        gameId,
        expectedRevision,
        reason,
        rollbackOf,
        projections,
      },
    });

    if (planResult.status === "conflict") {
      return planResult;
    }

    const { bundle } = planResult;
    await runHook("afterCompareAndSwap", { gameId, revision: bundle.manifest.revision, currentRevision });

    // Step 4/5: stage durably, verify descriptors, then publish the pointer.
    await stageAndVerifyRevision(gameId, bundle);
    await publishCurrentRevision(gameId, bundle.manifest.revision);

    // Return the exact canonical bytes that readers will observe, not the
    // caller-owned object passed into the pure planner.
    const storedBundle = await loadRevisionBundle(gameId, bundle.manifest.revision);

    return {
      status: "committed",
      bundle: storedBundle,
    };
  } finally {
    release();
  }
}

/**
 * Compatibility seam for one legacy per-asset write. It always reads and
 * commits the complete six-projection bundle through the same CAS transaction.
 */
export async function commitCompatibilityProjection({ gameId, expectedRevision, assetKey, value }) {
  assertPathToken(gameId, "gameId");
  if (!WORLD_PROJECTION_KEYS.includes(assetKey)) {
    throw new WorldRevisionError("INVALID_PROJECTION_KEY", `Unknown projection ${assetKey}`, "assetKey");
  }
  const current = await readGameStateBundle(gameId);
  return commitWorldRevision({
    gameId,
    expectedRevision,
    reason: "compat-write",
    projections: { ...current.projections, [assetKey]: value },
  });
}

/**
 * Lists available revisions for a game (for rollback UI).
 * @param {string} gameId - Game identifier
 * @returns {Promise<Array<Object>>}
 */
export async function listGameRevisions(gameId) {
  assertPathToken(gameId, "gameId");
  const revisions = [];
  const storePath = getGameRevisionStorePath(gameId);

  if (!fs.existsSync(storePath)) {
    return revisions;
  }

  const entries = fs.readdirSync(storePath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith(".tmp")) {
      continue;
    }

    try {
      assertPathToken(entry.name, "revision");
      const bundle = await loadRevisionBundle(gameId, entry.name);
      const validated = bundle.manifest;
      revisions.push({
        revision: validated.revision,
        parentRevision: validated.parentRevision,
        committedAt: validated.committedAt,
        reason: validated.reason,
        rollbackOf: validated.rollbackOf,
      });
    } catch {
      // Invalid, incomplete or corrupt revision — skip.
    }
  }

  return rankCompleteRevisions(revisions);
}

/**
 * Prunes old revisions while protecting current, parent, and rollback targets.
 * @param {string} gameId - Game identifier
 * @param {number} keepCount - Number of recent revisions to keep
 * @returns {Promise<number>} Number of revisions pruned
 */
export async function pruneOldRevisions(gameId, keepCount = 12) {
  assertPathToken(gameId, "gameId");
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new RangeError("keepCount must be a positive integer");
  }
  const allRevisions = await listGameRevisions(gameId);
  const currentRevision = readCurrentRevision(gameId);

  if (allRevisions.length <= keepCount) {
    return 0;
  }

  const protectedRevisions = new Set();

  if (currentRevision) {
    protectedRevisions.add(currentRevision);

    const currentInfo = allRevisions.find((r) => r.revision === currentRevision);
    if (currentInfo && currentInfo.parentRevision) {
      protectedRevisions.add(currentInfo.parentRevision);
    }

    for (const rev of allRevisions) {
      if (rev.rollbackOf) {
        protectedRevisions.add(rev.rollbackOf);
      }
    }
  }

  const sortedOldestFirst = [...allRevisions].reverse();

  const toPrune = [];
  for (let i = 0; i < sortedOldestFirst.length - keepCount; i++) {
    const rev = sortedOldestFirst[i];
    if (!protectedRevisions.has(rev.revision)) {
      toPrune.push(rev.revision);
    }
  }

  let prunedCount = 0;
  for (const revision of toPrune) {
    const revisionDir = getRevisionDirectory(gameId, revision);
    try {
      fs.rmSync(revisionDir, { recursive: true, force: true });
      prunedCount++;
    } catch {
      // Pruning is best-effort; a failed delete is reported by the caller.
    }
  }

  return prunedCount;
}

// --- Startup recovery ---

/**
 * Validates and recovers the current revision on startup.
 * @param {string} gameId - Game identifier
 * @returns {Promise<{revision: string|null, recovered: boolean}>}
 */
export async function recoverCurrentRevision(gameId) {
  assertPathToken(gameId, "gameId");
  const currentRevision = readCurrentRevision(gameId);

  if (!currentRevision) {
    // Pointer missing or cleared: fall back to the latest valid revision.
    const allRevisions = await listGameRevisions(gameId);
    if (allRevisions.length > 0) {
      const selected = selectDeepestCompleteRevision(allRevisions);
      await publishCurrentRevision(gameId, selected);
      return { revision: selected, recovered: true };
    }
    return { revision: null, recovered: false };
  }

  try {
    await loadRevisionBundle(gameId, currentRevision);
    return { revision: currentRevision, recovered: false };
  } catch {
    // Current revision incomplete or corrupt — recover from a valid ancestor.
    let parentRevision = null;
    try {
      const manifest = readJsonFile(getManifestPath(gameId, currentRevision), null);
      if (manifest && manifest.parentRevision) {
        parentRevision = manifest.parentRevision;
      }
    } catch {
      // Parent unavailable.
    }

    if (parentRevision) {
      try {
        await loadRevisionBundle(gameId, parentRevision);
        await publishCurrentRevision(gameId, parentRevision);
        return { revision: parentRevision, recovered: true };
      } catch {
        // Fall through to the latest valid revision search.
      }
    }

    const validRevisions = [];
    for (const rev of await listGameRevisions(gameId)) {
      if (rev.revision === currentRevision) continue;
      try {
        await loadRevisionBundle(gameId, rev.revision);
        validRevisions.push(rev);
      } catch {
        // Skip invalid revisions.
      }
    }

    if (validRevisions.length > 0) {
      const selected = selectDeepestCompleteRevision(validRevisions);
      await publishCurrentRevision(gameId, selected);
      return { revision: selected, recovered: true };
    }

    clearCurrentRevision(gameId);
    return { revision: null, recovered: true };
  }
}

function selectDeepestCompleteRevision(revisions) {
  return rankCompleteRevisions(revisions)[0].revision;
}

function rankCompleteRevisions(revisions) {
  const byId = new Map(revisions.map((revision) => [revision.revision, revision]));
  const memo = new Map();
  const visiting = new Set();
  function depth(revisionId) {
    if (memo.has(revisionId)) return memo.get(revisionId);
    if (visiting.has(revisionId)) return 0;
    visiting.add(revisionId);
    const revision = byId.get(revisionId);
    const result = revision?.parentRevision && byId.has(revision.parentRevision)
      ? depth(revision.parentRevision) + 1
      : 1;
    visiting.delete(revisionId);
    memo.set(revisionId, result);
    return result;
  }
  return [...revisions].sort((left, right) =>
    depth(right.revision) - depth(left.revision) || left.revision.localeCompare(right.revision));
}

function clearCurrentRevision(gameId) {
  const pointerPath = getCurrentPointerPath(gameId);
  if (fs.existsSync(pointerPath)) fs.rmSync(pointerPath, { force: true });
  ensureDirectory(path.dirname(pointerPath));
  fsyncDirectory(path.dirname(pointerPath));
}
