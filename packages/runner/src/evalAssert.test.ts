import {
  EvalAssertionError,
  evalAssert,
  getCurrentScope,
  getEvalCaseInput,
  isInEvalScope,
  runInEvalScope,
} from '@agent-evals/sdk';
import { expect, test } from 'vitest';

test('evalAssert is a no-op outside an active eval scope', () => {
  expect(getCurrentScope()).toBeUndefined();
  expect(isInEvalScope()).toBe(false);
  expect(getEvalCaseInput()).toBeUndefined();
  expect(getEvalCaseInput('customer.tier')).toBeUndefined();
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

test('getEvalCaseInput reads the active case input', async () => {
  const input = {
    customer: { tier: 'gold' },
    items: [{ id: 'item-1' }],
    message: 'Refund request',
    metadata: null,
  };

  await runInEvalScope(
    'input-case',
    () => {
      expect(getEvalCaseInput()).toBe(input);
      expect(getEvalCaseInput('message')).toBe('Refund request');
      expect(getEvalCaseInput('customer.tier')).toBe('gold');
      expect(getEvalCaseInput('items.0.id')).toBe('item-1');
      expect(getEvalCaseInput('customer.missing')).toBeUndefined();
      expect(getEvalCaseInput('metadata.value')).toBeUndefined();
      expect(getEvalCaseInput('message.length.value')).toBeUndefined();
      expect(getEvalCaseInput('')).toBeUndefined();
      expect(getEvalCaseInput('customer..tier')).toBeUndefined();
    },
    { input },
  );
});
