import type { ChangedEvals } from '@agent-evals/shared';
import { Result } from 't-result';
import {
  resolveGitBaseRef,
  runGit,
  type ResolvedGitBaseRef,
} from './gitBaseRef.ts';
import { readGitWorktreeState } from './gitState.ts';

// `gh pr view` hits the network, so reuse the resolved base for a while
// instead of calling it on every eval-file save.
const BASE_REF_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedBaseRef = {
  workspaceRoot: string;
  branchName: string | null;
  resolvedAt: number;
  baseRef: Promise<Result<ResolvedGitBaseRef, Error>>;
};

/**
 * Create a reader that reports which evals changed on the current branch. The
 * resolved base ref is cached per branch for a few minutes; the changed file
 * list is recomputed on every call.
 */
export function createChangedEvalsReader(params: {
  getWorkspaceRoot: () => string;
  getConfiguredBaseRef: () => string | undefined;
}) {
  let cached: CachedBaseRef | undefined;

  function getBaseRef(workspaceRoot: string, branchName: string | null) {
    const now = Date.now();
    if (
      cached?.workspaceRoot === workspaceRoot &&
      cached.branchName === branchName &&
      now - cached.resolvedAt < BASE_REF_CACHE_TTL_MS
    ) {
      return cached.baseRef;
    }
    const baseRef = resolveGitBaseRef({
      workspaceRoot,
      flagBaseRef: undefined,
      configuredBaseRef: params.getConfiguredBaseRef(),
    });
    cached = { workspaceRoot, branchName, resolvedAt: now, baseRef };
    return baseRef;
  }

  /** Return the keys of `evals` whose file changed since the merge-base. */
  return async function readChangedEvals(
    evals: { key: string; filePath: string }[],
  ): Promise<ChangedEvals> {
    const workspaceRoot = params.getWorkspaceRoot();
    const gitState = readGitWorktreeState(workspaceRoot);
    if (gitState.commitSha === null) {
      return { available: false, reason: 'Workspace is not a git repository.' };
    }

    const baseRef = await getBaseRef(workspaceRoot, gitState.branchName);
    if (baseRef.error) {
      return { available: false, reason: baseRef.error.message };
    }
    // `flag` is impossible here: no `--base` override is passed.
    const baseRefSource =
      baseRef.value.source === 'pullRequest' ? 'pullRequest' : 'config';

    const mergeBase = await runGit(workspaceRoot, [
      'merge-base',
      'HEAD',
      baseRef.value.ref,
    ]);
    if (mergeBase.error) {
      return { available: false, reason: mergeBase.error.message };
    }

    const changedFiles = await listChangedFiles(workspaceRoot, mergeBase.value);
    if (changedFiles.error) {
      return { available: false, reason: changedFiles.error.message };
    }

    return {
      available: true,
      baseRef: baseRef.value.ref,
      baseRefSource,
      mergeBase: mergeBase.value,
      evalKeys: evals
        .filter((evalMeta) => changedFiles.value.has(evalMeta.filePath))
        .map((evalMeta) => evalMeta.key),
    };
  };
}

/**
 * Workspace-relative paths changed since `mergeBase`, including uncommitted
 * edits and untracked files.
 */
async function listChangedFiles(
  workspaceRoot: string,
  mergeBase: string,
): Promise<Result<Set<string>, Error>> {
  const [diff, untracked] = await Promise.all([
    runGit(workspaceRoot, [
      'diff',
      '--name-only',
      '--relative',
      '-z',
      mergeBase,
    ]),
    runGit(workspaceRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  if (diff.error) return diff.errorResult();
  if (untracked.error) return untracked.errorResult();

  return Result.ok(
    new Set(
      [...diff.value.split('\0'), ...untracked.value.split('\0')].filter(
        (path) => path.length > 0,
      ),
    ),
  );
}
