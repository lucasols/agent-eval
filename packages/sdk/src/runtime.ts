import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  CacheEntry,
  CacheMode,
  CacheRecordingOp,
  EvalTraceSpan,
} from '@agent-evals/shared';

/**
 * Adapter used by the SDK to read and write cache entries for cached spans.
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

/** Active recording frame captured while a cached span body executes. */
export type CacheRecordingFrame = {
  /** Length of `scope.spans` immediately before the cached body started. */
  baseSpanIndex: number;
  /** Id of the cached span that owns this recording. */
  cachedSpanId: string;
  /** Ordered observable effects recorded during the cached body. */
  ops: CacheRecordingOp[];
};

/** Mutable per-case runtime state stored in async local storage. */
export type EvalCaseScope = {
  caseId: string;
  outputs: Record<string, unknown>;
  assertionFailures: string[];
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
   * Incremented while replaying a cached span, so nested SDK calls do not
   * accidentally double-record ops into outer recorders.
   */
  replayingDepth: number;
  /** Runner-provided cache adapter + mode; absent when caching is disabled. */
  cacheContext: CacheScopeContext | undefined;
};

const scopeStorage = new AsyncLocalStorage<EvalCaseScope>();

/** Error thrown when an eval assertion fails during case execution. */
export class EvalAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalAssertionError';
  }
}

/** Return the current eval scope for the active async context, if any. */
export function getCurrentScope(): EvalCaseScope | undefined {
  return scopeStorage.getStore();
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

function recordOpIfActive(scope: EvalCaseScope, op: CacheRecordingOp): void {
  if (scope.replayingDepth > 0) return;
  const top = scope.recordingStack.at(-1);
  if (top) top.ops.push(op);
}

/** Record or replace an output value for the current case scope. */
export function setOutput(key: string, value: unknown): void {
  const scope = scopeStorage.getStore();
  if (!scope) return;
  scope.outputs[key] = value;
  recordOpIfActive(scope, { kind: 'setOutput', key, value });
}

/**
 * Add a numeric delta to an output value in the current case scope.
 *
 * If the existing value is non-numeric, the operation is recorded as an
 * assertion failure instead of mutating the output.
 */
export function incrementOutput(key: string, delta: number): void {
  const scope = scopeStorage.getStore();
  if (!scope) return;
  const existing = scope.outputs[key];
  if (existing === undefined) {
    scope.outputs[key] = delta;
    recordOpIfActive(scope, { kind: 'incrementOutput', key, delta });
    return;
  }
  if (typeof existing !== 'number') {
    scope.assertionFailures.push(
      `incrementOutput("${key}"): existing value is ${typeof existing}, expected number`,
    );
    return;
  }
  scope.outputs[key] = existing + delta;
  recordOpIfActive(scope, { kind: 'incrementOutput', key, delta });
}

/** Assert a condition for the current case and throw on failure. */
export function evalAssert(condition: boolean, message: string): void {
  if (condition) return;
  const scope = scopeStorage.getStore();
  if (scope) {
    scope.assertionFailures.push(message);
  }
  throw new EvalAssertionError(message);
}
