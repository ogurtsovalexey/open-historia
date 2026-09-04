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

export const prepareAgentTurn = ({ gameId, targetDate, expectedSessionRevision, actions = [], commands = [], locale = "en" }) =>
  request(`/api/games/${encodeURIComponent(gameId)}/agent-turn/prepare`, {
    method: "POST",
    body: JSON.stringify({ targetDate, expectedSessionRevision, actions, commands, locale }),
  });

export const fetchAgentTurnDraft = (gameId) => {
  if (!gameId) throw new Error("gameId is required to read an agent-turn draft");
  return request(`/api/games/${encodeURIComponent(gameId)}/agent-turn/draft`);
};

export const stepAgentTurn = ({ gameId, ...body }) =>
  request(`/api/games/${encodeURIComponent(gameId)}/agent-turn/step`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const commitAgentTurn = async ({ gameId, turnToken, turnDigest }) => {
  const result = await request(`/api/games/${encodeURIComponent(gameId)}/agent-turn/commit`, {
    method: "POST",
    body: JSON.stringify({ turnToken, turnDigest }),
  });
  await refreshLibraryCatalog({ force: true });
  return result;
};

export const cancelAgentTurn = (gameId) =>
  request(`/api/games/${encodeURIComponent(gameId)}/agent-turn/draft`, { method: "DELETE" });

const pendingCommands = new Map();
export const queueEconomyCommand = (gameId, command) => {
  if (!gameId) throw new Error("gameId is required to queue an economy command");
  pendingCommands.set(gameId, [...(pendingCommands.get(gameId) ?? []), command]);
  return pendingCommands.get(gameId).length;
};
export const getQueuedEconomyCommands = (gameId) => [...(pendingCommands.get(gameId) ?? [])];
export const clearQueuedEconomyCommands = (gameId) => pendingCommands.delete(gameId);
