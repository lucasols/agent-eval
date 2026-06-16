import { formatWithOptions, isDeepStrictEqual } from 'node:util';
import { assertEvalAssertionsAllowed, evalAssert } from './runtime.ts';

/**
 * Focused expectation helpers for eval case invariants.
 *
 * These matchers intentionally cover comparisons that produce clearer failure
 * messages than a plain `evalAssert(...)`. Use `evalAssert(...)` directly for
 * truthiness checks and custom type narrowing.
 */
export type EvalExpectation<T> = {
  /** Invert the next matcher. */
  readonly not: EvalExpectation<T>;
  /** Assert strict `Object.is(...)` equality. */
  toBe(expected: unknown): void;
  /** Assert Node.js deep strict equality. */
  toEqual(expected: unknown): void;
  /** Assert that object properties recursively match the expected subset. */
  toMatchObject(expected: Record<string, unknown>): void;
  /** Assert substring, array item, or set item containment. */
  toContain(expected: unknown): void;
  /** Assert the value has a numeric `length` equal to `expected`. */
  toHaveLength(expected: number): void;
  /** Assert a dot-path property exists, optionally with a deep-equal value. */
  toHaveProperty(path: string, ...expected: [] | [unknown]): void;
  /** Assert the received number is greater than `expected`. */
  toBeGreaterThan(expected: number): void;
  /** Assert the received number is greater than or equal to `expected`. */
  toBeGreaterThanOrEqual(expected: number): void;
  /** Assert the received number is less than `expected`. */
  toBeLessThan(expected: number): void;
  /** Assert the received number is less than or equal to `expected`. */
  toBeLessThanOrEqual(expected: number): void;
  /** Assert the received number is close to `expected` at `precision` decimals. */
  toBeCloseTo(expected: number, precision?: number): void;
  /** Assert the received string matches the regular expression. */
  toMatch(expected: RegExp): void;
};

const expectFormatOptions = {
  depth: 5,
  maxArrayLength: 50,
  maxStringLength: 1_000,
  breakLength: 80,
  compact: 3,
};

function formatExpectValue(value: unknown): string {
  return formatWithOptions(expectFormatOptions, value);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLengthLike(value: unknown): value is { length: number } {
  if (typeof value === 'string') return true;
  return (
    isRecordLike(value) && 'length' in value && typeof value.length === 'number'
  );
}

function matchesObjectSubset(
  received: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (!isRecordLike(received)) return false;

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!(key in received)) return false;
    const receivedValue = received[key];

    if (isRecordLike(expectedValue)) {
      if (!matchesObjectSubset(receivedValue, expectedValue)) return false;
      continue;
    }

    if (!isDeepStrictEqual(receivedValue, expectedValue)) return false;
  }

  return true;
}

function containsValue(received: unknown, expected: unknown): boolean {
  if (typeof received === 'string') {
    return typeof expected === 'string' && received.includes(expected);
  }
  if (Array.isArray(received)) return received.includes(expected);
  if (received instanceof Set) return received.has(expected);
  return false;
}

function getPropertyAtPath(
  received: unknown,
  path: string,
): { exists: boolean; value: unknown } {
  if (path === '') return { exists: false, value: undefined };

  let current = received;
  for (const key of path.split('.')) {
    if (!isRecordLike(current) || !(key in current)) {
      return { exists: false, value: undefined };
    }
    current = current[key];
  }

  return { exists: true, value: current };
}

class EvalExpectationImpl<T> implements EvalExpectation<T> {
  private readonly received: T;
  private readonly negated: boolean;

  constructor(received: T, negated: boolean) {
    this.received = received;
    this.negated = negated;
  }

  get not(): EvalExpectation<T> {
    return new EvalExpectationImpl(this.received, !this.negated);
  }

  toBe(expected: unknown): void {
    this.check(
      Object.is(this.received, expected),
      `Expected ${formatExpectValue(this.received)} to be ${formatExpectValue(expected)}`,
      `Expected ${formatExpectValue(this.received)} not to be ${formatExpectValue(expected)}`,
    );
  }

  toEqual(expected: unknown): void {
    this.check(
      isDeepStrictEqual(this.received, expected),
      `Expected ${formatExpectValue(this.received)} to equal ${formatExpectValue(expected)}`,
      `Expected ${formatExpectValue(this.received)} not to equal ${formatExpectValue(expected)}`,
    );
  }

  toMatchObject(expected: Record<string, unknown>): void {
    this.check(
      matchesObjectSubset(this.received, expected),
      `Expected ${formatExpectValue(this.received)} to match object ${formatExpectValue(expected)}`,
      `Expected ${formatExpectValue(this.received)} not to match object ${formatExpectValue(expected)}`,
    );
  }

  toContain(expected: unknown): void {
    this.check(
      containsValue(this.received, expected),
      `Expected ${formatExpectValue(this.received)} to contain ${formatExpectValue(expected)}`,
      `Expected ${formatExpectValue(this.received)} not to contain ${formatExpectValue(expected)}`,
    );
  }

  toHaveLength(expected: number): void {
    this.check(
      isLengthLike(this.received) && this.received.length === expected,
      `Expected ${formatExpectValue(this.received)} to have length ${expected}`,
      `Expected ${formatExpectValue(this.received)} not to have length ${expected}`,
    );
  }

  toHaveProperty(path: string, ...expected: [] | [unknown]): void {
    const result = getPropertyAtPath(this.received, path);
    const expectedValue = expected[0];
    const pass =
      result.exists &&
      (expected.length === 0 || isDeepStrictEqual(result.value, expectedValue));
    const expectedSuffix =
      expected.length === 0
        ? ''
        : ` with value ${formatExpectValue(expectedValue)}`;

    this.check(
      pass,
      `Expected ${formatExpectValue(this.received)} to have property "${path}"${expectedSuffix}`,
      `Expected ${formatExpectValue(this.received)} not to have property "${path}"${expectedSuffix}`,
    );
  }

  toBeGreaterThan(expected: number): void {
    this.checkNumberComparison('to be greater than', expected, (received) => {
      return received > expected;
    });
  }

  toBeGreaterThanOrEqual(expected: number): void {
    this.checkNumberComparison(
      'to be greater than or equal to',
      expected,
      (received) => {
        return received >= expected;
      },
    );
  }

  toBeLessThan(expected: number): void {
    this.checkNumberComparison('to be less than', expected, (received) => {
      return received < expected;
    });
  }

  toBeLessThanOrEqual(expected: number): void {
    this.checkNumberComparison(
      'to be less than or equal to',
      expected,
      (received) => {
        return received <= expected;
      },
    );
  }

  toBeCloseTo(expected: number, precision = 2): void {
    const tolerance = 10 ** -precision / 2;
    this.check(
      typeof this.received === 'number' &&
        Number.isFinite(this.received) &&
        Math.abs(this.received - expected) < tolerance,
      `Expected ${formatExpectValue(this.received)} to be close to ${expected} at ${precision} decimals`,
      `Expected ${formatExpectValue(this.received)} not to be close to ${expected} at ${precision} decimals`,
    );
  }

  toMatch(expected: RegExp): void {
    const statelessExpected = new RegExp(expected.source, expected.flags);
    this.check(
      typeof this.received === 'string' &&
        statelessExpected.test(this.received),
      `Expected ${formatExpectValue(this.received)} to match ${expected}`,
      `Expected ${formatExpectValue(this.received)} not to match ${expected}`,
    );
  }

  private check(
    pass: boolean,
    positiveMessage: string,
    negativeMessage: string,
  ): void {
    if (this.negated ? !pass : pass) return;
    evalAssert(false, this.negated ? negativeMessage : positiveMessage);
  }

  private checkNumberComparison(
    label: string,
    expected: number,
    predicate: (received: number) => boolean,
  ): void {
    this.check(
      typeof this.received === 'number' && predicate(this.received),
      `Expected ${formatExpectValue(this.received)} ${label} ${expected}`,
      `Expected ${formatExpectValue(this.received)} not ${label} ${expected}`,
    );
  }
}

/**
 * Create focused expectation helpers for the current eval case.
 *
 * Failed expectations record assertion failures and throw only while an eval
 * case scope is active, matching `evalAssert(...)`.
 */
export function evalExpect<T>(value: T): EvalExpectation<T> {
  assertEvalAssertionsAllowed('evalExpect(...)');
  return new EvalExpectationImpl(value, false);
}
