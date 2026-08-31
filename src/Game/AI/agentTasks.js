import { callAI } from "./main.jsx";
import { createContextManifest, getBudgetPolicy, validateTask } from "./aiCallRegistry.js";
import { ledger } from "./aiCallLedger.js";
import { getProviderSettings, getStoredProvider } from "./providerConfig.js";

const profileFor = () => {
  const provider = getStoredProvider();
  const settings = getProviderSettings(provider);
  return {
    providerKind: provider,
    model: settings.model || "configured-model",
    endpointClass: settings.endpoint ? "remote-custom" : "provider-default",
    reasoningMode: "off",
  };
};

export async function dispatchAgentTask(task, { signal } = {}) {
  const definition = validateTask(task.taskId);
  const budget = getBudgetPolicy(definition.budgetPolicyId);
  const context = createContextManifest([{
    kind: "world-summary",
    itemCount: task.context?.polityCount ?? 1,
    characterCount: task.context?.characterCount ?? task.userPrompt.length,
    truncated: false,
  }]);
  const record = ledger.startInvocation({
    taskId: definition.taskId,
    taskVersion: definition.version,
    profile: profileFor(), context, budget,
  });
  ledger.startGeneration(record.invocationId, { purpose: "initial" });
  const started = ledger.startTransport(record.invocationId, 1, {
    transport: "direct",
    structuredMode: "tool",
    reasoningMode: "off",
    requestedOutputTokens: budget.maxOutputTokens,
  });
  const startedAt = performance.now();
  try {
    const result = await callAI(task.systemPrompt, [{ role: "user", parts: [{ text: task.userPrompt }] }], {
      tool: task.tool,
      maxTokens: budget.maxOutputTokens,
      retries: budget.maxTransportAttemptsPerGeneration,
      signal,
      languageMode: "none",
      reasoningMode: "off",
    });
    ledger.finishTransport(record.invocationId, 1, started.transportAttempt, {
      latencyMs: Math.max(0, performance.now() - startedAt), terminalStatus: "success",
    });
    ledger.finishGeneration(record.invocationId, 1, result?.toolInput ? "accepted" : "parse-failed");
    ledger.closeInvocation(record.invocationId, result?.toolInput
      ? { status: "no-effect", reason: "advisory" }
      : { status: "failed", failure: { code: "parse" } });
    if (!result?.toolInput) throw new Error(`${task.taskId} returned no structured tool payload`);
    return { taskKey: task.taskKey, output: result.toolInput, invocationId: record.invocationId };
  } catch (error) {
    const open = ledger.getOpenInvocation(record.invocationId);
    if (open) {
      const transport = open.attempts[0]?.transportAttempts[0];
      if (transport?.terminalStatus === null) ledger.finishTransport(record.invocationId, 1, started.transportAttempt, {
        latencyMs: Math.max(0, performance.now() - startedAt),
        terminalStatus: signal?.aborted ? "cancelled" : "transport-error",
      });
      const afterTransport = ledger.getOpenInvocation(record.invocationId);
      if (afterTransport?.attempts[0]?.result === null) ledger.finishGeneration(record.invocationId, 1, "request-failed");
      ledger.closeInvocation(record.invocationId, signal?.aborted
        ? { status: "cancelled", by: "user" }
        : { status: "failed", failure: { code: "transport" } });
    }
    throw error;
  }
}
