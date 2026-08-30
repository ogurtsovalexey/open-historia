/*! Open Historia — client access to the deterministic economy engine. */
import { ensureLibraryCatalog, getLibraryState } from "./library.js";

const request = async (url, init) => {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `${url} failed with ${response.status}`);
  }
  return data;
};

/**
 * True when the active game routes time through the engine. The flag lives on
 * the game (inherited from its scenario), so a legacy game is never affected.
 */
export const isEngineDrivenGame = async () => {
  await ensureLibraryCatalog();
  const state = getLibraryState();
  if (state?.activeGame) return state.activeGame.engineDriven === true;
  return state?.runtimeScenario?.engineDriven === true;
};

export const fetchEconomyState = () => request("/api/economy/state");

/** Resolve `months` monthly ticks; commands apply to the first month only. */
export const runEconomyMonths = ({ months = 1, commands = [] } = {}) =>
  request("/api/economy/turn", { method: "POST", body: JSON.stringify({ months, commands }) });

export const resetEconomy = () => request("/api/economy/reset", { method: "POST", body: JSON.stringify({}) });

/** Whole months between two YYYY-MM-DD dates, floored at zero. */
export const monthsBetween = (fromDate, toDate) => {
  const [fy, fm] = String(fromDate).split("-").map(Number);
  const [ty, tm] = String(toDate).split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
};
