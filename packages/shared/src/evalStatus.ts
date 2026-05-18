import type { EvalFreshnessStatus } from './schemas/eval.ts';
import type { DerivedStatus } from './status.ts';

/** Display status used for eval, file, and folder UI surfaces. */
export type EvalDisplayStatus =
  | DerivedStatus
  | 'enqueued'
  | 'stale'
  | 'outdated'
  | 'unscored';

/**
 * Derive the user-facing eval status from the raw latest run result plus
 * freshness state.
 */
export function getEvalDisplayStatus(params: {
  freshnessStatus: EvalFreshnessStatus;
  stale: boolean;
  outdated: boolean;
  lastRunStatus:
    | 'pass'
    | 'fail'
    | 'error'
    | 'running'
    | 'cancelled'
    | 'unscored'
    | null;
  isRunning?: boolean;
  isEnqueued?: boolean;
}): EvalDisplayStatus {
  const {
    stale,
    outdated,
    lastRunStatus,
    isRunning = false,
    isEnqueued = false,
  } = params;
  if (isRunning || lastRunStatus === 'running') return 'running';
  if (isEnqueued) return 'enqueued';
  if (lastRunStatus === 'pass') {
    if (stale) return 'stale';
    if (outdated) return 'outdated';
  }
  return lastRunStatus ?? 'pending';
}
