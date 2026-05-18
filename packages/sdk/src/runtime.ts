import { AsyncLocalStorage } from 'node:async_hooks';
import { formatWithOptions } from 'node:util';
import type {
  AssertionFailure,
  AssertionResult,
  CacheEntry,
  CacheOperationType,
  CacheMode,
  CacheRecordingOp,
  EvalColumnOverride,
  EvalTraceSpan,
  RunLogEntry,
  RunLogLevel,
  RunLogLocation,
  RunLogPhase,
  TraceCacheRef,
} from '@agent-evals/shared';
import { matchesEvalTagInput } from '@agent-evals/shared';
import dayjs from 'dayjs';
import type { CacheSerializationExternalJsonStore } from './cacheSerialization.ts';
import { stripTerminalControlCodes } from './stackFormatting.ts';
import type {
  EvalOutputOptions,
  EvalStartTime,
  EvalTagMatchInput,
} from './types.ts';

declare global {
  var __agentEvalsRealDate: DateConstructor | undefined;
}

/**
 * Raw-key debug payload passed alongside cache writes.
 *
 * `rawKey` may include prompt text, user input, or other sensitive material.
 * Runners store it outside the reusable cache so projects can gitignore the
 * debug folder while keeping hash-only cache entries shareable.
 */
export type CacheDebugKeyWrite = {
  rawKey: unknown;
  operationType: CacheOperationType;
  operationName: string;
};

/**
 * Adapter used by the SDK to read and write cache entries.
 *
 * Implementations are typically injected by the runner before the eval case
 * starts executing.
 */
export type CacheAdapter = {
  /** Return the stored entry for `keyHash` under `namespace`, or `null`. */
  lookup(namespace: string, keyHash: string): Promise<CacheEntry | null>;
  /** Optional store for large nested JSON values persisted outside cache JSON. */
  externalJsonStore?: CacheSerializationExternalJsonStore;
  /**
   * Persist a cache entry. Must be safe under concurrent calls.
   *
   * `debugKey` is optional and contains the authored raw key value for
   * debugging. It may contain sensitive prompt/input data and should be stored
   * separately from reusable cache files.
   */
  write(entry: CacheEntry, debugKey?: CacheDebugKeyWrite): Promise<void>;
};

/** Runner-supplied cache context attached to an eval case scope. */
export type CacheScopeContext = {
  adapter: CacheAdapter;
  mode: CacheMode;
  evalId: string;
  /**
   * Whether cache lookups are allowed for this eval scope. Defaults to `true`.
   *
   * Run-level `bypass` and `refresh` modes still take precedence and skip
   * reads even when this is enabled.
   */
  read?: boolean;
  /**
   * Whether cache writes are allowed for this eval scope. Defaults to `true`.
   *
   * Run-level `bypass` still takes precedence and skips writes even when this
   * is enabled.
   */
  store?: boolean;
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

type EvalClockState = {
  startMs: number;
  realStartMs: number;
  offsetMs: number;
  frozen: boolean;
  shifted: boolean;
};

/** Mutable per-case runtime state stored in async local storage. */
export type EvalCaseScope = {
  caseId: string;
  /** Initial wall-clock time used by Date APIs inside this eval case. */
  startTime: EvalStartTime | undefined;
  /** Mutable shifted wall-clock state shared across this eval case's phases. */
  evalClockState: {
    startMs: number;
    realStartMs: number;
    offsetMs: number;
    frozen: boolean;
    shifted: boolean;
  };
  /** Stable prefix used by `nextEvalId()` for this eval case scope. */
  idPrefix: string | undefined;
  /** Monotonic per-scope counter used by `nextEvalId()`. */
  nextEvalIdCounter: number;
  /** Authored input for the current case, when provided by the runner. */
  input?: unknown;
  /** Effective tags for the current case. */
  tags: string[];
  outputs: Record<string, unknown>;
  /** Runtime display overrides recorded by output helpers for this case. */
  outputColumnOverrides: Record<string, EvalColumnOverride>;
  /** Structured assertion results recorded for the current case. */
  assertions: AssertionResult[];
  /** Structured assertion failures recorded for the current case. */
  assertionFailures: AssertionFailure[];
  /** Logs captured from manual `evalLog(...)` calls and enabled console calls. */
  logs: RunLogEntry[];
  spans: EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
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
const evalClockStorage = new AsyncLocalStorage<EvalClockState>();
const activeSpanStackStorage = new AsyncLocalStorage<EvalTraceSpan[]>();
let activeEvalScopeCount = 0;
let activeEvalRuntimeScopeCount = 0;
let consoleCaptureEnabled = true;

const defaultEvalStartTimeIso = '2026-04-10T00:00:00.000Z';
const defaultEvalStartTimeMs = Date.parse(defaultEvalStartTimeIso);
const realDate = globalThis.__agentEvalsRealDate ?? Date;
globalThis.__agentEvalsRealDate = realDate;

function toDateConstructorArg(value: unknown): string | number | Date {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    value instanceof realDate
  ) {
    return value;
  }
  return Number(value);
}

function toDateNumberArg(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function constructDateFromArgs(args: readonly unknown[]): Date {
  if (args.length === 0) return new realDate();
  if (args.length === 1) return new realDate(toDateConstructorArg(args[0]));

  const year = toDateNumberArg(args[0]);
  const month = toDateNumberArg(args[1]);
  const day = args[2] === undefined ? 1 : toDateNumberArg(args[2]);
  const hours = args[3] === undefined ? 0 : toDateNumberArg(args[3]);
  const minutes = args[4] === undefined ? 0 : toDateNumberArg(args[4]);
  const seconds = args[5] === undefined ? 0 : toDateNumberArg(args[5]);
  const ms = args[6] === undefined ? 0 : toDateNumberArg(args[6]);
  return new realDate(year, month, day, hours, minutes, seconds, ms);
}

const evalDate: DateConstructor = new Proxy(realDate, {
  apply(target, thisArg, argArray_) {
    const nowMs = getEvalClockNowMs();
    if (nowMs !== null) {
      return new target(nowMs).toString();
    }
    return target.call(thisArg);
  },
  construct(target, argArray, newTarget_) {
    const nowMs = getEvalClockNowMs();
    if (argArray.length === 0 && nowMs !== null) {
      return new target(nowMs);
    }
    return constructDateFromArgs(Array.from<unknown>(argArray));
  },
  get(target, property) {
    if (property === 'now') return getEvalDateNow;
    if (property === 'parse') return target.parse;
    if (property === 'UTC') return target.UTC;
    if (property === 'prototype') return target.prototype;
    if (property === 'name') return target.name;
    if (property === 'length') return target.length;
    return undefined;
  },
});

globalThis.Date = evalDate;

const maxLogMessageLength = 20_000;
const maxLogStringLength = 10_000;
const maxLogArrayLength = 100;
const maxLogObjectEntries = 100;
const maxLogValueDepth = 5;
const consoleCaptureMethods = ['log', 'info', 'warn', 'error'] as const;
type ConsoleCaptureMethod = (typeof consoleCaptureMethods)[number];
type EvalLogLevelInput = RunLogLevel | 'warning';
const runtimeConsole = globalThis.console;
type LogValueContext = { seen: WeakSet<object>; truncated: boolean };
const stackFrameLocationPattern =
  /(?:\((?<parenFile>.+):(?<parenLine>\d+):(?<parenColumn>\d+)\)|at (?<bareFile>.+):(?<bareLine>\d+):(?<bareColumn>\d+))$/;
const fileUrlPrefixPattern = /^file:\/\//;

const originalConsoleMethods: Record<
  ConsoleCaptureMethod,
  (...args: unknown[]) => void
> = {
  log: runtimeConsole.log.bind(runtimeConsole),
  info: runtimeConsole.info.bind(runtimeConsole),
  warn: runtimeConsole.warn.bind(runtimeConsole),
  error: runtimeConsole.error.bind(runtimeConsole),
};

/** Error thrown when an eval assertion fails during case execution. */
export class EvalAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalAssertionError';
  }
}

function getEvalClockStateNowMs(state: Exclude<EvalClockState, null>): number {
  const elapsedMs = state.frozen ? 0 : realDate.now() - state.realStartMs;
  return state.startMs + elapsedMs + state.offsetMs;
}

function getEvalClockNowMs(): number | null {
  const state = evalClockStorage.getStore();
  if (state?.shifted !== true) return null;
  return getEvalClockStateNowMs(state);
}

function getEvalDateNow(): number {
  return getEvalClockNowMs() ?? realDate.now();
}

/** Return the host process clock, bypassing the eval Date shim. */
export function getRealDateNowMs(): number {
  return realDate.now();
}

/** Return the shifted wall-clock time for a stored eval clock state. */
export function getEvalClockStateTimeMs(state: {
  startMs: number;
  realStartMs: number;
  offsetMs: number;
  frozen: boolean;
  shifted: boolean;
}): number | null {
  if (!state.shifted) return null;
  return getEvalClockStateNowMs(state);
}

function getActiveEvalClockState(apiName: string): EvalClockState {
  const state = evalClockStorage.getStore();
  if (state === undefined) {
    throw new Error(`${apiName} must be used inside an active eval`);
  }
  return state;
}

/**
 * Eval time helpers for reading and moving the active eval clock.
 *
 * `startTime` is a Dayjs object for the wall-clock start captured for the
 * active eval. For `startTime: 'now'`, it reflects the real time captured when
 * the eval clock context was created. Dayjs objects are immutable, so
 * `evalTime.startTime.add(5, 'minutes')` computes a derived time without
 * moving the active eval clock.
 */
export const evalTime: {
  /** Create a Dayjs object with the same arguments as `dayjs(...)`. */
  dayjs: typeof dayjs;
  /** Dayjs wall-clock start captured for the active eval. */
  readonly startTime: dayjs.Dayjs;
  /**
   * Move the active shifted Date clock and return the new current eval time.
   *
   * Throws outside an active shifted eval clock. Evals that set
   * `startTime: 'now'` use the real current clock unless `freezeTime: true` is
   * also set.
   */
  advance: (amount: number, unit: dayjs.ManipulateType) => dayjs.Dayjs;
} = {
  dayjs,
  get startTime() {
    return dayjs(getActiveEvalClockState('evalTime.startTime').startMs);
  },
  advance(amount, unit) {
    const state = getActiveEvalClockState('evalTime.advance(...)');
    if (!state.shifted) {
      throw new Error(
        'evalTime.advance(...) requires a shifted eval clock. Remove startTime: "now" or set freezeTime: true to use it.',
      );
    }
    if (!Number.isFinite(amount)) {
      throw new Error('evalTime.advance(...) amount must be a finite number');
    }
    const currentMs = getEvalClockStateNowMs(state);
    const advancedMs = dayjs(currentMs).add(amount, unit).valueOf();
    state.offsetMs += advancedMs - currentMs;
    return dayjs(getEvalClockStateNowMs(state));
  },
};

function resolveEvalStartTimeMs(startTime: EvalStartTime | undefined): number {
  if (startTime === undefined) return defaultEvalStartTimeMs;
  if (startTime === 'now') return realDate.now();
  const ms =
    startTime instanceof realDate
      ? startTime.getTime()
      : typeof startTime === 'number'
        ? startTime
        : realDate.parse(startTime);
  if (Number.isFinite(ms)) return ms;
  throw new Error(
    `Invalid eval startTime "${String(startTime)}". Use a Date, timestamp, ISO date string, or "now".`,
  );
}

function createEvalClockState(
  startTime: EvalStartTime | undefined,
  freezeTime: boolean,
): EvalClockState {
  const nowMs = realDate.now();
  const startMs =
    startTime === 'now' ? nowMs : resolveEvalStartTimeMs(startTime);
  return {
    startMs,
    realStartMs: nowMs,
    offsetMs: 0,
    frozen: freezeTime,
    shifted: startTime !== 'now' || freezeTime,
  };
}

/** Execute a callback with the eval Date clock shifted from `startTime`. */
export async function runWithEvalClock<T>(
  startTime: EvalStartTime | undefined,
  fn: () => Promise<T> | T,
  options: { freezeTime?: boolean } = {},
): Promise<T> {
  return await evalClockStorage.run(
    createEvalClockState(startTime, options.freezeTime === true),
    fn,
  );
}

/** Return the current eval scope for the active async context, if any. */
export function getCurrentScope(): EvalCaseScope | undefined {
  if (activeEvalScopeCount === 0) return undefined;
  return scopeStorage.getStore();
}

/** Return the span currently active in this async execution, if any. */
export function getCurrentActiveSpan(): EvalTraceSpan | undefined {
  if (activeEvalScopeCount === 0) return undefined;
  return activeSpanStackStorage.getStore()?.at(-1);
}

/** Execute a callback with a span added to this async execution's active stack. */
export async function runWithActiveSpan<T>(
  span: EvalTraceSpan,
  fn: () => Promise<T> | T,
): Promise<T> {
  const currentStack = activeSpanStackStorage.getStore() ?? [];
  return await activeSpanStackStorage.run([...currentStack, span], fn);
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

/**
 * Return whether the current eval case has tags matching the typed input.
 *
 * Calls outside an eval case scope return `false`.
 */
export function matchesEvalTags(input: EvalTagMatchInput): boolean {
  const scope = getCurrentScope();
  if (scope === undefined) return false;
  return matchesEvalTagInput(scope.tags, input);
}

function normalizeLogLevel(level: EvalLogLevelInput): RunLogLevel {
  return level === 'warning' ? 'warn' : level;
}

function getCurrentLogPhase(): RunLogPhase | null {
  const runtimeScope = runtimeScopeStorage.getStore();
  if (
    runtimeScope === 'eval' ||
    runtimeScope === 'derive' ||
    runtimeScope === 'outputsSchema' ||
    runtimeScope === 'scorer'
  ) {
    return runtimeScope;
  }
  return null;
}

function formatLogArgs(args: unknown[]): {
  message: string;
  truncated: boolean;
} {
  const formatted = formatWithOptions(
    {
      depth: 2,
      maxArrayLength: 100,
      maxStringLength: 10_000,
      breakLength: 80,
      compact: 3,
    },
    ...args,
  );
  if (formatted.length <= maxLogMessageLength) {
    return { message: formatted, truncated: false };
  }
  return {
    message: `${formatted.slice(0, maxLogMessageLength)}...`,
    truncated: true,
  };
}

function truncateLogString(value: string, ctx: LogValueContext): string {
  if (value.length <= maxLogStringLength) return value;
  ctx.truncated = true;
  return `${value.slice(0, maxLogStringLength)}...`;
}

function primitiveToLogValue(
  value: unknown,
  ctx: LogValueContext,
): { handled: boolean; value: unknown } {
  if (typeof value === 'string') {
    return { handled: true, value: truncateLogString(value, ctx) };
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { handled: true, value };
  }
  if (value === undefined) return { handled: true, value: '[undefined]' };
  if (typeof value === 'bigint') {
    return { handled: true, value: `${value.toString()}n` };
  }
  if (typeof value === 'symbol') return { handled: true, value: String(value) };
  if (typeof value === 'function') {
    return {
      handled: true,
      value: `[Function${value.name.length > 0 ? `: ${value.name}` : ''}]`,
    };
  }
  return { handled: false, value: null };
}

function objectToLogValue(
  value: object,
  ctx: LogValueContext,
  depth: number,
): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (ctx.seen.has(value)) return '[Circular]';
  if (depth >= maxLogValueDepth) {
    ctx.truncated = true;
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }

  ctx.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const limited = value
        .slice(0, maxLogArrayLength)
        .map((item) => toLogJsonValue(item, ctx, depth + 1));
      if (value.length > maxLogArrayLength) {
        ctx.truncated = true;
        limited.push(`[... ${String(value.length - maxLogArrayLength)} more]`);
      }
      return limited;
    }

    const entries = Object.entries(value);
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, maxLogObjectEntries)) {
      result[key] = toLogJsonValue(entryValue, ctx, depth + 1);
    }
    if (entries.length > maxLogObjectEntries) {
      ctx.truncated = true;
      result.__truncated = `${String(entries.length - maxLogObjectEntries)} more properties`;
    }
    return result;
  } finally {
    ctx.seen.delete(value);
  }
}

function toLogJsonValue(
  value: unknown,
  ctx: LogValueContext,
  depth: number,
): unknown {
  const primitive = primitiveToLogValue(value, ctx);
  if (primitive.handled) return primitive.value;
  if (typeof value === 'object' && value !== null) {
    return objectToLogValue(value, ctx, depth);
  }
  return String(value);
}

function toLogJsonArgs(args: unknown[]): {
  args: unknown[];
  truncated: boolean;
} {
  const ctx: LogValueContext = {
    seen: new WeakSet<object>(),
    truncated: false,
  };
  return {
    args: args.map((value) => toLogJsonValue(value, ctx, 0)),
    truncated: ctx.truncated,
  };
}

function normalizeStackFile(value: string): string {
  if (!value.startsWith('file://')) return value;
  return decodeURIComponent(value.replace(fileUrlPrefixPattern, ''));
}

function isInternalLogFrame(file: string): boolean {
  const normalizedFile = file.replaceAll('\\', '/');
  return (
    normalizedFile.includes('/packages/sdk/src/runtime.ts') ||
    normalizedFile.includes('/packages/sdk/dist/') ||
    normalizedFile.includes('/node_modules/@agent-evals/sdk/dist/') ||
    normalizedFile.includes('/node_modules/@ls-stack/agent-eval/dist/') ||
    normalizedFile.includes('/node:internal/') ||
    normalizedFile.startsWith('node:internal/')
  );
}

function parseStackFrameLocation(line: string): RunLogLocation | null {
  const match = stackFrameLocationPattern.exec(line.trim());
  if (!match?.groups) return null;
  const file = match.groups.parenFile ?? match.groups.bareFile;
  const lineNumber = Number(match.groups.parenLine ?? match.groups.bareLine);
  const column = Number(match.groups.parenColumn ?? match.groups.bareColumn);
  if (
    file === undefined ||
    !Number.isFinite(lineNumber) ||
    !Number.isFinite(column)
  ) {
    return null;
  }
  return { file: normalizeStackFile(file), line: lineNumber, column };
}

function getLogLocation(): RunLogLocation | undefined {
  const stack = new Error().stack;
  if (stack === undefined) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    const location = parseStackFrameLocation(line);
    if (location === null || isInternalLogFrame(location.file)) continue;
    return { ...location, stack };
  }
  return undefined;
}

function recordEvalLog(level: EvalLogLevelInput, args: unknown[]): void {
  const scope = getCurrentScope();
  const phase = getCurrentLogPhase();
  if (!scope || !phase) return;
  const preview = formatLogArgs(args);
  const jsonArgs = toLogJsonArgs(args);
  const location = getLogLocation();
  scope.logs.push({
    timestamp: new Date().toISOString(),
    level: normalizeLogLevel(level),
    phase,
    message: preview.message,
    args: jsonArgs.args,
    truncated: preview.truncated || jsonArgs.truncated,
    location,
  });
}

for (const method of consoleCaptureMethods) {
  runtimeConsole[method] = (...args: unknown[]) => {
    if (consoleCaptureEnabled) {
      recordEvalLog(method, args);
    }
    originalConsoleMethods[method](...args);
  };
}

/**
 * Configure whether console methods are captured as eval case logs.
 *
 * Runner-internal helper. When disabled, console output still prints normally;
 * only automatic persistence to `caseDetail.logs` is skipped. Manual
 * `evalLog(...)` calls are unaffected.
 */
export function configureEvalRunLogs(options: {
  captureConsole: boolean;
}): void {
  consoleCaptureEnabled = options.captureConsole;
}

/**
 * Record a manual log entry on the active eval case.
 *
 * Values are formatted with Node-style console formatting and capped before
 * persistence so a single log cannot make run artifacts unbounded. Calls made
 * outside active case-owned eval phases are ignored.
 */
export function evalLog(level: EvalLogLevelInput, ...args: unknown[]): void {
  recordEvalLog(level, args);
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
  /** Effective tags for the active eval case. */
  tags?: string[];
  /** Stable prefix used when generating scoped IDs with `nextEvalId()`. */
  idPrefix?: string;
  /** Cache adapter + mode attached to the scope before `fn` runs. */
  cacheContext?: CacheScopeContext;
  /** Whether registered background jobs should settle before scope finalizes. */
  waitForBackgroundJobs?: boolean;
  /** Eval runner phase exposed through `isInEvalScope()`. Defaults to `eval`. */
  runtimeScope?: EvalRuntimeScope;
  /** Initial wall-clock time used by `new Date()` and `Date.now()` in this eval. */
  startTime?: EvalStartTime;
  /** Whether Date APIs stay frozen until advanced manually. */
  freezeTime?: boolean;
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
      return await evalClockStorage.run(scope.evalClockState, async () => {
        return await runInEvalRuntimeScope(runtimeScope, fn);
      });
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
    startTime: options.startTime,
    evalClockState: createEvalClockState(
      options.startTime,
      options.freezeTime === true,
    ),
    idPrefix: options.idPrefix,
    nextEvalIdCounter: 0,
    input: options.input,
    tags: options.tags ?? [],
    outputs: {},
    outputColumnOverrides: {},
    assertions: [],
    assertionFailures: [],
    logs: [],
    spans: [],
    checkpoints: new Map(),
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

function normalizeEvalOutputOptions(
  options: EvalOutputOptions | undefined,
): EvalColumnOverride | undefined {
  if (options === undefined) return undefined;
  if (typeof options === 'string') return { format: options };
  return options;
}

function toAssertionFailure(
  message: string,
  error: Error | undefined = undefined,
): AssertionFailure {
  const name = error?.name;
  const stack = error?.stack
    ? stripTerminalControlCodes(error.stack)
    : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    message,
    ...(stack !== undefined ? { stack } : {}),
  };
}

/**
 * Record or replace an output value for the current case scope.
 *
 * Supported values include scalars, JSON-safe objects/arrays, explicit file
 * refs, and native `Blob`/`File` instances for media or file columns.
 *
 * Pass the optional third argument to persist a display format or full column
 * override with this runtime output, for example `'markdown'` or
 * `{ label: 'Receipt', format: 'image', hideInTable: true }`.
 */
export function setEvalOutput(
  key: string,
  value: unknown,
  options: EvalOutputOptions | undefined = undefined,
): void {
  const scope = getCurrentScope();
  if (!scope) return;
  scope.outputs[key] = value;
  const column = normalizeEvalOutputOptions(options);
  if (column !== undefined) {
    scope.outputColumnOverrides[key] = column;
  }
  recordOpIfActive(scope, { kind: 'setOutput', key, value, column });
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
    recordAssertionFailure(
      scope,
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
    recordAssertionFailure(
      scope,
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
 * Assert a truthy condition for the current eval case and throw on failure.
 *
 * Calls made outside `runInEvalScope(...)` are ignored so shared workflow code
 * can safely reuse `evalAssert(...)` when it also runs outside an eval. The
 * TypeScript assertion signature still narrows the checked value after the
 * call.
 */
export function evalAssert(
  condition: unknown,
  message: string,
): asserts condition {
  const scope = getCurrentScope();
  if (condition) {
    if (scope) scope.assertions.push({ message, status: 'pass' });
    return;
  }
  if (!scope) return;
  const error = new EvalAssertionError(message);
  recordAssertionFailure(scope, toAssertionFailure(message, error));
  throw error;
}

function recordAssertionFailure(
  scope: EvalCaseScope,
  failure: AssertionFailure,
): void {
  scope.assertionFailures.push(failure);
  scope.assertions.push({ ...failure, status: 'fail' });
}
