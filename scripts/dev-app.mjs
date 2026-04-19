import { existsSync, lstatSync, watch } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childIsRunning,
  spawnManaged,
  terminateProcessTree,
} from './process-tree.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const exampleWorkspace = resolve(repoRoot, 'examples/basic-agent');
const serverPort = 4100;
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const watchTargets = [
  { label: 'web source', path: resolve(repoRoot, 'apps/web/src') },
  { label: 'web entry', path: resolve(repoRoot, 'apps/web/index.html') },
  { label: 'web config', path: resolve(repoRoot, 'apps/web/vite.config.ts') },
  { label: 'server source', path: resolve(repoRoot, 'apps/server/src') },
  { label: 'cli source', path: resolve(repoRoot, 'packages/cli/src') },
  { label: 'runner source', path: resolve(repoRoot, 'packages/runner/src') },
  { label: 'sdk source', path: resolve(repoRoot, 'packages/sdk/src') },
  { label: 'shared source', path: resolve(repoRoot, 'packages/shared/src') },
  { label: 'example evals', path: resolve(exampleWorkspace, 'evals') },
  { label: 'example source', path: resolve(exampleWorkspace, 'src') },
  {
    label: 'example config',
    path: resolve(exampleWorkspace, 'agent-evals.config.ts'),
  },
];

/**
 * Fail fast when a fixed dev port is already taken, so `pnpm dev:app` behaves
 * predictably instead of silently switching ports or crashing later.
 *
 * @param {number} port
 * @param {string} serviceName
 */
function assertPortAvailable(port, serviceName) {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.unref();

    probe.once('error', () => {
      rejectPromise(
        new Error(
          `${serviceName} port ${String(port)} is already in use. Stop the existing process on http://localhost:${String(port)} and run \`pnpm dev:app\` again.`,
        ),
      );
    });

    probe.listen(port, () => {
      probe.close(() => resolvePromise());
    });
  });
}

/** @type {import('node:child_process').ChildProcess | null} */
let appProcess = null;
let restartTimer = null;
let pendingRestartReason = null;
/** @type {import('node:fs').FSWatcher[]} */
const watchers = [];
let isShuttingDown = false;

process.once('exit', () => {
  if (appProcess) {
    terminateProcessTree(appProcess, 'SIGKILL');
  }
});

/**
 * @param {number} exitCode
 */
function shutdown(exitCode) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  for (const watcher_ of watchers) {
    watcher_.close();
  }

  if (appProcess) {
    terminateProcessTree(appProcess, 'SIGTERM');
  }

  setTimeout(() => {
    if (appProcess && childIsRunning(appProcess)) {
      terminateProcessTree(appProcess, 'SIGKILL');
    }

    process.exit(exitCode);
  }, 1_000);
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

await assertPortAvailable(serverPort, 'App');

console.info(`Starting example app on http://localhost:${String(serverPort)} using ${exampleWorkspace}`);

startApp();
startWatchers();

function startApp() {
  console.info('Running `pnpm eval app`...');
  const child = spawnManaged(pnpmCommand, ['eval', 'app', '--port', String(serverPort)], {
    cwd: exampleWorkspace,
    stdio: 'inherit',
  });

  appProcess = child;

  child.once('error', (error) => {
    console.error('Failed to start example app:', error);
    shutdown(1);
  });

  child.once('exit', (code, signal) => {
    if (appProcess === child) {
      appProcess = null;
    }

    if (isShuttingDown) {
      return;
    }

    if (pendingRestartReason) {
      const reason = pendingRestartReason;
      pendingRestartReason = null;
      console.info(`Restarting example app after ${reason}...`);
      startApp();
      return;
    }

    if (signal) {
      console.info(`Example app stopped with signal ${signal}.`);
      shutdown(1);
      return;
    }

    shutdown(code ?? 0);
  });
}

function startWatchers() {
  for (const target of watchTargets) {
    if (!existsSync(target.path)) {
      continue;
    }

    const recursive = lstatSync(target.path).isDirectory();
    const watcher_ = watch(
      target.path,
      { recursive },
      (eventType, filename) => {
        const changedPath =
          typeof filename === 'string' && filename.length > 0 ?
            `${target.label}: ${filename}`
          : target.label;
        requestRestart(`${eventType} in ${changedPath}`);
      },
    );
    watchers.push(watcher_);
  }
}

function requestRestart(reason) {
  pendingRestartReason = reason;

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (isShuttingDown || !pendingRestartReason) {
      return;
    }
    if (!appProcess) {
      const pendingReason = pendingRestartReason;
      pendingRestartReason = null;
      console.info(`Restarting example app after ${pendingReason}...`);
      startApp();
      return;
    }

    console.info(`Change detected, restarting example app... (${pendingRestartReason})`);
    terminateProcessTree(appProcess, 'SIGTERM');
  }, 150);
}
