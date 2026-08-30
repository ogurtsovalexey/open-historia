// Unified atomic revision adapter
// Exports the appropriate adapter based on environment (browser vs server)

// Import core types
export {
  WORLD_PROJECTION_KEYS,
  WorldRevisionError,
  validateManifest,
  validateProjectionKeys,
  verifyProjectionDescriptors,
  planWorldRevisionCommit,
  buildWorldBundle,
} from "./worldRevisionCore.js";

// Platform detection
const isBrowser = typeof window !== "undefined";
const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

// Lazy imports to avoid cross-environment dependencies
let adapter = null;

async function getAdapter() {
  if (adapter) return adapter;
  
  if (isNode) {
    // Server/desktop environment - use filesystem adapter
    const { 
      readGameStateBundle,
      commitWorldRevision,
      listGameRevisions,
      pruneOldRevisions,
      recoverCurrentRevision,
    } = await import("../../server/worldRevisionFilesystem.js");
    
    adapter = {
      readGameStateBundle,
      commitWorldRevision,
      listGameRevisions,
      pruneOldRevisions,
      recoverCurrentRevision,
    };
  } else if (isBrowser) {
    // Browser environment - use IndexedDB adapter (to be implemented in Issue #43)
    // For now, throw an error - the web adapter will be implemented separately
    throw new Error("IndexedDB atomic revision adapter not yet implemented");
  } else {
    throw new Error("Unknown environment for atomic revision adapter");
  }
  
  return adapter;
}

// Public API - these functions delegate to the appropriate adapter
export async function readGameStateBundle(gameId) {
  const impl = await getAdapter();
  return impl.readGameStateBundle(gameId);
}

export async function commitWorldRevision(request) {
  const impl = await getAdapter();
  return impl.commitWorldRevision(request);
}

export async function listGameRevisions(gameId) {
  const impl = await getAdapter();
  return impl.listGameRevisions(gameId);
}

export async function pruneOldRevisions(gameId, keepCount = 12) {
  const impl = await getAdapter();
  return impl.pruneOldRevisions(gameId, keepCount);
}

export async function recoverCurrentRevision(gameId) {
  const impl = await getAdapter();
  return impl.recoverCurrentRevision(gameId);
}

// Helper function to get current game ID (placeholder - needs integration with existing game selection)
export function getCurrentGameId() {
  if (isBrowser) {
    // Browser: read from localStorage or URL
    return localStorage.getItem("oh-active-game-id") || "default";
  } else {
    // Server: read from active game manifest
    // This would need to integrate with the existing server game selection
    return "default";
  }
}

// Compatibility wrapper for existing code
export async function commitTurnRevision(projections, reason = "turn") {
  const gameId = getCurrentGameId();
  
  // Read current bundle to get expected revision
  const currentBundle = await readGameStateBundle(gameId);
  const expectedRevision = currentBundle.manifest.revision;
  
  return commitWorldRevision({
    gameId,
    expectedRevision,
    reason,
    projections,
  });
}