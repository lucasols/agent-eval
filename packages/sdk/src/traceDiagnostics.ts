import type {
  EvalTraceSpan,
  EvalTraceSpanError,
  EvalTraceSpanWarning,
} from '@agent-evals/shared';

const errorCoreFields = new Set(['name', 'message', 'stack', 'capturedAt']);

/** Severity used when attaching a recoverable diagnostic to an active span. */
export type CaptureEvalSpanErrorLevel = 'error' | 'warning';

/** Options accepted by `captureEvalSpanError(...)`. */
export type CaptureEvalSpanErrorOptions = {
  /**
   * Captured diagnostic severity.
   *
   * `error` marks the active span as errored. `warning` records the diagnostic
   * without changing an otherwise successful span's status.
   */
  level?: CaptureEvalSpanErrorLevel;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatUnknownErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean') {
    return String(error);
  }
  if (typeof error === 'bigint') return String(error);
  if (typeof error === 'symbol') return error.description ?? 'Symbol';
  if (typeof error === 'function') {
    return error.name ? `[function ${error.name}]` : '[function]';
  }
  if (error === undefined) return 'undefined';
  if (error === null) return 'null';

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function getErrorExtraFields(error: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(error).filter(([key]) => !errorCoreFields.has(key)),
  );
}

export function normalizeTraceError(
  error: unknown,
  capturedAt: string | undefined = undefined,
): EvalTraceSpanError {
  if (error instanceof Error) {
    const extraFields = getErrorExtraFields(error);
    return {
      ...extraFields,
      name: error.name,
      message: error.message,
      stack: error.stack,
      capturedAt,
    };
  }

  if (isRecord(error)) {
    const extraFields = getErrorExtraFields(error);
    const name = typeof error.name === 'string' ? error.name : undefined;
    const stack = typeof error.stack === 'string' ? error.stack : undefined;
    const message =
      error.message === undefined
        ? formatUnknownErrorMessage(error)
        : formatUnknownErrorMessage(error.message);

    return {
      ...extraFields,
      ...(name === undefined ? {} : { name }),
      message,
      ...(stack === undefined ? {} : { stack }),
      capturedAt,
    };
  }

  return { message: String(error), capturedAt };
}

export function normalizeTraceErrors(
  errorOrErrors: unknown,
  additionalErrors: readonly unknown[],
  capturedAt: string,
): EvalTraceSpanError[] {
  const rawErrors =
    additionalErrors.length > 0
      ? [errorOrErrors, ...additionalErrors]
      : Array.isArray(errorOrErrors)
        ? errorOrErrors
        : [errorOrErrors];
  return rawErrors.map((error) => normalizeTraceError(error, capturedAt));
}

export function normalizeTraceWarnings(
  warningOrWarnings: unknown,
  additionalWarnings: readonly unknown[],
  capturedAt: string,
): EvalTraceSpanWarning[] {
  const rawWarnings =
    additionalWarnings.length > 0
      ? [warningOrWarnings, ...additionalWarnings]
      : Array.isArray(warningOrWarnings)
        ? warningOrWarnings
        : [warningOrWarnings];
  return rawWarnings.map((warning) => normalizeTraceError(warning, capturedAt));
}

function isCaptureEvalSpanErrorOptions(
  value: unknown,
): value is CaptureEvalSpanErrorOptions {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  if (!keys.every((key) => key === 'level')) return false;
  return value.level === undefined || isCaptureEvalSpanErrorLevel(value.level);
}

function isCaptureEvalSpanErrorLevel(
  value: unknown,
): value is CaptureEvalSpanErrorLevel {
  return value === 'error' || value === 'warning';
}

export function splitCaptureEvalSpanErrorArgs(
  additionalErrorsOrOptions: readonly unknown[],
): {
  additionalErrors: readonly unknown[];
  options: CaptureEvalSpanErrorOptions;
} {
  const lastArg = additionalErrorsOrOptions.at(-1);
  if (isCaptureEvalSpanErrorLevel(lastArg)) {
    return {
      additionalErrors: additionalErrorsOrOptions.slice(0, -1),
      options: { level: lastArg },
    };
  }
  if (isCaptureEvalSpanErrorOptions(lastArg)) {
    return {
      additionalErrors: additionalErrorsOrOptions.slice(0, -1),
      options: lastArg,
    };
  }
  return { additionalErrors: additionalErrorsOrOptions, options: {} };
}

export function appendSpanErrors(
  span: EvalTraceSpan,
  errors: readonly EvalTraceSpanError[],
): void {
  if (errors.length === 0) return;
  const latestError = errors.at(-1);
  if (latestError === undefined) return;
  span.errors = [...(span.errors ?? []), ...errors];
  span.error = latestError;
  span.status = 'error';
}

export function appendSpanWarnings(
  span: EvalTraceSpan,
  warnings: readonly EvalTraceSpanWarning[],
): void {
  if (warnings.length === 0) return;
  const latestWarning = warnings.at(-1);
  if (latestWarning === undefined) return;
  span.warnings = [...(span.warnings ?? []), ...warnings];
  span.warning = latestWarning;
}

export function hasSpanError(span: EvalTraceSpan): boolean {
  return span.error !== undefined || (span.errors?.length ?? 0) > 0;
}
