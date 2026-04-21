import type {
  AgentEvalsConfig,
  CreateRunRequest,
  EvalSummary,
} from '@agent-evals/shared';
import { deriveEvalFreshness } from './freshness.ts';
import type { GitWorktreeState } from './gitState.ts';
import type { EvalLatestRunInfo } from './runPersistence.ts';

type EvalSummaryMeta = Pick<
  EvalSummary,
  'id' | 'title' | 'description' | 'filePath' | 'columnDefs' | 'caseCount'
> & { passThreshold: number; sourceFingerprint: string | null };

/** Build the API/UI summary payload for one discovered eval. */
export function buildEvalSummary(params: {
  meta: EvalSummaryMeta;
  config: AgentEvalsConfig;
  gitState: GitWorktreeState;
  latestRun: EvalLatestRunInfo | undefined;
  lastRunStatus: EvalSummary['lastRunStatus'];
}): EvalSummary {
  const { meta, config, gitState, latestRun, lastRunStatus } = params;
  const { sourceFingerprint, ...summaryMeta } = meta;
  const freshness = deriveEvalFreshness({
    latestRun,
    gitState,
    currentEvalSourceFingerprint: sourceFingerprint,
    staleAfterDays: config.staleAfterDays ?? 14,
  });

  return {
    ...summaryMeta,
    stale: freshness.stale,
    outdated: freshness.outdated,
    freshnessStatus: freshness.freshnessStatus,
    latestRunAt: latestRun?.startedAt ?? null,
    latestRunCommitSha: latestRun?.commitSha ?? null,
    currentCommitSha: gitState.commitSha,
    passThreshold: meta.passThreshold,
    lastRunStatus,
  };
}

/** Resolve which eval ids a run request should mark as the latest run. */
export function getTargetEvalIds(params: {
  request: CreateRunRequest;
  sortedEvalIds: string[];
  knownEvalIds: Set<string>;
}): string[] {
  const { request, sortedEvalIds, knownEvalIds } = params;
  if (request.target.evalIds && request.target.evalIds.length > 0) {
    return request.target.evalIds.filter((evalId) => knownEvalIds.has(evalId));
  }
  return sortedEvalIds;
}

/** Write one latest-run snapshot to each targeted eval id. */
export function setLatestRunInfoMap(params: {
  latestRunInfoMap: Map<string, EvalLatestRunInfo>;
  evalIds: Iterable<string>;
  info: EvalLatestRunInfo;
}): void {
  const { latestRunInfoMap, evalIds, info } = params;
  for (const evalId of evalIds) {
    latestRunInfoMap.set(evalId, info);
  }
}
