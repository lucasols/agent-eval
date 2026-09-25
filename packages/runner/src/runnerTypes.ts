import type {
  CacheEntryWithDebugKey,
  CacheListItem,
  CacheRepairSummary,
  CacheStorage,
  CaseDetail,
  CaseRow,
  ConfigReloadState,
  CreateRunRequest,
  DiscoveryIssue,
  EvalSummary,
  ResolvedApiCallsConfig,
  ResolvedLlmCallsConfig,
  RunManifest,
  RunSummary,
  SseEnvelope,
} from '@agent-evals/shared';
import type { Result } from 't-result';
import type {
  BranchCachePruneOptions,
  BranchCachePruneSummary,
} from './branchCachePrune.ts';
import type { CacheClearFilter } from './cacheStore.ts';
import type { ManualInputValidationResult } from './manualInput/validation.ts';
import type { RecalculateDerivedAttributesResult } from './recalculateDerivedAttributes.ts';

/** Imperative runner interface used by the server and CLI. */
export type EvalRunner = {
  /** Load workspace config, discover evals, and start file watching when enabled. */
  init(): Promise<void>;
  /** Return the currently discovered eval summaries for the active workspace. */
  getEvals(): EvalSummary[];
  /** Look up one discovered eval by id. */
  getEval(id: string): EvalSummary | undefined;
  /**
   * Mark a discovered eval's latest run as matching the current eval source.
   *
   * This clears source-fingerprint staleness without re-running the eval. Run
   * result status and case data are left unchanged.
   */
  markEvalNotStale(
    id: string,
  ): Promise<
    | { updated: true; eval: EvalSummary }
    | {
        updated: false;
        reason: 'not-found' | 'no-latest-run' | 'source-fingerprint-missing';
      }
  >;
  /**
   * Mark a discovered eval's latest run as no longer matching the current eval
   * source, forcing the eval into the stale state until it is re-run or marked
   * fresh again. Run result status and case data are left unchanged.
   */
  markEvalStale(
    id: string,
  ): Promise<
    | { updated: true; eval: EvalSummary }
    | {
        updated: false;
        reason: 'not-found' | 'no-latest-run' | 'source-fingerprint-missing';
      }
  >;
  /** Return discovery errors that should be shown before running evals. */
  getDiscoveryIssues(): DiscoveryIssue[];
  /** Return current config-reload state for the long-running app server. */
  getConfigReloadState(): ConfigReloadState;
  /** Return the effective per-run case concurrency after applying defaults. */
  getConfiguredConcurrency(): number;
  /** Re-scan configured eval files and emit a discovery update to listeners. */
  refreshDiscovery(): Promise<void>;
  /**
   * Start an isolated run for the requested targets, trials, and cache mode.
   * Returns its initial state; observe completion through run events or getRun.
   * Before reporting completion, the runner prunes superseded branch-added
   * durable cache for completed cases, preserving cache used by other cases.
   * Cleanup is skipped for bypass runs or when the Git base is unavailable
   * or another run is active, and cleanup failures do not fail the eval.
   */
  startRun(
    request: CreateRunRequest,
  ): Promise<{ manifest: RunManifest; summary: RunSummary; cases: CaseRow[] }>;
  /** Return run manifests tracked in memory, including persisted runs loaded during init. */
  getRuns(): RunManifest[];
  /** Return one run with its summary and case rows when available in memory. */
  getRun(
    id: string,
  ):
    | { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] }
    | undefined;
  /** Request cancellation for an in-flight run and persist its cancelled state. */
  cancelRun(id: string): Promise<void>;
  /** Return full details for a single case in a run, when available. */
  getCaseDetail(runId: string, caseId: string): CaseDetail | undefined;
  /** Subscribe to streamed events for a specific run. */
  subscribe(runId: string, listener: (event: SseEnvelope) => void): () => void;
  /** Subscribe to discovery updates triggered by file changes or manual refresh. */
  subscribeDiscovery(listener: (event: SseEnvelope) => void): () => void;
  /** Stop background filesystem watchers owned by this runner instance. */
  close(): Promise<void>;
  /** Resolve the workspace root backing this runner instance. */
  getWorkspaceRoot(): string;
  /**
   * Return whether the current workspace allows an unfiltered CLI run.
   *
   * `false` means `agent-evals run` must include `--eval` or `--case`.
   * Programmatic/server runs are intentionally unaffected.
   */
  getAllowCliRunAll(): boolean;
  /**
   * Resolved LLM-calls config used by the UI to derive the LLM calls tab.
   *
   * Returns the workspace's `llmCalls` config block from
   * `agent-evals.config.ts` with all defaults applied.
   */
  getLlmCallsConfig(): ResolvedLlmCallsConfig;
  /**
   * Resolved API-calls config used by the UI to derive the API calls tab.
   *
   * Returns the workspace's `apiCalls` config block from
   * `agent-evals.config.ts` with all defaults applied.
   */
  getApiCallsConfig(): ResolvedApiCallsConfig;
  /** Resolve a persisted artifact path when artifact storage is supported. */
  getArtifactPath(artifactId: string): string | undefined;
  /** Return summaries for every persisted cache entry in the workspace. */
  listCache(): Promise<CacheListItem[]>;
  /**
   * Return the full persisted cache entry for `namespace` + `key`, including
   * its recording and optional raw-key debug metadata. Returns `null` when no
   * entry matches. Used by the case drawer's Cache tab to lazily fetch the
   * cached return value when a row is expanded.
   */
  getCacheEntry(
    namespace: string,
    key: string,
    storage?: CacheStorage,
  ): Promise<CacheEntryWithDebugKey | null>;
  /**
   * Remove cache entries matching `filter`, or all entries when no filter is
   * supplied. Pass `filter.reason` to explain the cleanup in terminal logs.
   */
  clearCache(filter?: CacheClearFilter): Promise<void>;
  /** Remove cache/debug/blob files that are not referenced by cache indexes. */
  repairCache(): Promise<CacheRepairSummary>;
  /**
   * Remove durable cache entries added on the current git branch (relative to
   * the merge-base with the base ref) that saved runs reference but the
   * latest local run of each case no longer does. Entries no saved run
   * references, or stored after a referencing case's latest run started, are
   * kept. The base ref is `options.baseRef`, then the
   * current pull request's base branch from `gh pr view`, then
   * `cache.branchPruneBaseRef` from the config. Entries that already exist at the
   * merge-base are kept. Fails while a run is in progress or when the base
   * cannot be resolved.
   */
  pruneBranchCache(
    options: BranchCachePruneOptions,
  ): Promise<Result<BranchCachePruneSummary, Error>>;
  /**
   * Recompute persisted case and run statuses for terminal runs touching one
   * eval. Accepts the exact eval key.
   */
  recomputeStatusesForEval(evalKey: string): Promise<{ updatedRuns: number }>;
  /** Recalculate configured LLM/API derived attributes for one persisted case trace. */
  recalculateDerivedAttributesForCase(params: {
    runId: string;
    caseId: string;
  }): Promise<RecalculateDerivedAttributesResult>;
  /**
   * Delete terminal persisted runs that touch one eval from memory and disk.
   * Accepts the exact eval key.
   */
  cleanRunsForEval(evalKey: string): Promise<{ deletedRuns: number }>;
  /** Persist a UI-authored manual score for one case and recompute affected summaries. */
  updateManualScore(params: {
    runId: string;
    caseId: string;
    scoreKey: string;
    value: number | null;
  }): Promise<
    | {
        updated: true;
        run: { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] };
        caseDetail: CaseDetail;
      }
    | { updated: false; reason: string }
  >;
  /**
   * Manually override a computed score for one persisted case, e.g. to fix an
   * invalid LLM-judge result or a scorer that threw.
   *
   * The first override records the run's original value in
   * `caseRow.scoreOverrides[scoreKey].originalValue`; later overrides keep
   * that original. Pass `value: null` to remove the override and restore the
   * original value. Case status and run summary are recomputed, and scorer
   * failures for overridden scores stop gating the case. Manual scores are
   * rejected — use {@link EvalRunner.updateManualScore} for those.
   */
  setScoreOverride(params: {
    runId: string;
    caseId: string;
    scoreKey: string;
    /** Normalized `0..1` override value, or `null` to clear the override. */
    value: number | null;
    /** Optional reviewer note explaining why the computed score was invalid. */
    reason: string | undefined;
  }): Promise<
    | {
        updated: true;
        run: { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] };
        caseDetail: CaseDetail;
      }
    | { updated: false; reason: string }
  >;
  /**
   * Delete one persisted run from in-memory history and disk.
   *
   * Ignored for in-flight runs — cancel first, then delete.
   * Returns `deleted: false` when the run is missing or still running.
   */
  deleteRun(runId: string): Promise<{ deleted: boolean }>;
  /**
   * Convert a temporary persisted run into durable run history.
   *
   * Returns the updated run when found. Already-durable runs are treated as a
   * no-op success so UI callers can refresh their cached copy idempotently.
   */
  promoteRun(
    runId: string,
  ): Promise<
    | {
        promoted: boolean;
        run: { manifest: RunManifest; summary: RunSummary; cases: CaseRow[] };
      }
    | { promoted: false }
  >;
  /**
   * Validate a `CreateRunRequest`'s `manualInputs` map against each targeted
   * eval's authored `manualInput.schema`. Returns `ok: true` with the parsed
   * values keyed by eval key, or `ok: false` with structured per-eval issues
   * when an entry is missing or fails schema validation.
   */
  validateManualInputs(request: CreateRunRequest): ManualInputValidationResult;
};
