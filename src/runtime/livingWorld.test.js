import assert from 'node:assert/strict';
import test from 'node:test';

import { withTimeout } from './livingWorld.js';

test('strategic timeout rejects and aborts a request that never settles', async () => {
  let aborted = false;
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'Strategic task polity:test', () => { aborted = true; }),
    /Strategic task polity:test exceeded the 0 second client deadline/,
  );
  assert.equal(aborted, true);
});

test('strategic timeout leaves a completed request alone', async () => {
  let aborted = false;
  const value = await withTimeout(Promise.resolve('accepted'), 25, 'Strategic task polity:test', () => { aborted = true; });
  assert.equal(value, 'accepted');
  assert.equal(aborted, false);
});
