import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import { resolveMonth } from '../src/resolution.js';
import { createTenRegionFixture } from '../src/fixtures.js';

describe('Performance Test', () => {
  let fixture: ReturnType<typeof createTenRegionFixture>;

  before(() => {
    fixture = createTenRegionFixture();
  });

  it('should resolve ten regions in reasonable time', () => {
    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const result = resolveMonth(
        fixture.regions,
        fixture.polityStocks,
        fixture.constants
      );
      assert.ok(result.nextRegions.length === 10);
    }

    const end = performance.now();
    const totalMs = end - start;
    const avgMsPerTick = totalMs / iterations;

    console.log(`Performance for ${iterations} ticks:`);
    console.log(`  Total time: ${totalMs.toFixed(2)}ms`);
    console.log(`  Average per tick: ${avgMsPerTick.toFixed(4)}ms`);

    // Deliberately loose threshold to avoid flakiness on shared CI hosts.
    assert.ok(avgMsPerTick < 100, `Average ${avgMsPerTick.toFixed(4)}ms per tick exceeds 100ms threshold`);
  });

  it('should measure single tick duration', () => {
    const start = performance.now();

    const result = resolveMonth(
      fixture.regions,
      fixture.polityStocks,
      fixture.constants
    );

    const end = performance.now();
    const durationMs = end - start;

    console.log(`Single tick duration: ${durationMs.toFixed(4)}ms`);
    assert.ok(result.nextPolityStocks.length === 2);

    // Very generous threshold for cold start.
    assert.ok(durationMs < 1000, `Single tick took ${durationMs.toFixed(4)}ms`);
  });
});