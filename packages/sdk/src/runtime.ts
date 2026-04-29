import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  AssertionFailure,
  CacheEntry,
  CacheMode,
  CacheRecordingOp,
  EvalTraceSpan,
  TraceCacheRef,
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
  /** Stable prefix used by `nextEvalId()` for this eval case scope. */
  idPrefix: string | undefined;
  /** Monotonic per-scope counter used by `nextEvalId()`. */
  nextEvalIdCounter: number;
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
  /**
   * Value-cache refs recorded by `evalTracer.cache(...)` calls made with no
   * active span. Span-bound refs are appended to the owning span's
   * `cache.refs` attribute instead.
   */
  caseCacheRefs: TraceCacheRef[];
  /** Background promises that should settle before the case scope finalizes. */
  pendingBackgroundJobs: Set<Promise<unknown>>;
};

/**
 * Runtime phase currently owned by the eval runner.
 *
 * `null` means the current async execution is outside an eval run. `env`
 * covers run-time module/environment loading, including top-level code in
 * modules imported while a run is being prepared.
 */
export type EvalRuntimeScope =
  | 'env'
  | 'cases'
  | 'eval'
  | 'derive'
  | 'outputsSchema'
  | 'scorer';

const scopeStorage = new AsyncLocalStorage<EvalCaseScope>();
const runtimeScopeStorage = new AsyncLocalStorage<EvalRuntimeScope>();
let activeEvalScopeCount = 0;
let activeEvalRuntimeScopeCount = 0;

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
 * Return the current eval runner phase for this async execution.
 *
 * Returns `null` outside eval-owned work, `env` while the runner is loading
 * eval modules for a run, `cases` while generating cases, `eval` while running
 * case `execute`, `derive` while deriving outputs from traces, `outputsSchema`
 * while validating outputs, and `scorer` while computing scores.
 */
export function isInEvalScope(): EvalRuntimeScope | null {
  if (activeEvalRuntimeScopeCount === 0) return null;
  return runtimeScopeStorage.getStore() ?? null;
}

function registerBackgroundJobInScope<T>(
  scope: EvalCaseScope,
  promise: Promise<T>,
): Promise<T> {
  const trackedPromise = promise.then(
    () => {
      scope.pendingBackgroundJobs.delete(trackedPromise);
    },
    () => {
      scope.pendingBackgroundJobs.delete(trackedPromise);
    },
  );
  scope.pendingBackgroundJobs.add(trackedPromise);
  return promise;
}

async function drainBackgroundJobs(scope: EvalCaseScope): Promise<void> {
  while (scope.pendingBackgroundJobs.size > 0) {
    await Promise.allSettled([...scope.pendingBackgroundJobs]);
  }
}

/**
 * Register background work that should settle before eval finalization.
 *
 * The original promise is returned unchanged, and its fulfillment or rejection
 * behavior remains normal for callers. The eval runtime only waits for
 * settlement; it does not convert background rejections into case errors.
 */
export function startEvalBackgroundJob<T>(promise: Promise<T>): Promise<T> {
  const scope = getCurrentScope();
  if (!scope) return promise;
  return registerBackgroundJobInScope(scope, promise);
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
  /** Stable prefix used when generating scoped IDs with `nextEvalId()`. */
  idPrefix?: string;
  /** Cache adapter + mode attached to the scope before `fn` runs. */
  cacheContext?: CacheScopeContext;
  /** Whether registered background jobs should settle before scope finalizes. */
  waitForBackgroundJobs?: boolean;
  /** Eval runner phase exposed through `isInEvalScope()`. Defaults to `eval`. */
  runtimeScope?: EvalRuntimeScope;
};

/** Execute a callback while `isInEvalScope()` reports a runner phase. */
export async function runInEvalRuntimeScope<T>(
  runtimeScope: EvalRuntimeScope,
  fn: () => Promise<T> | T,
): Promise<T> {
  activeEvalRuntimeScopeCount++;
  try {
    return await runtimeScopeStorage.run(runtimeScope, fn);
  } finally {
    activeEvalRuntimeScopeCount--;
  }
}

/**
 * Execute a callback with an existing case scope and a specific runner phase.
 *
 * Runner-internal helper for post-execute phases that still need access to the
 * completed case scope through output, trace, assertion, and input helpers.
 */
export async function runInExistingEvalScope<T>(
  scope: EvalCaseScope,
  runtimeScope: EvalRuntimeScope,
  fn: () => Promise<T> | T,
): Promise<T> {
  activeEvalScopeCount++;
  try {
    return await scopeStorage.run(scope, async () => {
      return await runInEvalRuntimeScope(runtimeScope, fn);
    });
  } finally {
    activeEvalScopeCount--;
  }
}

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
    idPrefix: options.idPrefix,
    nextEvalIdCounter: 0,
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
    caseCacheRefs: [],
    pendingBackgroundJobs: new Set(),
  };
  return await runInExistingEvalScope(
    scope,
    options.runtimeScope ?? 'eval',
    async () => {
      try {
        const result = await fn();
        if (options.waitForBackgroundJobs !== false) {
          await drainBackgroundJobs(scope);
        }
        return { result, scope, error: undefined };
      } catch (error) {
        if (options.waitForBackgroundJobs !== false) {
          await drainBackgroundJobs(scope);
        }
        const err = error instanceof Error ? error : new Error(String(error));
        return { result: undefined, scope, error: err };
      }
    },
  );
}

/**
 * Return the next deterministic ID for the active eval case execution.
 *
 * The runner derives the ID prefix from the eval file, eval id, and case id,
 * then this helper appends a per-scope sequence number. Calls outside an
 * active eval case scope throw so accidental product-code usage is caught
 * immediately.
 */
export function nextEvalId(): string {
  const scope = getCurrentScope();
  if (!scope) {
    throw new Error('nextEvalId() must be called inside an active eval case');
  }
  if (scope.idPrefix === undefined) {
    throw new Error('nextEvalId() requires a runner-provided eval id prefix');
  }
  scope.nextEvalIdCounter++;
  return `${scope.idPrefix}-${scope.nextEvalIdCounter}`;
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
