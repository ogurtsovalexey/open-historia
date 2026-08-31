/*! Bounded utility-task scheduler with deterministic content-key caching. */

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const utilityTaskCacheKey = (task, profile) => canonical({
  role: 'utility',
  taskId: task.taskId,
  taskVersion: task.taskVersion ?? 1,
  systemPrompt: task.systemPrompt,
  userPrompt: task.userPrompt,
  tool: task.tool,
  profile: {
    providerKind: profile.providerKind,
    model: profile.model,
    endpointClass: profile.endpointClass,
  },
});

export function createAgentTaskScheduler({ maxUtilityConcurrency = 6, maxCacheEntries = 128 } = {}) {
  if (!Number.isInteger(maxUtilityConcurrency) || maxUtilityConcurrency < 1) throw new Error('maxUtilityConcurrency must be a positive integer');
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) throw new Error('maxCacheEntries must be a positive integer');
  let activeUtility = 0;
  const queue = [];
  const cache = new Map();

  const pump = () => {
    while (activeUtility < maxUtilityConcurrency && queue.length) {
      const entry = queue.shift();
      if (entry.signal?.aborted) {
        entry.reject(entry.signal.reason ?? new Error('utility task cancelled'));
        continue;
      }
      activeUtility += 1;
      Promise.resolve().then(entry.execute).then(entry.resolve, entry.reject).finally(() => {
        activeUtility -= 1;
        pump();
      });
    }
  };

  const scheduleUtility = (execute, signal) => new Promise((resolve, reject) => {
    queue.push({ execute, signal, resolve, reject });
    pump();
  });

  const remember = (key, promise) => {
    cache.set(key, promise);
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
  };

  return Object.freeze({
    run({ task, role, profile, signal, execute }) {
      if (role === 'strategic') return Promise.resolve().then(execute);
      if (role !== 'utility') return Promise.reject(new Error(`unknown AI model role ${role}`));
      const key = utilityTaskCacheKey(task, profile);
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return cached.then((result) => ({ ...result, cached: true }));
      }
      const pending = scheduleUtility(execute, signal);
      remember(key, pending);
      pending.catch(() => {
        if (cache.get(key) === pending) cache.delete(key);
      });
      return pending;
    },
    clearCache() { cache.clear(); },
    snapshot() { return Object.freeze({ activeUtility, queuedUtility: queue.length, cachedUtility: cache.size }); },
  });
}
