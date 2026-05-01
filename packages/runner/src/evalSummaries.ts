import type {
  AgentEvalsConfig,
  CreateRunRequest,
  EvalSummary,
  ManualInputDescriptor,
} from '@agent-evals/shared';
import { deriveEvalFreshness } from './freshness.ts';
import type { GitWorktreeState } from './gitState.ts';
import type { EvalLatestRunInfo } from './runPersistence.ts';

type EvalSummaryMeta = Pick<
  EvalSummary,
  | 'key'
  | 'id'
  | 'title'
  | 'filePath'
  | 'columnDefs'
  | 'caseCount'
  | 'stats'
  | 'charts'
> & {
  sourceFingerprint: string | null;
  manualInputDescriptor?: ManualInputDescriptor;
  requiresManualInput?: boolean;
};

/** Build the API/UI summary payload for one discovered eval. */
export function buildEvalSummary(params: {
  meta: EvalSummaryMeta;
  config: AgentEvalsConfig;
  gitState: GitWorktreeState;
  latestRun: EvalLatestRunInfo | undefined;
  lastRunStatus: EvalSummary['lastRunStatus'];
}): EvalSummary {
  const { meta, config, gitState, latestRun, lastRunStatus } = params;
  const {
    sourceFingerprint,
    manualInputDescriptor,
    requiresManualInput,
    ...summaryMeta
  } = meta;
  const freshness = deriveEvalFreshness({
    latestRun,
    gitState,
    currentEvalSourceFingerprint: sourceFingerprint,
    staleAfterDays: config.staleAfterDays ?? 14,
  });

  const summary: EvalSummary = {
    ...summaryMeta,
    stale: freshness.stale,
    outdated: freshness.outdated,
    freshnessStatus: freshness.freshnessStatus,
    latestRunAt: latestRun?.startedAt ?? null,
    latestRunCommitSha: latestRun?.commitSha ?? null,
    currentCommitSha: gitState.commitSha,
    lastRunStatus,
  };
  if (manualInputDescriptor && requiresManualInput) {
    summary.manualInput = manualInputDescriptor;
  }
  return summary;
}

/** Resolve which eval keys a run request should mark as the latest run. */
export function getTargetEvalIds(params: {
  request: CreateRunRequest;
  sortedEvalKeys: string[];
  knownEvalKeys: Set<string>;
}): string[] {
  const { request, sortedEvalKeys, knownEvalKeys } = params;
  if (request.target.evalKeys && request.target.evalKeys.length > 0) {
    return request.target.evalKeys.filter((evalKey) =>
      knownEvalKeys.has(evalKey),
    );
  }
  return sortedEvalKeys;
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
