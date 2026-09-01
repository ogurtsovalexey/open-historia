import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CODEX_SUBSCRIPTION_MODEL = 'gpt-5.6-luna';
export const CODEX_PROMPT_CONTRACT = 'StrategicBriefV3+StrategicDecisionV2';
export const CODEX_TIMEOUT_MS = 10 * 60_000;

export const codexCliVersion = (exec = execFileSync) => exec('codex', ['--version'], { encoding: 'utf8' }).trim();

export const sanitizeCodexEnvironment = (source = process.env) => Object.fromEntries(Object.entries(source).filter(([name, value]) => {
  if (value === undefined) return false;
  return !/^(OPENAI|GEMINI|GOOGLE_API|ANTHROPIC|AZURE_OPENAI|AWS_|MISTRAL|COHERE|DEEPSEEK|XAI|GROQ|TOGETHER|HF_)/i.test(name)
    && !/(API_KEY|ACCESS_KEY|SECRET_KEY|AUTH_TOKEN)$/i.test(name);
}));

export const buildCodexExecArgs = ({ cwd, schemaPath, outputPath }) => [
  'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json',
  '--output-schema', schemaPath, '--output-last-message', outputPath, '--cd', cwd, '--sandbox', 'read-only',
  '--model', CODEX_SUBSCRIPTION_MODEL,
  '--config', 'forced_login_method="chatgpt"',
  '--config', 'model_reasoning_effort="low"',
  '--config', 'model_verbosity="low"',
  '--config', 'features.fast_mode=false',
  '--config', 'features.plugins=false',
  '--config', 'features.apps=false',
  '--config', 'features.multi_agent=false',
  '--config', 'mcp_servers={}',
  '-',
];

export const parseCodexJsonl = (stdout) => {
  const events = String(stdout ?? '').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'transport.unparsed', text: line }; }
  });
  const threadIds = [...new Set(events.flatMap((event) => [event.thread_id, event.threadId, event?.thread?.id]).filter(Boolean))];
  const completed = events.some((event) => event.type === 'turn.completed' || event.type === 'turn_complete' || event.status === 'completed' && /turn/i.test(event.type ?? ''));
  const usageRows = events.flatMap((event) => [event.usage, event.token_usage, event?.turn?.usage].filter(Boolean));
  const usage = usageRows.reduce((total, row) => ({
    inputTokens: total.inputTokens + (row.input_tokens ?? row.inputTokens ?? 0),
    cachedInputTokens: total.cachedInputTokens + (row.cached_input_tokens ?? row.cachedInputTokens ?? 0),
    outputTokens: total.outputTokens + (row.output_tokens ?? row.outputTokens ?? 0),
    reasoningTokens: total.reasoningTokens + (row.reasoning_output_tokens ?? row.reasoning_tokens ?? row.reasoningTokens ?? 0),
    totalTokens: total.totalTokens + (row.total_tokens ?? row.totalTokens ?? 0),
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 });
  if (usage.totalTokens === 0) usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return { events, threadIds, completed, usage };
};

export const classifyCodexFailure = (error) => {
  const detail = `${error?.message ?? ''}\n${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(detail)) return 'timeout';
  if (/subscription|usage limit|rate.?limit|quota|too many requests|429/i.test(detail)) return 'subscription-paused';
  return 'transport-error';
};

export const invokeCodexSubscription = ({ prompt, schema, timeoutMs = CODEX_TIMEOUT_MS, exec = execFileSync }) => {
  let lastError;
  for (let transportAttempt = 0; transportAttempt < 2; transportAttempt += 1) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'open-historia-codex-'));
    const schemaPath = path.join(cwd, 'output-schema.json');
    const outputPath = path.join(cwd, 'last-message.json');
    fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
    const args = buildCodexExecArgs({ cwd, schemaPath, outputPath });
    const started = Date.now();
    try {
      const stdout = exec('codex', args, { cwd, env: sanitizeCodexEnvironment(), encoding: 'utf8', input: prompt,
        timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
      const parsed = parseCodexJsonl(stdout);
      const responseText = fs.readFileSync(outputPath, 'utf8');
      return { status: 'success', transportAttempt, latencyMs: Date.now() - started, args, cwd, stdout, responseText,
        response: JSON.parse(responseText), ...parsed };
    } catch (error) {
      const parsed = parseCodexJsonl(error?.stdout);
      lastError = { status: classifyCodexFailure(error), transportAttempt, latencyMs: Date.now() - started, args, cwd,
        stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? ''), error: error?.message ?? String(error), ...parsed };
      if (parsed.completed || transportAttempt === 1 || lastError.status === 'subscription-paused') return lastError;
    }
  }
  return lastError;
};
