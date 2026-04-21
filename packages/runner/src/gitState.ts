import { spawnSync } from 'node:child_process';

type GitCommandResult = { status: number | null; stdout: string };

/** Snapshot of the current workspace git state used for eval freshness. */
export type GitWorktreeState = { commitSha: string | null };

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

/** Read the current git commit for the workspace, if available. */
export function readGitWorktreeState(workspaceRoot: string): GitWorktreeState {
  const insideWorktree = runGitCommand(workspaceRoot, [
    'rev-parse',
    '--is-inside-work-tree',
  ]);
  if (insideWorktree.status !== 0 || insideWorktree.stdout !== 'true') {
    return { commitSha: null };
  }

  const commitResult = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  const commitSha = commitResult.status === 0 ? commitResult.stdout : null;

  return { commitSha };
}
