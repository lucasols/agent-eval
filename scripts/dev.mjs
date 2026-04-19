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
const webPort = 4200;
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/**
 * Fail fast when a fixed dev port is already taken, so `pnpm dev` behaves
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
          `${serviceName} port ${String(port)} is already in use. Stop the existing process on http://localhost:${String(port)} and run \`pnpm dev\` again.`,
        ),
      );
    });

    probe.listen(port, () => {
      probe.close(() => resolvePromise());
    });
  });
}

/**
 * @typedef {{
 *   label: string;
 *   child: import('node:child_process').ChildProcess;
 * }} ManagedChild
 */

/** @type {ManagedChild[]} */
const managedChildren = [];
let isShuttingDown = false;

process.once('exit', () => {
  for (const { child } of managedChildren) {
    terminateProcessTree(child, 'SIGKILL');
  }
});

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

await Promise.all([
  assertPortAvailable(serverPort, 'Agent Evals server'),
  assertPortAvailable(webPort, 'Web dev server'),
]);

console.info(`Starting Agent Evals server on http://localhost:${String(serverPort)}`);
console.info(`Starting Vite dev server on http://localhost:${String(webPort)}`);

startServer();
startWeb();

function startServer() {
  const child = spawnManaged(
    process.execPath,
    ['--watch', resolve(repoRoot, 'apps/server/src/index.ts')],
    {
      cwd: exampleWorkspace,
      env: {
        ...process.env,
        PORT: String(serverPort),
      },
      stdio: 'inherit',
    },
  );

  registerChild('Agent Evals server', child);
}

function startWeb() {
  const child = spawnManaged(
    pnpmCommand,
    [
      '--filter',
      '@agent-evals/web',
      'dev',
      '--',
      '--host',
      'localhost',
      '--port',
      String(webPort),
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    },
  );

  registerChild('Web dev server', child);
}

/**
 * @param {string} label
 * @param {import('node:child_process').ChildProcess} child
 */
function registerChild(label, child) {
  managedChildren.push({ label, child });

  child.once('error', (error) => {
    console.error(`Failed to start ${label}:`, error);
    shutdown(1);
  });

  child.once('exit', (code, signal) => {
    if (isShuttingDown) {
      return;
    }

    if (signal) {
      console.error(`${label} stopped with signal ${signal}.`);
    } else if (code !== 0) {
      console.error(`${label} exited with code ${String(code)}.`);
    } else {
      console.error(`${label} exited unexpectedly.`);
    }

    shutdown(code ?? 1);
  });
}

/**
 * @param {number} exitCode
 */
function shutdown(exitCode) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  for (const { child } of managedChildren) {
    terminateProcessTree(child, 'SIGTERM');
  }

  setTimeout(() => {
    for (const { child } of managedChildren) {
      if (childIsRunning(child)) {
        terminateProcessTree(child, 'SIGKILL');
      }
    }

    process.exit(exitCode);
  }, 1_000);
}
