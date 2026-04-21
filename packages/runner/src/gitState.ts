import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

type GitCommandResult = { status: number | null; stdout: string };

/** Snapshot of the current workspace git state used for eval freshness. */
export type GitWorktreeState = {
  commitSha: string | null;
  hasTrackedChanges: boolean;
  trackedChangesFingerprint: string | null;
};

function runGitCommand(
  workspaceRoot: string,
  args: string[],
): GitCommandResult {
  const result = spawnSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  return { status: result.status, stdout: result.stdout.trim() };
}

/**
 * Read the current git commit and whether tracked files differ from `HEAD`.
 *
 * When the workspace is not a git repository, `commitSha` is `null`.
 */
export function readGitWorktreeState(workspaceRoot: string): GitWorktreeState {
  const insideWorktree = runGitCommand(workspaceRoot, [
    'rev-parse',
    '--is-inside-work-tree',
  ]);
  if (insideWorktree.status !== 0 || insideWorktree.stdout !== 'true') {
    return {
      commitSha: null,
      hasTrackedChanges: false,
      trackedChangesFingerprint: null,
    };
  }

  const commitResult = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  const commitSha = commitResult.status === 0 ? commitResult.stdout : null;

  const diffResult = runGitCommand(workspaceRoot, [
    'diff',
    '--quiet',
    '--ignore-submodules',
    'HEAD',
    '--',
  ]);

  return {
    commitSha,
    hasTrackedChanges: diffResult.status === 1,
    trackedChangesFingerprint:
      diffResult.status === 1
        ? readTrackedChangesFingerprint(workspaceRoot)
        : null,
  };
}

function readTrackedChangesFingerprint(workspaceRoot: string): string | null {
  const diffResult = runGitCommand(workspaceRoot, [
    'diff',
    '--no-ext-diff',
    '--binary',
    'HEAD',
    '--',
  ]);
  if (diffResult.status !== 0 || diffResult.stdout.length === 0) return null;

  return createHash('sha256').update(diffResult.stdout).digest('hex');
}
