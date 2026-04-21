import type { EvalFreshnessStatus, RunManifest } from '@agent-evals/shared';
import type { GitWorktreeState } from './gitState.ts';

/** Latest run details needed to derive eval freshness. */
export type LatestRunInfo = {
  startedAt: string;
  commitSha: string | null;
  trackedChangesFingerprint: string | null;
};

/** Independent freshness flags derived from git state and latest run info. */
export type EvalFreshnessState = {
  freshnessStatus: EvalFreshnessStatus;
  stale: boolean;
  outdated: boolean;
};

/**
 * Derive eval freshness from the latest run, current git commit, and an age
 * threshold.
 */
export function deriveEvalFreshness(params: {
  latestRun: LatestRunInfo | undefined;
  gitState: GitWorktreeState;
  staleAfterDays: number;
  now?: Date;
}): EvalFreshnessState {
  const { latestRun, gitState, staleAfterDays, now = new Date() } = params;
  const stale =
    gitState.trackedChangesFingerprint !==
    (latestRun?.trackedChangesFingerprint ?? null);

  const latestRunCommitSha = latestRun?.commitSha;
  if (latestRunCommitSha === undefined || latestRunCommitSha === null) {
    return {
      freshnessStatus: stale ? 'stale' : 'fresh',
      stale,
      outdated: false,
    };
  }

  if (gitState.commitSha === null) {
    return {
      freshnessStatus: stale ? 'stale' : 'fresh',
      stale,
      outdated: false,
    };
  }

  if (latestRunCommitSha === gitState.commitSha) {
    return {
      freshnessStatus: stale ? 'stale' : 'fresh',
      stale,
      outdated: false,
    };
  }

  const latestRunStartedAt = new Date(latestRun?.startedAt ?? '').getTime();
  if (!Number.isFinite(latestRunStartedAt)) {
    return {
      freshnessStatus: stale ? 'stale' : 'fresh',
      stale,
      outdated: false,
    };
  }

  const ageMs = now.getTime() - latestRunStartedAt;
  const staleAfterMs = staleAfterDays * 24 * 60 * 60 * 1000;
  const outdated = ageMs >= staleAfterMs;
  return {
    freshnessStatus: stale ? 'stale' : outdated ? 'outdated' : 'fresh',
    stale,
    outdated,
  };
}

/** Return the timestamp used when ordering and displaying a run recency. */
export function getRunFreshnessTimestamp(manifest: RunManifest): string {
  return manifest.endedAt ?? manifest.startedAt;
}
