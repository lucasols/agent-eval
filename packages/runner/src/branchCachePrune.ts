import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import {
  extractCacheEntries,
  getCaseRowCaseKey,
  type CacheListItem,
  type CaseDetail,
  type CaseRow,
  type RunManifest,
} from '@agent-evals/shared';
import { Result } from 't-result';
import type { FsCacheStore } from './cacheStore.ts';
import { getRunFreshnessTimestamp } from './freshness.ts';

/** Options for {@link pruneBranchCache}. */
export type BranchCachePruneOptions = {
  /**
   * Git ref of the branch the current work will merge into (the `--base`
   * flag). `undefined` uses the base branch of the current pull request
   * reported by `gh pr view` (preferring `origin/<base>` when it exists), then
   * falls back to `cache.branchPruneBaseRef` from the config when there is no
   * pull request or `gh` is unavailable.
   */
  baseRef: string | undefined;
  /** Report what would be removed without deleting anything. */
  dryRun: boolean;
};

/** Where the base ref used by {@link pruneBranchCache} came from. */
export type BranchCachePruneBaseRefSource = 'flag' | 'config' | 'pullRequest';

type ResolvedBaseRef = { ref: string; source: BranchCachePruneBaseRefSource };

/** Result of pruning cache entries added on the current branch. */
export type BranchCachePruneSummary = {
  /** Resolved base ref the branch is compared against. */
  baseRef: string;
  /** Whether the base ref came from `--base`, the config, or the current PR. */
  baseRefSource: BranchCachePruneBaseRefSource;
  /** Merge-base commit of `HEAD` and `baseRef`. */
  mergeBase: string;
  /** Whether entries were only reported, not deleted. */
  dryRun: boolean;
  /**
   * Branch-added entries referenced by saved runs but not by the latest run
   * of any case.
   */
  removed: CacheListItem[];
  /** Branch-added entries kept because a case's latest run references them. */
  keptLatestRunEntries: number;
  /** Entries left untouched because they already exist at the merge-base. */
  keptBaseEntries: number;
  /** Branch-added entries kept because no saved run references them. */
  keptUnreferencedEntries: number;
};

type PrunableRun = { manifest: RunManifest; cases: CaseRow[] };

/**
 * Collect stored (non-hit) cache entries recorded by one case, including
 * entries written by its score traces.
 */
export function getStoredCacheEntriesForCase(caseDetail: CaseDetail) {
  const entries = extractCacheEntries(caseDetail.trace, caseDetail.cacheRefs);

  for (const scoreTrace of Object.values(caseDetail.scoringTraces ?? {})) {
    entries.push(
      ...extractCacheEntries(scoreTrace.trace, scoreTrace.cacheRefs),
    );
  }

  return entries.filter((entry) => entry.stored);
}

/**
 * Remove durable cache entries added on the current git branch that saved
 * runs reference, but not the latest local run of any eval case.
 *
 * "Added" means the entry file does not exist at the merge-base of `HEAD` and
 * the base ref, so it also covers uncommitted entries. Entries present at the
 * merge-base, and entries no saved run references, are never touched.
 * Protection is per case, so running a single case keeps the latest cache for
 * the eval's other cases. Refuses to run while a run is in progress.
 */
export async function pruneBranchCache<TRun extends PrunableRun>(params: {
  workspaceRoot: string;
  cacheStore: FsCacheStore;
  /** `cache.branchPruneBaseRef` from the workspace config. */
  configuredBaseRef: string | undefined;
  runs: Iterable<TRun>;
  hydrateCaseDetail: (run: TRun, caseRow: CaseRow) => CaseDetail | undefined;
  options: BranchCachePruneOptions;
}): Promise<Result<BranchCachePruneSummary, Error>> {
  const runs = [...params.runs];
  if (runs.some((run) => run.manifest.status === 'running')) {
    return Result.err(
      new Error('A run is in progress; wait for it to finish before pruning.'),
    );
  }
  const baseRef = resolveBaseRef({
    workspaceRoot: params.workspaceRoot,
    flagBaseRef: params.options.baseRef,
    configuredBaseRef: params.configuredBaseRef,
  });
  if (baseRef.error) return baseRef.errorResult();
  const mergeBase = runGit(params.workspaceRoot, [
    'merge-base',
    'HEAD',
    baseRef.value.ref,
  ]);
  if (mergeBase.error) return mergeBase.errorResult();
  const baseFiles = listBaseCacheFiles({
    workspaceRoot: params.workspaceRoot,
    cacheDir: params.cacheStore.dir(),
    commit: mergeBase.value,
  });
  if (baseFiles.error) return baseFiles.errorResult();

  const runEntries = getRunCacheEntries(runs, params.hydrateCaseDetail);
  const summary: BranchCachePruneSummary = {
    baseRef: baseRef.value.ref,
    baseRefSource: baseRef.value.source,
    mergeBase: mergeBase.value,
    dryRun: params.options.dryRun,
    removed: [],
    keptLatestRunEntries: 0,
    keptBaseEntries: 0,
    keptUnreferencedEntries: 0,
  };

  for (const entry of await params.cacheStore.list()) {
    const entryPath = params.cacheStore.entryFilePath(
      entry.namespace,
      entry.key,
    );
    const entryId = toEntryId(entry);
    if (baseFiles.value.has(entryPath)) {
      summary.keptBaseEntries += 1;
    } else if (runEntries.latest.has(entryId)) {
      summary.keptLatestRunEntries += 1;
    } else if (!runEntries.referenced.has(entryId)) {
      summary.keptUnreferencedEntries += 1;
    } else {
      summary.removed.push(entry);
    }
  }

  if (!params.options.dryRun) {
    for (const entry of summary.removed) {
      await params.cacheStore.clear({
        namespace: entry.namespace,
        key: entry.key,
        reason: `branch cache prune: added since ${baseRef.value.ref} and only referenced by superseded runs`,
      });
    }
  }

  return Result.ok(summary);
}

/**
 * Collect durable cache entry ids referenced by any saved run (`referenced`)
 * and by the latest run of each case (`latest`).
 */
function getRunCacheEntries<TRun extends PrunableRun>(
  runs: TRun[],
  hydrateCaseDetail: (run: TRun, caseRow: CaseRow) => CaseDetail | undefined,
): { latest: Set<string>; referenced: Set<string> } {
  const latestByCase = new Map<string, { entryIds: string[]; time: number }>();
  const referenced = new Set<string>();
  for (const run of runs) {
    const time = new Date(getRunFreshnessTimestamp(run.manifest)).getTime();
    for (const caseRow of run.cases) {
      const caseDetail = hydrateCaseDetail(run, caseRow);
      const entryIds =
        caseDetail === undefined
          ? []
          : getStoredCacheEntriesForCase(caseDetail)
              .filter((entry) => (entry.storage ?? 'durable') === 'durable')
              .map(toEntryId);
      for (const entryId of entryIds) referenced.add(entryId);

      const caseKey = getCaseRowCaseKey(caseRow);
      const current = latestByCase.get(caseKey);
      if (current === undefined || time > current.time) {
        latestByCase.set(caseKey, { entryIds, time });
      }
    }
  }

  const latest = new Set(
    [...latestByCase.values()].flatMap(({ entryIds }) => entryIds),
  );
  return { latest, referenced };
}

function resolveBaseRef(params: {
  workspaceRoot: string;
  flagBaseRef: string | undefined;
  configuredBaseRef: string | undefined;
}): Result<ResolvedBaseRef, Error> {
  if (params.flagBaseRef !== undefined) {
    return verifyRef(params.workspaceRoot, params.flagBaseRef, 'flag');
  }

  const prBase = runCommand(params.workspaceRoot, 'gh', [
    'pr',
    'view',
    '--json',
    'baseRefName',
    '--jq',
    '.baseRefName',
  ]);
  if (!prBase.error && prBase.value.length > 0) {
    // Prefer the remote-tracking ref so a stale local base branch does not
    // make already-merged cache entries look branch-added.
    const remoteRef = verifyRef(
      params.workspaceRoot,
      `origin/${prBase.value}`,
      'pullRequest',
    );
    if (!remoteRef.error) return remoteRef;
    return verifyRef(params.workspaceRoot, prBase.value, 'pullRequest');
  }

  if (params.configuredBaseRef !== undefined) {
    return verifyRef(params.workspaceRoot, params.configuredBaseRef, 'config');
  }
  return Result.err(
    new Error(
      `Could not resolve the base branch from the current pull request${prBase.error ? ` (${prBase.error.message})` : ''}. Pass --base <ref> or set cache.branchPruneBaseRef in agent-evals.config.ts.`,
    ),
  );
}

function verifyRef(
  workspaceRoot: string,
  ref: string,
  source: BranchCachePruneBaseRefSource,
): Result<ResolvedBaseRef, Error> {
  const verified = runGit(workspaceRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^{commit}`,
  ]);
  if (verified.error) {
    return Result.err(new Error(`Base ref "${ref}" was not found.`));
  }
  return Result.ok({ ref, source });
}

function listBaseCacheFiles(params: {
  workspaceRoot: string;
  cacheDir: string;
  commit: string;
}): Result<Set<string>, Error> {
  const repoRoot = runGit(params.workspaceRoot, [
    'rev-parse',
    '--show-toplevel',
  ]);
  if (repoRoot.error) return repoRoot.errorResult();

  const files = runGit(params.workspaceRoot, [
    'ls-tree',
    '-r',
    '--name-only',
    '--full-name',
    params.commit,
    '--',
    relative(params.workspaceRoot, params.cacheDir),
  ]);
  if (files.error) return files.errorResult();

  return Result.ok(
    new Set(
      files.value
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => resolve(repoRoot.value, line)),
    ),
  );
}

function runGit(cwd: string, args: string[]): Result<string, Error> {
  return runCommand(cwd, 'git', args);
}

function runCommand(
  cwd: string,
  command: string,
  args: string[],
): Result<string, Error> {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    return Result.err(
      new Error(`${command} could not be started: ${result.error.message}`),
    );
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    return Result.err(
      new Error(
        `${command} ${args.join(' ')} failed${stderr.length > 0 ? `: ${stderr}` : ''}`,
      ),
    );
  }
  return Result.ok(result.stdout.trim());
}

function toEntryId(entry: { namespace: string; key: string }): string {
  return `${entry.namespace}\u0000${entry.key}`;
}
