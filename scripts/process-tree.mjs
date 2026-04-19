import { spawn, spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

/**
 * Spawn a long-running child in its own process group so shutdown can target
 * the full descendant tree instead of only the direct child.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} options
 */
export function spawnManaged(command, args, options) {
  return spawn(command, args, options);
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
export function childIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Stop a spawned process tree. Unix uses the process group id, while Windows
 * uses `taskkill` to terminate the full descendant tree.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {'SIGINT' | 'SIGTERM' | 'SIGKILL'} signal
 */
export function terminateProcessTree(child, signal) {
  if (!childIsRunning(child) || child.pid === undefined) {
    return;
  }

  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    return;
  }

  const mappedSignal =
    signal === 'SIGINT' ? '-INT'
    : signal === 'SIGKILL' ? '-KILL'
    : '-TERM';

  const targetPids = [...getDescendantPids(child.pid), child.pid].map((pid) => String(pid));

  spawnSync('kill', [mappedSignal, '--', ...targetPids], {
    stdio: 'ignore',
  });
}

/**
 * @param {number} parentPid
 * @returns {number[]}
 */
function getDescendantPids(parentPid) {
  const result = spawnSync('pgrep', ['-P', String(parentPid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0) {
    return [];
  }

  const directChildren = result.stdout
    .split('\n')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));

  const descendants = [];

  for (const childPid of directChildren) {
    descendants.push(...getDescendantPids(childPid), childPid);
  }

  return descendants;
}
