import { execFile } from 'node:child_process';
import { Result } from 't-result';

/** Where a resolved base ref came from. */
export type GitBaseRefSource = 'flag' | 'config' | 'pullRequest';

/** Git ref the current branch is compared against, plus its origin. */
export type ResolvedGitBaseRef = { ref: string; source: GitBaseRefSource };

/**
 * Resolve the ref the current branch will merge into: `flagBaseRef` when
 * given, else the current pull request's base branch from `gh pr view`
 * (preferring `origin/<base>`), else `configuredBaseRef`.
 */
export async function resolveGitBaseRef(params: {
  workspaceRoot: string;
  flagBaseRef: string | undefined;
  configuredBaseRef: string | undefined;
}): Promise<Result<ResolvedGitBaseRef, Error>> {
  if (params.flagBaseRef !== undefined) {
    return verifyRef(params.workspaceRoot, params.flagBaseRef, 'flag');
  }

  const prBase = await runCommand(params.workspaceRoot, 'gh', [
    'pr',
    'view',
    '--json',
    'baseRefName',
    '--jq',
    '.baseRefName',
  ]);
  if (!prBase.error && prBase.value.length > 0) {
    // Prefer the remote-tracking ref so a stale local base branch does not
    // make already-merged changes look branch-added.
    const remoteRef = await verifyRef(
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

async function verifyRef(
  workspaceRoot: string,
  ref: string,
  source: GitBaseRefSource,
): Promise<Result<ResolvedGitBaseRef, Error>> {
  const verified = await runGit(workspaceRoot, [
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

/** Run `git` in `cwd` and return its trimmed stdout. */
export function runGit(
  cwd: string,
  args: string[],
): Promise<Result<string, Error>> {
  return runCommand(cwd, 'git', args);
}

function runCommand(
  cwd: string,
  command: string,
  args: string[],
): Promise<Result<string, Error>> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // PR lookup must not hold eval completion indefinitely when offline.
        timeout: command === 'gh' ? 5_000 : 0,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(Result.ok(stdout.trim()));
          return;
        }
        if (error.killed) {
          resolve(
            Result.err(new Error(`${command} ${args.join(' ')} timed out`)),
          );
          return;
        }
        if (typeof error.code === 'string') {
          resolve(
            Result.err(
              new Error(`${command} could not be started: ${error.message}`),
            ),
          );
          return;
        }
        const trimmedStderr = stderr.trim();
        resolve(
          Result.err(
            new Error(
              `${command} ${args.join(' ')} failed${trimmedStderr.length > 0 ? `: ${trimmedStderr}` : ''}`,
            ),
          ),
        );
      },
    );
  });
}
