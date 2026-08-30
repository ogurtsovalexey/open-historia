import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { DATA_DIR } from "./dataDir.js";

// Import core types and functions
import {
  WORLD_PROJECTION_KEYS,
  WorldRevisionError,
  validateManifest,
  validateProjectionKeys,
  verifyProjectionDescriptors,
  planWorldRevisionCommit,
} from "../src/runtime/worldRevisionCore.js";

// Re-export core types and functions
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

function getGameRevisionStorePath(gameId) {
  return path.join(DATA_DIR, "games", gameId, REVISION_STORE_SUBDIR);
}

function getRevisionDirectory(gameId, revision) {
  return path.join(getGameRevisionStorePath(gameId), revision);
}

function getManifestPath(gameId, revision) {
  return path.join(getRevisionDirectory(gameId, revision), MANIFEST_FILE);
}

function getProjectionPath(gameId, revision, projectionKey) {
  return path.join(getRevisionDirectory(gameId, revision), `${projectionKey}.json`);
}

function getCurrentPointerPath(gameId) {
  return path.join(DATA_DIR, "games", gameId, CURRENT_POINTER_FILE);
}

function getLegacyGameJsonPath(gameId, assetKey) {
  return path.join(DATA_DIR, "games", gameId, "storage", `${assetKey}.json`);
}

// --- File system utilities ---

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonFile(filePath, data) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
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

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function atomicRename(source, target) {
  // fs.renameSync is atomic on POSIX systems when moving within the same filesystem
  // On Windows, it's the best we have for atomic file replacement
  fs.renameSync(source, target);
}

// --- Current pointer management ---

function readCurrentRevision(gameId) {
  const pointerPath = getCurrentPointerPath(gameId);
  try {
    const pointer = readJsonFile(pointerPath, null);
    if (pointer && typeof pointer === "object" && pointer.revision) {
      return pointer.revision;
    }
  } catch (error) {
    // Ignore parse errors, treat as no current revision
  }
  return null;
}

function writeCurrentRevision(gameId, revision) {
  const pointerPath = getCurrentPointerPath(gameId);
  writeJsonFile(pointerPath, { revision });
}

// --- Legacy compatibility ---

function hasRevisionManifest(gameId) {
  const currentRevision = readCurrentRevision(gameId);
  if (!currentRevision) return false;
  
  const manifestPath = getManifestPath(gameId, currentRevision);
  return fileExists(manifestPath);
}

function readLegacyProjections(gameId) {
  const projections = {};
  const projectionKeys = [
    "actions", "chat", "events", "game", "world", "colors"
  ];
  
  for (const key of projectionKeys) {
    const filePath = getLegacyGameJsonPath(gameId, key);
    try {
      projections[key] = readJsonFile(filePath, {});
    } catch (error) {
      projections[key] = {};
    }
  }
  
  return projections;
}

function synthesizeLegacyBaseline(gameId) {
  const projections = readLegacyProjections(gameId);
  
  // Generate a deterministic revision ID from the hash of all projections
  const encoder = new TextEncoder();
  const hasher = crypto.createHash("sha256");
  
  for (const key of Object.keys(projections).sort()) {
    const json = JSON.stringify(projections[key]);
    hasher.update(encoder.encode(json));
  }
  
  const revision = `legacy-${hasher.digest("hex").slice(0, 16)}`;
  const committedAt = new Date().toISOString();
  
  return {
    gameId,
    revision,
    parentRevision: null,
    committedAt,
    reason: "compat-write",
    rollbackOf: null,
    projections,
  };
}

// --- Revision bundle storage ---

async function storeRevisionBundle(gameId, bundle) {
  const revision = bundle.manifest.revision;
  const revisionDir = getRevisionDirectory(gameId, revision);
  
  // Ensure revision directory exists
  ensureDirectory(revisionDir);
  
  // Write manifest first
  const manifestPath = getManifestPath(gameId, revision);
  writeJsonFile(manifestPath, bundle.manifest);
  
  // Write each projection
  for (const [key, value] of Object.entries(bundle.projections)) {
    const projectionPath = getProjectionPath(gameId, revision, key);
    writeJsonFile(projectionPath, value);
  }
  
  // Make all files durable by calling fsync on directory (where supported)
  try {
    const dirFd = fs.openSync(revisionDir, "r");
    fs.fsyncSync(dirFd);
    fs.closeSync(dirFd);
  } catch (error) {
    // fsync may fail on some platforms, continue anyway
  }
}

async function loadRevisionBundle(gameId, revision) {
  const manifestPath = getManifestPath(gameId, revision);
  const manifest = readJsonFile(manifestPath);
  
  if (!manifest || manifest.schema !== "open-historia-world-revision/1") {
    throw new WorldRevisionError(
      "INVALID_MANIFEST",
      `Manifest not found or invalid schema for revision ${revision}`,
      ""
    );
  }
  
  // Load projections
  const projections = {};
  for (const key of Object.keys(manifest.projections)) {
    const projectionPath = getProjectionPath(gameId, revision, key);
    projections[key] = readJsonFile(projectionPath);
  }
  
  return {
    manifest: validateManifest(manifest),
    projections,
  };
}

// --- Public API ---

/**
 * Reads the current world revision bundle for a game.
 * @param {string} gameId - Game identifier
 * @returns {Promise<{manifest: Object, projections: Object}>}
 */
export async function readGameStateBundle(gameId) {
  // Check if game has revision storage
  if (!hasRevisionManifest(gameId)) {
    // Legacy game - synthesize baseline
    const baseline = synthesizeLegacyBaseline(gameId);
    return {
      manifest: baseline,
      projections: baseline.projections,
    };
  }
  
  const currentRevision = readCurrentRevision(gameId);
  if (!currentRevision) {
    throw new WorldRevisionError(
      "NO_CURRENT_REVISION",
      `No current revision for game ${gameId}`,
      ""
    );
  }
  
  return loadRevisionBundle(gameId, currentRevision);
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
  const {
    gameId,
    expectedRevision,
    reason,
    rollbackOf = null,
    projections,
  } = request;
  
  // Read current revision inside the transaction boundary
  const currentRevision = readCurrentRevision(gameId);
  
  // Use planWorldRevisionCommit for pure validation and conflict detection
  const { planWorldRevisionCommit } = await import("../src/runtime/worldRevisionCore.js");
  
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
  
  // We have a valid bundle to commit
  const { bundle } = planResult;
  
  // Stage the bundle in a temporary location first
  const revision = bundle.manifest.revision;
  const tempRevisionDir = getRevisionDirectory(gameId, `${revision}.tmp`);
  const finalRevisionDir = getRevisionDirectory(gameId, revision);
  
  try {
    // Write to temporary directory
    ensureDirectory(tempRevisionDir);
    
    // Write manifest
    const tempManifestPath = path.join(tempRevisionDir, MANIFEST_FILE);
    writeJsonFile(tempManifestPath, bundle.manifest);
    
    // Write projections
    for (const [key, value] of Object.entries(bundle.projections)) {
      const tempProjectionPath = path.join(tempRevisionDir, `${key}.json`);
      writeJsonFile(tempProjectionPath, value);
    }
    
    // Make temporary files durable
    try {
      const dirFd = fs.openSync(tempRevisionDir, "r");
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch (error) {
      // Continue if fsync fails
    }
    
    // Atomically rename temporary directory to final location
    atomicRename(tempRevisionDir, finalRevisionDir);
    
    // Update current pointer atomically
    const tempPointerPath = getCurrentPointerPath(gameId) + ".tmp";
    writeJsonFile(tempPointerPath, { revision });
    atomicRename(tempPointerPath, getCurrentPointerPath(gameId));
    
    return {
      status: "committed",
      bundle,
    };
  } catch (error) {
    // Clean up temporary directory on failure
    try {
      if (fs.existsSync(tempRevisionDir)) {
        fs.rmSync(tempRevisionDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    throw error;
  }
}

/**
 * Lists available revisions for a game (for rollback UI).
 * @param {string} gameId - Game identifier
 * @returns {Promise<Array<{revision: string, parentRevision: string|null, committedAt: string, reason: string}>>}
 */
export async function listGameRevisions(gameId) {
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
    
    const revision = entry.name;
    const manifestPath = path.join(storePath, revision, MANIFEST_FILE);
    
    try {
      const manifest = readJsonFile(manifestPath);
      if (manifest && manifest.schema === "open-historia-world-revision/1") {
        revisions.push({
          revision: manifest.revision,
          parentRevision: manifest.parentRevision,
          committedAt: manifest.committedAt,
          reason: manifest.reason,
          rollbackOf: manifest.rollbackOf,
        });
      }
    } catch (error) {
      // Skip invalid manifests
    }
  }
  
  // Sort by committedAt descending (newest first)
  revisions.sort((a, b) => new Date(b.committedAt) - new Date(a.committedAt));
  
  return revisions;
}

/**
 * Prunes old revisions while protecting current, parent, and rollback targets.
 * @param {string} gameId - Game identifier
 * @param {number} keepCount - Number of recent revisions to keep
 * @returns {Promise<number>} Number of revisions pruned
 */
export async function pruneOldRevisions(gameId, keepCount = 12) {
  const allRevisions = await listGameRevisions(gameId);
  const currentRevision = readCurrentRevision(gameId);
  
  if (allRevisions.length <= keepCount) {
    return 0;
  }
  
  // Identify protected revisions:
  // 1. Current revision
  // 2. Parent of current revision (for recovery)
  // 3. Any revision that is a rollback target
  const protectedRevisions = new Set();
  
  if (currentRevision) {
    protectedRevisions.add(currentRevision);
    
    // Find parent of current revision
    const currentRevInfo = allRevisions.find(r => r.revision === currentRevision);
    if (currentRevInfo && currentRevInfo.parentRevision) {
      protectedRevisions.add(currentRevInfo.parentRevision);
    }
    
    // Find all revisions that are rollback targets
    for (const rev of allRevisions) {
      if (rev.rollbackOf) {
        protectedRevisions.add(rev.rollbackOf);
      }
    }
  }
  
  // Determine which revisions to prune
  const toPrune = [];
  const sortedRevisions = [...allRevisions]
    .sort((a, b) => new Date(a.committedAt) - new Date(b.committedAt)); // Oldest first
  
  for (let i = 0; i < sortedRevisions.length - keepCount; i++) {
    const rev = sortedRevisions[i];
    if (!protectedRevisions.has(rev.revision)) {
      toPrune.push(rev.revision);
    }
  }
  
  // Prune revisions
  let prunedCount = 0;
  for (const revision of toPrune) {
    const revisionDir = getRevisionDirectory(gameId, revision);
    try {
      fs.rmSync(revisionDir, { recursive: true, force: true });
      prunedCount++;
    } catch (error) {
      // Continue on error
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
  const currentRevision = readCurrentRevision(gameId);
  
  if (!currentRevision) {
    return { revision: null, recovered: false };
  }
  
  const manifestPath = getManifestPath(gameId, currentRevision);
  
  // Check if current revision is complete
  if (!fs.existsSync(manifestPath)) {
    // Current revision missing - try to find latest complete revision
    const allRevisions = await listGameRevisions(gameId);
    if (allRevisions.length > 0) {
      const latestComplete = allRevisions[0].revision;
      writeCurrentRevision(gameId, latestComplete);
      return { revision: latestComplete, recovered: true };
    }
    
    // No complete revisions found
    writeCurrentRevision(gameId, null);
    return { revision: null, recovered: true };
  }
  
  // Validate current revision bundle
  try {
    await loadRevisionBundle(gameId, currentRevision);
    return { revision: currentRevision, recovered: false };
  } catch (error) {
    // Current revision corrupt - find parent if available
    try {
      const manifest = readJsonFile(manifestPath);
      if (manifest && manifest.parentRevision) {
        const parentPath = getManifestPath(gameId, manifest.parentRevision);
        if (fs.existsSync(parentPath)) {
          writeCurrentRevision(gameId, manifest.parentRevision);
          return { revision: manifest.parentRevision, recovered: true };
        }
      }
    } catch (parentError) {
      // Parent not available
    }
    
    // Try to find latest complete revision
    const allRevisions = await listGameRevisions(gameId);
    const validRevisions = [];
    
    for (const rev of allRevisions) {
      if (rev.revision === currentRevision) continue;
      
      try {
        await loadRevisionBundle(gameId, rev.revision);
        validRevisions.push(rev);
      } catch (error) {
        // Skip invalid revisions
      }
    }
    
    if (validRevisions.length > 0) {
      const latestValid = validRevisions[0].revision;
      writeCurrentRevision(gameId, latestValid);
      return { revision: latestValid, recovered: true };
    }
    
    // No valid revisions found
    writeCurrentRevision(gameId, null);
    return { revision: null, recovered: true };
  }
}