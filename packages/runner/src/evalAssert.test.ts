import {
  appendToEvalOutput,
  EvalAssertionError,
  evalAssert,
  evalSpan,
  evalTracer,
  getCurrentScope,
  getEvalCaseInput,
  incrementEvalOutput,
  isInEvalScope,
  mergeEvalOutput,
  runInEvalScope,
  setEvalOutput,
  type TraceActiveSpan,
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
