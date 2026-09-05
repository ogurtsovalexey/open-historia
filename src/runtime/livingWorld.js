import { useEffect, useMemo, useRef, useState } from "react";
import { refreshLibraryCatalog, useLibraryState } from "./library.js";
import { getStoredLanguage } from "./i18n.js";

const parseResponse = async (response) => {
  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) throw new Error(payload?.error || `Living-world request failed with HTTP ${response.status}`);
  return payload;
};

const request = async (pathname, { body, signal } = {}) => parseResponse(await fetch(pathname, {
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  method: body === undefined ? "GET" : "POST",
  signal,
}));

async function runStrategicTasks(tasks = []) {
  if (tasks.length === 0) return [];
  const { callAI } = await import('../Game/AI/main.jsx');
  const attempts = [];
  for (const task of tasks) {
    try {
      const result = await callAI(task.systemPrompt, [{ role: 'user', parts: [{ text: task.userPrompt }] }], {
        languageMode: 'none',
        providerRole: 'strategic',
        tool: task.tool,
      });
      if (!result?.toolInput) throw new Error('The strategic model returned no structured decision.');
      attempts.push({ taskKey: task.taskKey, status: 'succeeded', modelOutput: result.toolInput });
    } catch (error) {
      attempts.push({
        taskKey: task.taskKey,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Strategic model call failed.',
      });
    }
  }
  return attempts;
}

export const livingWorldEndpoint = (gameId, action = "") => (
  `/api/games/${encodeURIComponent(gameId)}/living-world${action ? `/${action}` : ""}`
);

export function useLivingWorldRuntime() {
  const { activeGame, activeGameId } = useLibraryState();
  const enabled = activeGame?.livingWorld === true;
  const [payload, setPayload] = useState(null);
  const payloadRef = useRef(null);

  useEffect(() => { payloadRef.current = payload; }, [payload]);

  useEffect(() => {
    if (!enabled || !activeGameId) {
      setPayload(null);
      return undefined;
    }
    const controller = new AbortController();
    setPayload(null);
    const locale = getStoredLanguage();
    request(`${livingWorldEndpoint(activeGameId)}?locale=${encodeURIComponent(locale)}`, { signal: controller.signal })
      .then(setPayload)
      .catch((error) => {
        if (error?.name !== "AbortError") console.error("Failed to load living-world projection:", error);
      });
    return () => controller.abort();
  }, [activeGameId, enabled]);

  const commands = useMemo(() => {
    if (!enabled || !activeGameId) return null;
    const mutate = async (action, values) => {
      const current = payloadRef.current;
      if (!current?.sessionRevision) throw new Error("The living-world session is still loading.");
      const next = await request(livingWorldEndpoint(activeGameId, action), {
        body: { ...values, locale: getStoredLanguage(), sessionRevision: current.sessionRevision },
      });
      payloadRef.current = next;
      setPayload(next);
      if (action === "advance") void refreshLibraryCatalog({ force: true }).catch(() => {});
      return next;
    };
    return {
      submitIntent: async ({ revision, intentions }) => {
        const current = payloadRef.current;
        if (!current?.interpretationContext) throw new Error("The grounded interpretation context is unavailable.");
        const { interpretLivingWorldIntent } = await import("./livingWorldAi.js");
        const modelOutput = await interpretLivingWorldIntent(current.interpretationContext, intentions);
        return mutate("intent", { revision, intentions, modelOutput });
      },
      confirmInterpretation: ({ revision, interpretationId }) => mutate("intent/confirm", { revision, interpretationId }),
      dismissInterpretation: ({ revision, interpretationId }) => mutate("intent/dismiss", { revision, interpretationId }),
      advanceTime: async ({ revision, optionId, strategicDisposition = 'resolve' }) => {
        const current = payloadRef.current;
        const strategicAttempts = strategicDisposition === 'continue-without-decisions'
          ? []
          : await runStrategicTasks(current?.strategicTasks);
        return mutate('advance', { revision, optionId, strategicAttempts, strategicDisposition });
      },
    };
  }, [activeGameId, enabled]);

  return {
    commands,
    enabled,
    projection: payload?.projection ?? null,
  };
}
