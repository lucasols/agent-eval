import { AsyncLocalStorage } from 'node:async_hooks';
import type { EvalTraceSpan } from '@agent-evals/shared';

export type EvalCaseScope = {
  caseId: string;
  outputs: Record<string, unknown>;
  assertionFailures: string[];
  spans: EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
  spanStack: string[];
  activeSpanStack: EvalTraceSpan[];
};

const scopeStorage = new AsyncLocalStorage<EvalCaseScope>();

export class EvalAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalAssertionError';
  }
}

export function getCurrentScope(): EvalCaseScope | undefined {
  return scopeStorage.getStore();
}

export async function runInEvalScope<T>(
  caseId: string,
  fn: () => Promise<T> | T,
): Promise<{
  result: T | undefined;
  scope: EvalCaseScope;
  error: Error | undefined;
}> {
  const scope: EvalCaseScope = {
    caseId,
    outputs: {},
    assertionFailures: [],
    spans: [],
    checkpoints: new Map(),
    spanStack: [],
    activeSpanStack: [],
  };
  return scopeStorage.run(scope, async () => {
    try {
      const result = await fn();
      return { result, scope, error: undefined };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { result: undefined, scope, error: err };
    }
  });
}

export function setOutput(key: string, value: unknown): void {
  const scope = scopeStorage.getStore();
  if (!scope) return;
  scope.outputs[key] = value;
}

export function incrementOutput(key: string, delta: number): void {
  const scope = scopeStorage.getStore();
  if (!scope) return;
  const existing = scope.outputs[key];
  if (existing === undefined) {
    scope.outputs[key] = delta;
    return;
  }
  if (typeof existing !== 'number') {
    scope.assertionFailures.push(
      `incrementOutput("${key}"): existing value is ${typeof existing}, expected number`,
    );
    return;
  }
  scope.outputs[key] = existing + delta;
}

export function evalAssert(condition: boolean, message: string): void {
  if (condition) return;
  const scope = scopeStorage.getStore();
  if (scope) {
    scope.assertionFailures.push(message);
  }
  throw new EvalAssertionError(message);
}
