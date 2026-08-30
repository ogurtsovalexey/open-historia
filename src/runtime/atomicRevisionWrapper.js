// Atomic revision wrapper for applySimulationResult
// Replaces individual write calls with atomic revision commit

import { commitTurnRevision } from "./worldRevisionAdapter.js";

/**
 * Atomic version of applySimulationResult write phase
 * @param {Object} params - The complete state to commit
 * @param {Array} params.actions - Next actions state
 * @param {Array} params.chats - Next chats state  
 * @param {Array} params.events - Next events state
 * @param {Object} params.game - Next game state
 * @param {Object} params.world - Next world state
 * @param {Object} params.colors - Next colors state
 * @param {string} params.reason - Revision reason ("turn", "pregame", "rollback", "compat-write")
 * @param {string|null} params.rollbackOf - For rollback revisions
 * @returns {Promise<Object>} Commit result
 */
export async function commitAtomicWorldRevision({
  actions,
  chats,
  events,
  game,
  world,
  colors,
  reason = "turn",
  rollbackOf = null,
}) {
  // Build the six projections required by the atomic revision contract
  const projections = {
    actions,
    chat: chats, // Note: key is "chat" not "chats" in the contract
    events,
    game,
    world,
    colors,
  };
  
  return commitTurnRevision(projections, reason, rollbackOf);
}

/**
 * Compatibility function for existing write calls
 * Can be used to gradually migrate existing code
 */
export async function writeAtomicProjection(projectionKey, value, reason = "compat-write") {
  // For compatibility writes, we need to:
  // 1. Read current bundle
  // 2. Replace the specified projection
  // 3. Commit as a compatibility write
  
  // This would need access to the current game ID and current bundle
  // For now, this is a placeholder that shows the intended API
  throw new Error("writeAtomicProjection not yet implemented - use commitAtomicWorldRevision for complete revisions");
}