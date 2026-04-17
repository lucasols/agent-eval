import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * @param {string} label
 * @param {string[]} args
 * @param {string} cwd
 */
function startProcess(label, args, cwd) {
  const child = spawn(pnpmCommand, args, {
    cwd,
    stdio: 'inherit',
  });

  child.once('error', (error) => {
    console.error(`Failed to start ${label}:`, error);
    shutdown(1);
  });

  child.once('exit', (code, signal) => {
    if (isShuttingDown) {
      return;
    }

    if (signal) {
      console.info(`${label} stopped with signal ${signal}.`);
      shutdown(1);
      return;
    }

    shutdown(code ?? 0);
  });

  return child;
}

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let isShuttingDown = false;

function shutdown(exitCode) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 50).unref();
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

await Promise.all([
  assertPortAvailable(serverPort, 'Server'),
  assertPortAvailable(webPort, 'Web app'),
]);

console.info(`Starting server on http://localhost:${String(serverPort)} using ${exampleWorkspace}`);
console.info(`Starting web app on http://localhost:${String(webPort)}`);

children.push(
  startProcess(
    'server',
    ['--dir', exampleWorkspace, '--filter', '@agent-evals/server', 'dev'],
    repoRoot,
  ),
);

children.push(
  startProcess('web app', ['--filter', '@agent-evals/web', 'dev'], repoRoot),
);
