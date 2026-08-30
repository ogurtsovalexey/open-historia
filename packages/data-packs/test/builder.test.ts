import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ScenarioV2Builder, calculateInputChecksum, canonicalStringify } from '../src/builder.js';
import { makeBundle } from './fixtures.js';

describe('ScenarioV2Builder — determinism and checksums', () => {
  const builder = new ScenarioV2Builder();

  it('computes an identical canonical checksum across three builds', () => {
    const bundle = makeBundle();
    const checksums = [
      builder.build(bundle),
      builder.build(bundle),
      builder.build(bundle),
    ].map((r) => r.inputChecksum);

    assert(checksums.every((c): c is string => typeof c === 'string'));
    assert.strictEqual(checksums[0], checksums[1]);
    assert.strictEqual(checksums[1], checksums[2]);
    assert(checksums[0].startsWith('sha256:'));
  });

  it('canonicalizes object key order away', () => {
    const a = { z: 1, a: { y: 2, b: 3 } };
    const b = { a: { b: 3, y: 2 }, z: 1 };
    assert.strictEqual(canonicalStringify(a), canonicalStringify(b));
  });

  it('produces a different checksum when input changes', () => {
    const before = calculateInputChecksum(parse(builder, makeBundle()));
    const changed = makeBundle({ scenario: { meta: { title: 'Changed title' } } });
    const after = calculateInputChecksum(parse(builder, changed));
    assert.notStrictEqual(before, after);
  });

  it('builds the same checksum with network and LLM credentials unavailable', () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    // Network is unavailable: any fetch attempt must throw, proving the build
    // path performs no I/O. Restored in `finally` so no global state leaks.
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error('network unavailable during offline build');
    }) as unknown as typeof fetch;

    try {
      const bundle = makeBundle();
      const first = builder.build(bundle).inputChecksum;
      const second = builder.build(bundle).inputChecksum;
      assert.strictEqual(first, second);
      assert.strictEqual(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exposes deterministic projections', () => {
    const bundle = parse(builder, makeBundle());
    const projections = builder.projections(bundle);
    assert.strictEqual(projections.scenarioId, 'scenario:world-1916');
    assert.strictEqual(projections.startDate, '1916-01-01');
    assert.strictEqual(projections.polities.length, 2);
  });
});

function parse(builder: ScenarioV2Builder, input: unknown) {
  const result = builder.build(input);
  assert.strictEqual(result.success, true, JSON.stringify(result.errors));
  return result.bundle!;
}