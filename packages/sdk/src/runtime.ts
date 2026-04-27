import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  AssertionFailure,
  CacheEntry,
  CacheMode,
  CacheRecordingOp,
  EvalTraceSpan,
} from '@agent-evals/shared';

/**
 * Adapter used by the SDK to read and write cache entries.
 *
 * Implementations are typically injected by the runner before the eval case
 * starts executing.
 */
export type CacheAdapter = {
  /** Return the stored entry for `keyHash` under `namespace`, or `null`. */
  lookup(namespace: string, keyHash: string): Promise<CacheEntry | null>;
  /** Persist a cache entry. Must be safe under concurrent calls. */
  write(entry: CacheEntry): Promise<void>;
};

/** Runner-supplied cache context attached to an eval case scope. */
export type CacheScopeContext = {
  adapter: CacheAdapter;
  mode: CacheMode;
  evalId: string;
  /** Hash of the eval source file; used to invalidate on code changes. */
  codeFingerprint: string;
};

/** Active recording frame captured while a cached operation body executes. */
export type CacheRecordingFrame = {
  /** Length of `scope.spans` immediately before the cached body started. */
  baseSpanIndex: number;
  /** Parent id used when recording and replaying direct child spans. */
  replayParentSpanId: string | null;
  /** Ordered observable effects recorded during the cached body. */
  ops: CacheRecordingOp[];
};

/** Mutable per-case runtime state stored in async local storage. */
export type EvalCaseScope = {
  caseId: string;
  /** Authored input for the current case, when provided by the runner. */
  input?: unknown;
  outputs: Record<string, unknown>;
  /** Structured assertion failures recorded for the current case. */
  assertionFailures: AssertionFailure[];
  spans: EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
  spanStack: string[];
  activeSpanStack: EvalTraceSpan[];
  /**
   * Stack of active cache recorders. Ops are written to the top-most frame
   * when it exists and `replayingDepth === 0`.
   */
  recordingStack: CacheRecordingFrame[];
  /**
   * Incremented while replaying a cached operation, so nested SDK calls do not
   * accidentally double-record ops into outer recorders.
   */
  replayingDepth: number;
  /** Runner-provided cache adapter + mode; absent when caching is disabled. */
  cacheContext: CacheScopeContext | undefined;
};

const scopeStorage = new AsyncLocalStorage<EvalCaseScope>();
let activeEvalScopeCount = 0;

/** Error thrown when an eval assertion fails during case execution. */
export class EvalAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalAssertionError';
  }
}

/** Return the current eval scope for the active async context, if any. */
export function getCurrentScope(): EvalCaseScope | undefined {
  if (activeEvalScopeCount === 0) return undefined;
  return scopeStorage.getStore();
}

/**
 * Return whether the current async execution is inside an active eval case.
 *
 * This is useful for shared workflow code that wants to branch on eval-only
 * behavior without importing or inspecting the full eval scope.
 */
export function isInEvalScope(): boolean {
  return getCurrentScope() !== undefined;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function copyArray(value: unknown[]): unknown[] {
  return value.map((item: unknown) => item);
}

/**
 * Return the authored input for the current eval case.
 *
 * Pass a dot-separated path to read nested values, for example
 * `getEvalCaseInput('customer.tier')`. Calls outside an eval case scope return
 * `undefined` so shared workflow code can safely use this helper.
 */
export function getEvalCaseInput(): unknown;
export function getEvalCaseInput(path: string): unknown;
export function getEvalCaseInput(
  path: string | undefined = undefined,
): unknown {
  const scope = getCurrentScope();
  if (!scope) return undefined;
  if (path === undefined) return scope.input;
  if (path.length === 0) return undefined;

  let current = scope.input;
  for (const segment of path.split('.')) {
    if (segment.length === 0 || !isObjectLike(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/**
 * Attach cache context (adapter, mode, eval id, fingerprint) to a scope.
 *
 * Runner-internal helper called immediately before the user's `execute`
 * function runs inside `runInEvalScope`.
 */
export function setScopeCacheContext(
  scope: EvalCaseScope,
  context: CacheScopeContext,
): void {
  scope.cacheContext = context;
}

/** Optional inputs accepted when starting a new eval case scope. */
export type RunInEvalScopeOptions = {
  /** Authored input for the active eval case. */
  input?: unknown;
  /** Cache adapter + mode attached to the scope before `fn` runs. */
  cacheContext?: CacheScopeContext;
};

/**
 * Execute a callback inside a fresh eval case scope and capture its outputs,
 * trace data, and terminal error state.
 */
export async function runInEvalScope<T>(
  caseId: string,
  fn: () => Promise<T> | T,
  options: RunInEvalScopeOptions = {},
): Promise<{
  result: T | undefined;
  scope: EvalCaseScope;
  error: Error | undefined;
}> {
  const scope: EvalCaseScope = {
    caseId,
    input: options.input,
    outputs: {},
    assertionFailures: [],
    spans: [],
    checkpoints: new Map(),
    spanStack: [],
    activeSpanStack: [],
    recordingStack: [],
    replayingDepth: 0,
    cacheContext: options.cacheContext,
  };
  activeEvalScopeCount++;
  try {
    return await scopeStorage.run(scope, async () => {
      try {
        const result = await fn();
        return { result, scope, error: undefined };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { result: undefined, scope, error: err };
      }
    });
  } finally {
    activeEvalScopeCount--;
  }
}

function recordOpIfActive(scope: EvalCaseScope, op: CacheRecordingOp): void {
  if (scope.replayingDepth > 0) return;
  const top = scope.recordingStack.at(-1);
  if (top) top.ops.push(op);
}

function toAssertionFailure(
  message: string,
  error: Error | undefined = undefined,
): AssertionFailure {
  return error?.stack ? { message, stack: error.stack } : { message };
}

/**
 * Record or replace an output value for the current case scope.
 *
 * Supported values include scalars, JSON-safe objects/arrays, explicit file
 * refs, and native `Blob`/`File` instances for media or file columns.
 */
export function setEvalOutput(key: string, value: unknown): void {
  const scope = getCurrentScope();
  if (!scope) return;
  scope.outputs[key] = value;
  recordOpIfActive(scope, { kind: 'setOutput', key, value });
}

/**
 * Append an item to an output array in the current case scope.
 *
 * Missing values become `[value]`, existing arrays receive the item, and
 * existing scalar/object values are preserved as `[existing, value]`.
 */
export function appendToEvalOutput(key: string, value: unknown): void {
  const scope = getCurrentScope();
  if (!scope) return;
  const existing = scope.outputs[key];
  if (existing === undefined) {
    scope.outputs[key] = [value];
  } else if (Array.isArray(existing)) {
    scope.outputs[key] = [...copyArray(existing), value];
  } else {
    scope.outputs[key] = [existing, value];
  }
  recordOpIfActive(scope, { kind: 'appendOutput', key, value });
}

/**
 * Shallow-merge object fields into an output value in the current case scope.
 *
 * Missing values become a copy of `patch`. Non-object existing values are
 * recorded as assertion failures instead of being replaced.
 */
export function mergeEvalOutput(
  key: string,
  patch: Record<string, unknown>,
): void {
  const scope = getCurrentScope();
  if (!scope) return;
  const existing = scope.outputs[key];
  if (existing === undefined) {
    scope.outputs[key] = { ...patch };
    recordOpIfActive(scope, { kind: 'mergeOutput', key, patch });
    return;
  }
  if (!isObjectRecord(existing)) {
    scope.assertionFailures.push(
      toAssertionFailure(
        `mergeEvalOutput("${key}"): existing value is ${Array.isArray(existing) ? 'array' : typeof existing}, expected object`,
      ),
    );
    return;
  }
  scope.outputs[key] = { ...existing, ...patch };
  recordOpIfActive(scope, { kind: 'mergeOutput', key, patch });
}

/**
 * Add a numeric delta to an output value in the current case scope.
 *
 * If the existing value is non-numeric, the operation is recorded as an
 * assertion failure instead of mutating the output.
 */
export function incrementEvalOutput(key: string, delta: number): void {
  const scope = getCurrentScope();
  if (!scope) return;
  const existing = scope.outputs[key];
  if (existing === undefined) {
    scope.outputs[key] = delta;
    recordOpIfActive(scope, { kind: 'incrementOutput', key, delta });
    return;
  }
  if (typeof existing !== 'number') {
    scope.assertionFailures.push(
      toAssertionFailure(
        `incrementEvalOutput("${key}"): existing value is ${typeof existing}, expected number`,
      ),
    );
    return;
  }
  scope.outputs[key] = existing + delta;
  recordOpIfActive(scope, { kind: 'incrementOutput', key, delta });
}

/**
 * Assert a condition for the current eval case and throw on failure.
 *
 * Calls made outside `runInEvalScope(...)` are ignored so shared workflow code
 * can safely reuse `evalAssert(...)` when it also runs outside an eval.
 */
export function evalAssert(condition: boolean, message: string): void {
  if (condition) return;
  const scope = getCurrentScope();
  if (!scope) return;
  const error = new EvalAssertionError(message);
  scope.assertionFailures.push(toAssertionFailure(message, error));
  throw error;
}
