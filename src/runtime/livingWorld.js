import { useEffect, useMemo, useRef, useState } from "react";
import { refreshLibraryCatalog, useLibraryState } from "./library.js";
import { getStoredLanguage } from "./i18n.js";
import { getProviderSettings, getStoredProvider } from "../Game/AI/providerConfig.js";

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

const STRATEGIC_TASK_TIMEOUT_MS = 45_000;

const withTimeout = (promise, timeoutMs, label, onTimeout) => new Promise((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    onTimeout?.();
    reject(new Error(`${label} exceeded the ${Math.round(timeoutMs / 1000)} second client deadline.`));
  }, timeoutMs);
  promise.then(
    (value) => { clearTimeout(timeoutId); resolve(value); },
    (error) => { clearTimeout(timeoutId); reject(error); },
  );
});

async function runStrategicTasks(tasks = []) {
  if (tasks.length === 0) return [];
  const { callAI } = await import('../Game/AI/main.jsx');
  // All briefs are frozen against the same revision and server materialization
  // remains stable-order/atomic. Running the bounded batch concurrently keeps
  // one slow provider response from holding the primary advance control for
  // several sequential timeouts; a timeout becomes an explicit failed attempt
  // that the canonical checkpoint can show and retry.
  return Promise.all(tasks.map(async (task) => {
    const controller = new AbortController();
    try {
      const result = await withTimeout(callAI(task.systemPrompt, [{ role: 'user', parts: [{ text: task.userPrompt }] }], {
        languageMode: 'none',
        providerRole: 'strategic',
        signal: controller.signal,
        tool: task.tool,
      }), STRATEGIC_TASK_TIMEOUT_MS, `Strategic task ${task.actorPolityId}`, () => controller.abort());
      if (!result?.toolInput) throw new Error('The strategic model returned no structured decision.');
      return { taskKey: task.taskKey, status: 'succeeded', modelOutput: result.toolInput };
    } catch (error) {
      return {
        taskKey: task.taskKey,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Strategic model call failed.',
      };
    }
  }));
}

// Persist only the non-secret provenance needed to audit a model-mediated
// decision. API keys, endpoint URLs, prompts and model output stay out of the
// save and out of exported playtest evidence.
function modelRunMetadata(role) {
  const provider = getStoredProvider(role);
  const settings = getProviderSettings(provider, role);
  return {
    role,
    provider,
    model: String(settings.model ?? "").trim() || null,
    effort: String(settings.effort ?? "").trim() || null,
  };
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
        return mutate("intent", { revision, intentions, modelOutput, modelMetadata: modelRunMetadata("utility") });
      },
      confirmInterpretation: ({ revision, interpretationId }) => mutate("intent/confirm", { revision, interpretationId }),
      dismissInterpretation: ({ revision, interpretationId }) => mutate("intent/dismiss", { revision, interpretationId }),
      advanceTime: async ({ revision, optionId, strategicDisposition = 'resolve' }) => {
        const current = payloadRef.current;
        const strategicAttempts = strategicDisposition === 'continue-without-decisions'
          ? []
          : await runStrategicTasks(current?.strategicTasks);
        return mutate('advance', {
          revision,
          optionId,
          strategicAttempts,
          strategicDisposition,
          strategicModelMetadata: strategicDisposition === 'continue-without-decisions' ? null : modelRunMetadata("strategic"),
        });
      },
    };
  }, [activeGameId, enabled]);

  return {
    commands,
    enabled,
    projection: payload?.projection ?? null,
  };
}
