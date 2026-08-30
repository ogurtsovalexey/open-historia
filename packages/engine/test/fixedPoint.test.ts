import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyBp, assertSafeInt, clampBp, divFloor, mulDivFloor } from '../src/fixedPoint.js';

describe('fixedPoint', () => {
  it('divFloor returns exact quotient and remainder', () => {
    assert.deepStrictEqual(divFloor(7, 3, 't'), { q: 2, r: 1 });
    assert.deepStrictEqual(divFloor(0, 3, 't'), { q: 0, r: 0 });
    assert.deepStrictEqual(divFloor(288000000, 120000, 't'), { q: 2400, r: 0 });
  });

  it('mulDivFloor carries the remainder into the numerator', () => {
    // 250000 * 290 + 0 = 72500000; /120000 = 604 r 20000
    assert.deepStrictEqual(mulDivFloor(250000, 290, 120000, 't'), { q: 604, r: 20000 });
    // Next month the carry adds up: 250104 * 290 + 20000
    const next = mulDivFloor(250104, 290, 120000, 't', 20000);
    assert.strictEqual(next.q * 120000 + next.r, 250104 * 290 + 20000);
  });

  it('applyBp floors value*bp/10000', () => {
    assert.strictEqual(applyBp(15000, 4000, 't'), 6000);
    assert.strictEqual(applyBp(6000, 8000, 't'), 4800);
    assert.strictEqual(applyBp(999, 3333, 't'), 332);
  });

  it('clampBp bounds to [0, 10000]', () => {
    assert.strictEqual(clampBp(10001), 10000);
    assert.strictEqual(clampBp(-5), 0);
    assert.strictEqual(clampBp(4321), 4321);
  });

  it('overflow past 2^53 throws loudly', () => {
    assert.throws(() => assertSafeInt(2 ** 53, 'x'), RangeError);
    assert.throws(() => mulDivFloor(2 ** 40, 2 ** 40, 10, 't'), RangeError);
    assert.throws(() => divFloor(10, 0, 't'), RangeError);
    assert.throws(() => divFloor(-1, 10, 't'), RangeError);
  });
});
