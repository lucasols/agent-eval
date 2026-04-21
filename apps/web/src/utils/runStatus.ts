import type { RunManifest, RunSummary } from '@agent-evals/shared';

export function getRunDisplayStatus(
  manifest: RunManifest,
  summary: RunSummary,
): string {
  if (manifest.status !== 'completed') return manifest.status;
  if (summary.failedCases > 0 || summary.errorCases > 0) return 'fail';
  return manifest.status;
}
