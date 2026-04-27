import type { EvalSummary } from '@agent-evals/shared';
import { formatTimestamp } from '#src/utils/formatters';

function shortCommitSha(commitSha: string | null): string {
  if (commitSha === null) return 'unknown';
  return commitSha.slice(0, 7);
}

/** Human-readable explanation for the current eval freshness state. */
export function getFreshnessTooltip(evalSummary: EvalSummary): string | null {
  if (!evalSummary.stale && !evalSummary.outdated) return null;

  if (evalSummary.stale && evalSummary.outdated) {
    return `Tracked files changed since the latest passing run, and the latest comparable run ${formatTimestamp(evalSummary.latestRunAt ?? '')} was recorded on ${shortCommitSha(evalSummary.latestRunCommitSha)} while the current commit is ${shortCommitSha(evalSummary.currentCommitSha)}.`;
  }

  if (evalSummary.stale) {
    return 'Tracked files changed since the latest passing run.';
  }

  return `Latest run ${formatTimestamp(evalSummary.latestRunAt ?? '')} was recorded on ${shortCommitSha(evalSummary.latestRunCommitSha)} while the current commit is ${shortCommitSha(evalSummary.currentCommitSha)}.`;
}
