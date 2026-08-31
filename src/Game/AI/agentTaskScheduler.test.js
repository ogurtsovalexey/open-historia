import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTaskScheduler, utilityTaskCacheKey } from './agentTaskScheduler.js';

const profile = { providerKind: 'gemini', model: 'utility-model', endpointClass: 'provider-default' };
const task = (key) => ({
  taskId: 'reports.explain-economy', taskVersion: 1, taskKey: key,
  systemPrompt: 'grounded report', userPrompt: JSON.stringify({ key }),
  tool: { name: 'report', schema: { type: 'object' } },
});

test('utility cache key is deterministic and includes provider/model identity', () => {
  assert.equal(utilityTaskCacheKey(task('same'), profile), utilityTaskCacheKey(task('same'), { ...profile }));
  assert.notEqual(utilityTaskCacheKey(task('same'), profile), utilityTaskCacheKey(task('other'), profile));
  assert.notEqual(utilityTaskCacheKey(task('same'), profile), utilityTaskCacheKey(task('same'), { ...profile, model: 'other' }));
});

test('identical utility briefs share one in-flight and completed execution', async () => {
  const scheduler = createAgentTaskScheduler();
  let calls = 0;
  const execute = async () => ({ output: ++calls });
  const input = { task: task('same'), role: 'utility', profile, execute };
  const [first, second] = await Promise.all([scheduler.run(input), scheduler.run(input)]);
  const third = await scheduler.run(input);
  assert.equal(calls, 1);
  assert.deepEqual(first, { output: 1 });
  assert.deepEqual(second, { output: 1, cached: true });
  assert.deepEqual(third, { output: 1, cached: true });
});

test('utility execution never exceeds concurrency six', async () => {
  const scheduler = createAgentTaskScheduler({ maxUtilityConcurrency: 6 });
  let active = 0;
  let peak = 0;
  let started = 0;
  const releases = [];
  const executions = Array.from({ length: 12 }, (_, index) => scheduler.run({
    task: task(String(index)), role: 'utility', profile,
    execute: () => new Promise((resolve) => {
      active += 1;
      started += 1;
      peak = Math.max(peak, active);
      releases.push(() => { active -= 1; resolve({ index }); });
    }),
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.snapshot().activeUtility, 6);
  assert.equal(scheduler.snapshot().queuedUtility, 6);
  while (started < 12) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }
  releases.splice(0).forEach((release) => release());
  await Promise.all(executions);
  assert.equal(peak, 6);
});

test('strategic tasks bypass utility cache and concurrency queue', async () => {
  const scheduler = createAgentTaskScheduler({ maxUtilityConcurrency: 1 });
  let calls = 0;
  const input = { task: task('material'), role: 'strategic', profile, execute: async () => ({ output: ++calls }) };
  assert.deepEqual(await scheduler.run(input), { output: 1 });
  assert.deepEqual(await scheduler.run(input), { output: 2 });
});

test('failed utility calls are not cached', async () => {
  const scheduler = createAgentTaskScheduler();
  let calls = 0;
  const input = {
    task: task('retry'), role: 'utility', profile,
    execute: async () => { calls += 1; if (calls === 1) throw new Error('offline'); return { output: 'ok' }; },
  };
  await assert.rejects(scheduler.run(input), /offline/);
  assert.deepEqual(await scheduler.run(input), { output: 'ok' });
  assert.equal(calls, 2);
});
