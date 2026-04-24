import type { CaseRow } from './schemas/eval.ts';
import type { RunManifest } from './schemas/run.ts';

/**
 * Canonical derived result status used for aggregated displays and propagation
 * across case, eval, file, folder, and run result views.
 */
export type DerivedStatus =
  | 'pending'
  | 'running'
  | 'pass'
  | 'fail'
  | 'error'
  | 'cancelled';

/**
 * Aggregate summary derived from a scoped set of case rows.
 *
 * This is intentionally separate from `RunSummary`: it represents a summary
 * over any slice of case rows, such as a single eval within a run.
 */
export type ScopedCaseSummary = {
  status: DerivedStatus;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  cancelledCases: number;
  pendingCases: number;
  runningCases: number;
  totalDurationMs: number | null;
};

type RunLifecycleStatus = RunManifest['status'] | null | undefined;

function deriveLifecycleStatus(
  lifecycleStatus: RunLifecycleStatus,
): DerivedStatus | null {
  if (
    lifecycleStatus === 'pending' ||
    lifecycleStatus === 'running' ||
    lifecycleStatus === 'cancelled' ||
    lifecycleStatus === 'error'
  ) {
    return lifecycleStatus;
  }
  return null;
}

/**
 * Derive an aggregate status from child statuses, optionally allowing a raw run
 * lifecycle status to override active terminal states such as `running`,
 * `cancelled`, and `error`.
 */
export function deriveStatusFromChildStatuses(params: {
  statuses: Iterable<DerivedStatus | null | undefined>;
  lifecycleStatus?: RunLifecycleStatus;
}): DerivedStatus {
  const lifecycle = deriveLifecycleStatus(params.lifecycleStatus);
  if (lifecycle !== null) return lifecycle;

  let hasPass = false;
  let hasPending = false;
  let hasRunning = false;
  let hasCancelled = false;
  let hasError = false;
  let hasFail = false;

  for (const status of params.statuses) {
    if (status === undefined || status === null) continue;
    if (status === 'running') hasRunning = true;
    else if (status === 'error') hasError = true;
    else if (status === 'fail') hasFail = true;
    else if (status === 'cancelled') hasCancelled = true;
    else if (status === 'pass') hasPass = true;
    else hasPending = true;
  }

  if (hasRunning) return 'running';
  if (hasError) return 'error';
  if (hasFail) return 'fail';
  if (hasCancelled) return 'cancelled';
  if (hasPending || !hasPass) return 'pending';
  return 'pass';
}

/**
 * Derive an aggregate status from a scoped set of case rows.
 *
 * Pass `lifecycleStatus` only when the parent scope's raw run lifecycle should
 * override the derived child result, such as for a whole-run display.
 */
export function deriveStatusFromCaseRows(params: {
  caseRows: Iterable<Pick<CaseRow, 'status'>>;
  lifecycleStatus?: RunLifecycleStatus;
}): DerivedStatus {
  return deriveStatusFromChildStatuses({
    statuses: Array.from(params.caseRows, (caseRow) => caseRow.status),
    lifecycleStatus: params.lifecycleStatus,
  });
}

/**
 * Derive counts, aggregate metrics, and display status from a scoped set of
 * case rows.
 */
export function deriveScopedSummaryFromCases(params: {
  caseRows: Iterable<CaseRow>;
  lifecycleStatus?: RunLifecycleStatus;
}): ScopedCaseSummary {
  const caseRows = [...params.caseRows];
  let passedCases = 0;
  let failedCases = 0;
  let errorCases = 0;
  let cancelledCases = 0;
  let pendingCases = 0;
  let runningCases = 0;

  let totalDurationMs = 0;
  let hasDuration = false;

  for (const caseRow of caseRows) {
    if (caseRow.status === 'pass') passedCases += 1;
    else if (caseRow.status === 'fail') failedCases += 1;
    else if (caseRow.status === 'error') errorCases += 1;
    else if (caseRow.status === 'cancelled') cancelledCases += 1;
    else if (caseRow.status === 'running') runningCases += 1;
    else pendingCases += 1;

    if (caseRow.latencyMs !== null) {
      totalDurationMs += caseRow.latencyMs;
      hasDuration = true;
    }
  }

  return {
    status: deriveStatusFromCaseRows({
      caseRows,
      lifecycleStatus: params.lifecycleStatus,
    }),
    totalCases: caseRows.length,
    passedCases,
    failedCases,
    errorCases,
    cancelledCases,
    pendingCases,
    runningCases,
    totalDurationMs: hasDuration ? totalDurationMs : null,
  };
}
