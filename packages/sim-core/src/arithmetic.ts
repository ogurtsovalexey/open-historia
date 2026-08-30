const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

export function assertSafeInteger(value: number, name: string, minimum = Number.MIN_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  }
}

export function fromBigIntExact(value: bigint, name: string): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return Number(value);
}

export function addExact(left: number, right: number, name: string): number {
  assertSafeInteger(left, `${name}.left`);
  assertSafeInteger(right, `${name}.right`);
  return fromBigIntExact(BigInt(left) + BigInt(right), name);
}

export function subtractExact(left: number, right: number, name: string): number {
  assertSafeInteger(left, `${name}.left`);
  assertSafeInteger(right, `${name}.right`);
  return fromBigIntExact(BigInt(left) - BigInt(right), name);
}

export function multiplyExact(left: number, right: number, name: string): number {
  assertSafeInteger(left, `${name}.left`);
  assertSafeInteger(right, `${name}.right`);
  return fromBigIntExact(BigInt(left) * BigInt(right), name);
}

export function multiplyCapped(left: number, right: number, cap: number, name: string): number {
  assertSafeInteger(left, `${name}.left`, 0);
  assertSafeInteger(right, `${name}.right`, 0);
  assertSafeInteger(cap, `${name}.cap`, 0);
  const product = BigInt(left) * BigInt(right);
  return product >= BigInt(cap) ? cap : fromBigIntExact(product, name);
}

export function multiplyDivideFloor(
  factors: readonly number[],
  divisor: number,
  name: string,
): number {
  assertSafeInteger(divisor, `${name}.divisor`, 1);
  let numerator = 1n;
  for (const [index, factor] of factors.entries()) {
    assertSafeInteger(factor, `${name}.factor[${index}]`, 0);
    numerator *= BigInt(factor);
  }
  return fromBigIntExact(numerator / BigInt(divisor), name);
}
