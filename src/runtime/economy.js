/*! Open Historia — client access to game-scoped deterministic economy sessions. */
import { ensureLibraryCatalog, getLibraryState, refreshLibraryCatalog } from "./library.js";

const request = async (url, init) => {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `${url} failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
};

export const getActiveEngineGame = async () => {
  await ensureLibraryCatalog();
  const state = getLibraryState();
  const game = state?.activeGame ?? null;
  return game?.engineDriven === true ? game : null;
};

export const isEngineDrivenGame = async () => Boolean(await getActiveEngineGame());

export const fetchEconomyState = (gameId) => {
  if (!gameId) throw new Error("gameId is required to read economy state");
  return request(`/api/games/${encodeURIComponent(gameId)}/economy/state`);
};

export const advanceEconomy = async ({ gameId, targetDate, expectedSessionRevision, commands = [] }) => {
  if (!gameId) throw new Error("gameId is required to advance economy state");
  const result = await request(`/api/games/${encodeURIComponent(gameId)}/economy/advance`, {
    method: "POST",
    body: JSON.stringify({ targetDate, expectedSessionRevision, commands }),
  });
  await refreshLibraryCatalog({ force: true });
  return result;
};

const pendingCommands = new Map();
export const queueEconomyCommand = (gameId, command) => {
  if (!gameId) throw new Error("gameId is required to queue an economy command");
  pendingCommands.set(gameId, [...(pendingCommands.get(gameId) ?? []), command]);
  return pendingCommands.get(gameId).length;
};
export const getQueuedEconomyCommands = (gameId) => [...(pendingCommands.get(gameId) ?? [])];
export const clearQueuedEconomyCommands = (gameId) => pendingCommands.delete(gameId);
