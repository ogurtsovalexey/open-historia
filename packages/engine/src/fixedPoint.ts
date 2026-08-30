/**
 * Deterministic safe-integer arithmetic for the economy engine.
 *
 * Deliberate divergence from first-economy-mvp.md's `bigint` remainders:
 * all state quantities are JS safe integers (persons, whole resource units,
 * whole gold, basis points). `canonicalStringify` and JSON cannot serialize
 * bigint, and at the 2x5 fixture scale every intermediate product fits in
 * 2^53 with a loud assertion. Recorded in docs/canon/04-economy-slice.md.
 */

export const BP_SCALE = 10000;
/** Annual basis points spread over 12 months: rateBp / (10000 * 12). */
export const ANNUAL_BP_MONTHLY_DIVISOR = 120000;

export function assertSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is not a safe integer: ${value}`);
  }
  return value;
}

export interface DivResult {
  q: number;
  r: number;
}

/** Floor division of non-negative safe integers with explicit remainder. */
export function divFloor(numerator: number, divisor: number, label: string): DivResult {
  assertSafeInt(numerator, `${label} numerator`);
  assertSafeInt(divisor, `${label} divisor`);
  if (divisor <= 0) throw new RangeError(`${label} divisor must be positive: ${divisor}`);
  if (numerator < 0) throw new RangeError(`${label} numerator must be non-negative: ${numerator}`);
  const q = Math.floor(numerator / divisor);
  const r = numerator - q * divisor;
  return { q: assertSafeInt(q, `${label} quotient`), r };
}

/** (a * b + carry) floor-divided by d, remainder returned for carrying. */
export function mulDivFloor(a: number, b: number, d: number, label: string, carry = 0): DivResult {
  assertSafeInt(a, `${label} a`);
  assertSafeInt(b, `${label} b`);
  assertSafeInt(carry, `${label} carry`);
  const product = a * b;
  assertSafeInt(product, `${label} product`);
  const numerator = product + carry;
  assertSafeInt(numerator, `${label} numerator`);
  return divFloor(numerator, d, label);
}

/** value * bp / 10000, floored. */
export function applyBp(value: number, bp: number, label: string): number {
  return mulDivFloor(value, bp, BP_SCALE, label).q;
}

export function clampBp(bp: number): number {
  if (bp < 0) return 0;
  if (bp > BP_SCALE) return BP_SCALE;
  return bp;
}

export function addChecked(a: number, b: number, label: string): number {
  return assertSafeInt(a + b, label);
}

export function subToZero(a: number, b: number): number {
  return a > b ? a - b : 0;
}
