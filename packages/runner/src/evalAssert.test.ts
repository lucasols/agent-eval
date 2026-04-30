import {
  appendToEvalOutput,
  EvalAssertionError,
  evalAssert,
  evalExpect,
  evalSpan,
  evalTracer,
  getCurrentScope,
  getEvalCaseInput,
  incrementEvalOutput,
  isInEvalScope,
  mergeEvalOutput,
  nextEvalId,
  runInEvalRuntimeScope,
  runInEvalScope,
  setEvalOutput,
  type TraceActiveSpan,
} from '@agent-evals/sdk';
import { expect, test } from 'vitest';

const approvedPattern = /approved/;

test('evalAssert is a no-op outside an active eval scope', () => {
  expect(getCurrentScope()).toBeUndefined();
  expect(isInEvalScope()).toBeNull();
  expect(getEvalCaseInput()).toBeUndefined();
  expect(getEvalCaseInput('customer.tier')).toBeUndefined();
  expect(() => nextEvalId()).toThrow(
    'nextEvalId() must be called inside an active eval case',
  );
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
  expect(capturedIsInEvalScope).toBe('eval');
  expect(error).toBeInstanceOf(EvalAssertionError);
  expect(scope.assertionFailures).toHaveLength(1);
  expect(scope.assertionFailures[0]?.message).toBe('expected failure');
  expect(scope.assertionFailures[0]?.stack).toContain(
    'EvalAssertionError: expected failure',
  );
});

test('evalAssert accepts any condition value and narrows truthy values', () => {
  const rawCaseId = getMaybeCaseId();
  evalAssert(rawCaseId, 'case id should be present');
  const narrowedCaseId: string = rawCaseId;

  expect(narrowedCaseId).toBe('refund-case');
});

function getMaybeCaseId(): string | undefined {
  return 'refund-case';
}

test('evalExpect is a no-op outside an active eval scope', () => {
  expect(() => {
    evalExpect('approved').toBe('denied');
  }).not.toThrow();
});

test('evalExpect passes focused comparison matchers', async () => {
  const { error, scope } = await runInEvalScope('expect-pass', () => {
    evalExpect('vip').toBe('vip');
    evalExpect({ decision: 'approve', totals: [1, 2] }).toEqual({
      decision: 'approve',
      totals: [1, 2],
    });
    evalExpect({
      customer: { tier: 'vip', region: 'br' },
      decision: 'approve',
    }).toMatchObject({ customer: { tier: 'vip' } });
    evalExpect('refund approved').toContain('approved');
    evalExpect(['refund', 'return']).toContain('refund');
    evalExpect(new Set(['vip', 'standard'])).toContain('vip');
    evalExpect(['refund', 'return']).toHaveLength(2);
    evalExpect({ customer: { tier: 'vip' } }).toHaveProperty(
      'customer.tier',
      'vip',
    );
    evalExpect(0.95).toBeGreaterThan(0.9);
    evalExpect(0.95).toBeGreaterThanOrEqual(0.95);
    evalExpect(0.95).toBeLessThan(1);
    evalExpect(0.95).toBeLessThanOrEqual(0.95);
    evalExpect(1.004).toBeCloseTo(1, 2);
    evalExpect('refund approved').toMatch(approvedPattern);
    evalExpect('refund approved').not.toContain('denied');
  });

  expect(error).toBeUndefined();
  expect(scope.assertionFailures).toEqual([]);
});

test('evalExpect records and throws comparison failures', async () => {
  const { error, scope } = await runInEvalScope('expect-fail', () => {
    evalExpect({ decision: 'deny' }).toMatchObject({ decision: 'approve' });
  });

  expect(error).toBeInstanceOf(EvalAssertionError);
  expect(scope.assertionFailures).toHaveLength(1);
  expect(scope.assertionFailures[0]?.message).toBe(
    "Expected { decision: 'deny' } to match object { decision: 'approve' }",
  );
  expect(scope.assertionFailures[0]?.stack).toContain(
    "EvalAssertionError: Expected { decision: 'deny' } to match object { decision: 'approve' }",
  );
});

test('evalExpect supports negated comparison failures', async () => {
  const { error, scope } = await runInEvalScope('expect-not-fail', () => {
    evalExpect('refund approved').not.toMatch(approvedPattern);
  });

  expect(error).toBeInstanceOf(EvalAssertionError);
  expect(scope.assertionFailures).toHaveLength(1);
  expect(scope.assertionFailures[0]?.message).toBe(
    'Expected refund approved not to match /approved/',
  );
});

test('isInEvalScope reports non-case runner phases', async () => {
  expect(getCurrentScope()).toBeUndefined();
  expect(isInEvalScope()).toBeNull();

  await runInEvalRuntimeScope('env', async () => {
    expect(getCurrentScope()).toBeUndefined();
    expect(isInEvalScope()).toBe('env');

    await runInEvalRuntimeScope('cases', () => {
      expect(getCurrentScope()).toBeUndefined();
      expect(isInEvalScope()).toBe('cases');
    });

    expect(isInEvalScope()).toBe('env');
  });

  expect(isInEvalScope()).toBeNull();
});

test('nextEvalId returns sequential IDs in the active eval scope', async () => {
  const first = await runInEvalScope(
    'first-case',
    () => [nextEvalId(), nextEvalId(), nextEvalId()],
    { idPrefix: 'refund-workflow-evals-refund-workflow-eval-ts-simple-text' },
  );
  const second = await runInEvalScope('second-case', () => [nextEvalId()], {
    idPrefix: 'refund-workflow-evals-refund-workflow-eval-ts-simple-text',
  });

  expect(first.result).toEqual([
    'refund-workflow-evals-refund-workflow-eval-ts-simple-text-1',
    'refund-workflow-evals-refund-workflow-eval-ts-simple-text-2',
    'refund-workflow-evals-refund-workflow-eval-ts-simple-text-3',
  ]);
  expect(second.result).toEqual([
    'refund-workflow-evals-refund-workflow-eval-ts-simple-text-1',
  ]);
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

test('eval output mutation helpers append, merge, and report bad types', async () => {
  const { scope } = await runInEvalScope('output-mutations', () => {
    appendToEvalOutput('events', 'created');
    appendToEvalOutput('events', 'approved');
    setEvalOutput('scalarEvents', 'first');
    appendToEvalOutput('scalarEvents', 'second');

    mergeEvalOutput('metadata', { attempt: 1, nested: { first: true } });
    mergeEvalOutput('metadata', { status: 'ok', nested: { second: true } });

    incrementEvalOutput('badCounter', 1);
    setEvalOutput('badCounter', 'not-number');
    incrementEvalOutput('badCounter', 1);
    setEvalOutput('badMerge', ['not-object']);
    mergeEvalOutput('badMerge', { ignored: true });
  });

  expect(scope.outputs.events).toEqual(['created', 'approved']);
  expect(scope.outputs.scalarEvents).toEqual(['first', 'second']);
  expect(scope.outputs.metadata).toEqual({
    attempt: 1,
    status: 'ok',
    nested: { second: true },
  });
  expect(scope.outputs.badCounter).toBe('not-number');
  expect(scope.outputs.badMerge).toEqual(['not-object']);
  expect(scope.assertionFailures.map((failure) => failure.message)).toEqual([
    'incrementEvalOutput("badCounter"): existing value is string, expected number',
    'mergeEvalOutput("badMerge"): existing value is array, expected object',
  ]);
});

test('span mutation helpers work on active, callback, and external handles', async () => {
  const { scope } = await runInEvalScope('span-mutations', async () => {
    await evalTracer.span(
      { kind: 'agent', name: 'active-span' },
      (span: TraceActiveSpan) => {
        evalSpan.incrementAttribute('costUsd', 0.25);
        evalSpan.incrementAttribute('costUsd', 0.5);
        evalSpan.appendToAttribute('events', 'started');
        evalSpan.appendToAttribute('events', 'finished');
        evalSpan.setAttribute('scalarEvents', 'first');
        evalSpan.appendToAttribute('scalarEvents', 'second');
        evalSpan.mergeAttribute('metadata', {
          attempt: 1,
          nested: { first: true },
        });
        evalSpan.mergeAttribute('metadata', {
          status: 'ok',
          nested: { second: true },
        });

        span.incrementAttribute('callbackCount', 1);
        span.appendToAttribute('callbackEvents', 'callback');
        span.mergeAttribute('callbackMeta', { source: 'callback' });

        evalSpan.setAttribute('badCounter', 'not-number');
        evalSpan.incrementAttribute('badCounter', 1);
        evalSpan.setAttribute('badMerge', ['not-object']);
        evalSpan.mergeAttribute('badMerge', { ignored: true });
      },
    );

    const externalSpan = evalTracer.startSpan({
      id: 'external-span',
      parentId: null,
      kind: 'tool',
      name: 'external-span',
    });
    externalSpan.incrementAttribute('attempts', 1);
    externalSpan.appendToAttribute('events', 'external');
    externalSpan.mergeAttribute('metadata', { source: 'external' });
    externalSpan.end();
  });

  const activeSpan = scope.spans.find((span) => span.name === 'active-span');
  expect(activeSpan?.attributes).toMatchObject({
    callbackCount: 1,
    callbackEvents: ['callback'],
    callbackMeta: { source: 'callback' },
    costUsd: 0.75,
    events: ['started', 'finished'],
    scalarEvents: ['first', 'second'],
    metadata: { attempt: 1, status: 'ok', nested: { second: true } },
    badCounter: 'not-number',
    badMerge: ['not-object'],
  });

  const externalSpan = scope.spans.find(
    (span) => span.name === 'external-span',
  );
  expect(externalSpan?.attributes).toMatchObject({
    attempts: 1,
    events: ['external'],
    metadata: { source: 'external' },
  });
  expect(scope.assertionFailures.map((failure) => failure.message)).toEqual([
    'evalSpan.incrementAttribute("badCounter"): existing value is string, expected number',
    'evalSpan.mergeAttribute("badMerge"): existing value is array, expected object',
  ]);
});
