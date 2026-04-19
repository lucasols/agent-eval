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

/**
 * Fail fast when a fixed dev port is already taken, so `pnpm dev:server`
 * behaves predictably instead of crashing later.
 *
 * @param {number} port
 */
function assertPortAvailable(port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.unref();

    probe.once('error', () => {
      rejectPromise(
        new Error(
          `Agent Evals server port ${String(port)} is already in use. Stop the existing process on http://localhost:${String(port)} and run \`pnpm dev:server\` again.`,
        ),
      );
    });

    probe.listen(port, () => {
      probe.close(() => resolvePromise());
    });
  });
}

await assertPortAvailable(serverPort);

console.info(`Starting Agent Evals server on http://localhost:${String(serverPort)}`);

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

process.once('exit', () => {
  terminateProcessTree(child, 'SIGKILL');
});

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

child.once('error', (error) => {
  console.error('Failed to start Agent Evals server:', error);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});

/**
 * @param {number} exitCode
 */
function shutdown(exitCode) {
  terminateProcessTree(child, 'SIGTERM');

  setTimeout(() => {
    if (childIsRunning(child)) {
      terminateProcessTree(child, 'SIGKILL');
    }

    process.exit(exitCode);
  }, 1_000);
}
