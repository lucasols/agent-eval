import {
  EvalAssertionError,
  evalAssert,
  getCurrentScope,
  isInEvalScope,
  runInEvalScope,
} from '@agent-evals/sdk';
import { expect, test } from 'vitest';

test('evalAssert is a no-op outside an active eval scope', () => {
  expect(getCurrentScope()).toBeUndefined();
  expect(isInEvalScope()).toBe(false);
  expect(() => {
    evalAssert(false, 'shared workflow assertion should be ignored');
  }).not.toThrow();
});

test('evalAssert still records and throws inside an active eval scope', async () => {
  let capturedScope = getCurrentScope();
  let capturedIsInEvalScope = isInEvalScope();
  const { error, scope } = await runInEvalScope('assert-case', () => {
    capturedScope = getCurrentScope();
    capturedIsInEvalScope = isInEvalScope();
    evalAssert(false, 'expected failure');
  });

  expect(capturedScope).toBe(scope);
  expect(capturedIsInEvalScope).toBe(true);
  expect(error).toBeInstanceOf(EvalAssertionError);
  expect(scope.assertionFailures).toHaveLength(1);
  expect(scope.assertionFailures[0]?.message).toBe('expected failure');
  expect(scope.assertionFailures[0]?.stack).toContain(
    'EvalAssertionError: expected failure',
  );
});
