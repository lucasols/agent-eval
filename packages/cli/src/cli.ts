import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CacheMode } from '@agent-evals/shared';
import { createRunner } from '@agent-evals/runner';

type CliArgs = {
  command: 'app' | 'list' | 'run' | 'cache' | 'help';
  subcommand: string | undefined;
  evalIds: string[];
  caseIds: string[];
  trials: number;
  json: boolean;
  port: number;
  cacheMode: CacheMode;
  clearCache: boolean;
  all: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: 'help',
    subcommand: undefined,
    evalIds: [],
    caseIds: [],
    trials: 1,
    json: false,
    port: 4100,
    cacheMode: 'use',
    clearCache: false,
    all: false,
  };

  const command = argv[0];
  if (
    command === 'app'
    || command === 'list'
    || command === 'run'
    || command === 'cache'
    || command === 'help'
  ) {
    args.command = command;
  }

  let cursor = 1;
  if (args.command === 'cache') {
    const sub = argv[cursor];
    if (sub === 'list' || sub === 'clear') {
      args.subcommand = sub;
      cursor++;
    }
  }

  for (let i = cursor; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--eval' && next) {
      args.evalIds.push(...next.split(','));
      i++;
    } else if (arg === '--case' && next) {
      args.caseIds.push(...next.split(','));
      i++;
    } else if (arg === '--trials' && next) {
      args.trials = Number(next);
      i++;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--port' && next) {
      args.port = Number(next);
      i++;
    } else if (arg === '--cache' && next) {
      if (next === 'use' || next === 'bypass' || next === 'refresh') {
        args.cacheMode = next;
      }
      i++;
    } else if (arg === '--no-cache') {
      args.cacheMode = 'bypass';
    } else if (arg === '--refresh-cache') {
      args.cacheMode = 'refresh';
    } else if (arg === '--clear-cache') {
      args.clearCache = true;
    } else if (arg === '--all') {
      args.all = true;
    }
  }

  return args;
}

/**
 * Run the Agent Evals CLI against the current workspace.
 *
 * @param argv Raw command-line arguments excluding the executable name.
 */
export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  switch (args.command) {
    case 'app':
      await commandApp(args);
      break;
    case 'list':
      await commandList(args);
      break;
    case 'run':
      await commandRun(args);
      break;
    case 'cache':
      await commandCache(args);
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

type HonoAppLike = { fetch: (...args: unknown[]) => Response };

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

async function importUnknown(specifier: string): Promise<unknown> {
  const mod: unknown = await import(specifier);
  return mod;
}

function hasRepoWebWorkspace(): boolean {
  return existsSync(resolve(repoRoot, 'apps/web/package.json'));
}

async function ensureWebUiIsBuilt(): Promise<void> {
  if (!hasRepoWebWorkspace()) {
    return;
  }

  console.info('Preparing web UI...');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      pnpmCommand,
      ['--filter', '@agent-evals/web', 'build'],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );

    child.once('error', (error) => {
      rejectPromise(error);
    });

    child.once('exit', (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`Web UI build stopped with signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        rejectPromise(
          new Error(`Web UI build failed with exit code ${String(code)}.`),
        );
        return;
      }

      resolvePromise();
    });
  });
}

function isHonoAppModule(mod: unknown): mod is { app: HonoAppLike } {
  if (typeof mod !== 'object' || mod === null || !('app' in mod)) {
    return false;
  }
  const { app } = mod;
  return (
    typeof app === 'object'
    && app !== null
    && 'fetch' in app
    && typeof app.fetch === 'function'
  );
}

function isServerRunnerModule(
  mod: unknown,
): mod is { initRunner: () => Promise<unknown> } {
  if (typeof mod !== 'object' || mod === null || !('initRunner' in mod)) {
    return false;
  }
  return typeof mod.initRunner === 'function';
}

async function commandApp(args: CliArgs): Promise<void> {
  await ensureWebUiIsBuilt();

  const { serve } = await import('@hono/node-server');
  const appModule = await importUnknown('../../../apps/server/src/app.ts');
  const runnerModule = await importUnknown(
    '../../../apps/server/src/runner.ts',
  );

  if (!isHonoAppModule(appModule)) {
    throw new Error('Server app module is invalid');
  }
  if (!isServerRunnerModule(runnerModule)) {
    throw new Error('Server runner module is invalid');
  }

  await runnerModule.initRunner();

  console.info(`Agent Evals app: http://localhost:${String(args.port)}`);
  serve({ fetch: appModule.app.fetch, port: args.port });
}

async function commandList(args_: CliArgs): Promise<void> {
  const runner = createRunner({ watchForChanges: false });
  await runner.init();

  const evals = runner.getEvals();

  if (evals.length === 0) {
    console.info('No eval files found.');
    return;
  }

  console.info('Discovered evals:\n');
  for (const ev of evals) {
    const staleTag = ev.stale ? ' [stale]' : '';
    const title = ev.title ?? ev.id;
    console.info(`  ${title}${staleTag}`);
    console.info(`    id: ${ev.id}`);
    console.info(`    file: ${ev.filePath}`);
    if (ev.caseCount !== null) {
      console.info(`    cases: ${String(ev.caseCount)}`);
    }
    console.info('');
  }
}

async function commandRun(args: CliArgs): Promise<void> {
  const runner = createRunner({ watchForChanges: false });
  await runner.init();

  if (args.clearCache) {
    await runner.clearCache();
    if (!args.json) {
      console.info('Cleared cache before run.');
      console.info('');
    }
  }

  const target =
    args.caseIds.length > 0 ?
      {
        mode: 'caseIds' as const,
        caseIds: args.caseIds,
        evalIds: args.evalIds.length > 0 ? args.evalIds : undefined,
      }
    : args.evalIds.length > 0 ?
      { mode: 'evalIds' as const, evalIds: args.evalIds }
    : { mode: 'all' as const };

  const run = await runner.startRun({
    target,
    trials: args.trials,
    cache: { mode: args.cacheMode },
  });

  if (!args.json) {
    console.info(`Run started: ${run.manifest.id}`);
    console.info(`Trials: ${String(args.trials)}`);
    if (args.cacheMode !== 'use') {
      console.info(`Cache mode: ${args.cacheMode}`);
    }
    console.info('');
  }

  await waitForRunCompletion(runner, run.manifest.id);

  const finalRun = runner.getRun(run.manifest.id);
  if (!finalRun) {
    process.exit(1);
    return;
  }

  const { summary } = finalRun;

  if (args.json) {
    console.info(JSON.stringify(summary, null, 2));
  } else {
    console.info('--- Run Summary ---');
    console.info(`Status: ${summary.status}`);
    console.info(`Total: ${String(summary.totalCases)}`);
    console.info(`Passed: ${String(summary.passedCases)}`);
    console.info(`Failed: ${String(summary.failedCases)}`);
    console.info(`Errors: ${String(summary.errorCases)}`);
    if (summary.averageScore !== null) {
      console.info(`Avg Score: ${summary.averageScore.toFixed(2)}`);
    }
    if (summary.totalDurationMs !== null) {
      console.info(`Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
    }
    if (summary.cost.totalUsd !== null) {
      console.info(`Cost: $${summary.cost.totalUsd.toFixed(4)}`);
    }
  }

  const hasFailures = summary.failedCases > 0 || summary.errorCases > 0;

  if (hasFailures) {
    process.exit(1);
  }
}

async function commandCache(args: CliArgs): Promise<void> {
  const runner = createRunner({ watchForChanges: false });
  await runner.init();

  if (args.subcommand === 'list' || args.subcommand === undefined) {
    const entries = await runner.listCache();
    if (args.json) {
      console.info(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      console.info('No cache entries.');
      return;
    }
    console.info(`Cache entries (${String(entries.length)}):\n`);
    for (const entry of entries) {
      console.info(`  ${entry.namespace}`);
      console.info(`    key: ${entry.key}`);
      console.info(`    span: ${entry.spanName} (${entry.spanKind})`);
      console.info(`    stored: ${entry.storedAt}`);
      console.info(`    size: ${String(entry.sizeBytes)} bytes`);
      console.info('');
    }
    return;
  }

  if (args.subcommand === 'clear') {
    if (args.evalIds.length > 0) {
      for (const evalId of args.evalIds) {
        const entries = await runner.listCache();
        const prefix = `${evalId}__`;
        const matching = entries.filter((entry) =>
          entry.namespace.startsWith(prefix),
        );
        for (const entry of matching) {
          await runner.clearCache({
            namespace: entry.namespace,
            key: entry.key,
          });
        }
      }
      console.info(`Cleared cache entries for: ${args.evalIds.join(', ')}`);
      return;
    }
    if (args.all) {
      await runner.clearCache();
      console.info('Cleared all cache entries.');
      return;
    }
    console.info(
      'Refusing to clear cache without --eval <id> or --all. Use one of these flags to confirm.',
    );
    process.exit(1);
    return;
  }

  printHelp();
}

async function waitForRunCompletion(
  runner: ReturnType<typeof createRunner>,
  runId: string,
): Promise<void> {
  return new Promise((resolvePromise) => {
    const check = () => {
      const run = runner.getRun(runId);
      if (
        !run
        || run.manifest.status === 'completed'
        || run.manifest.status === 'cancelled'
        || run.manifest.status === 'error'
      ) {
        resolvePromise();
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

function printHelp(): void {
  console.info(`
agent-evals - LLM/Agent eval runner

Commands:
  app                        Start server with UI
  list                       List discovered evals
  run                        Run evals
  cache list                 List cached operation entries
  cache clear --eval <id>    Clear cache entries for one eval
  cache clear --all          Clear every cached entry
  help                       Show this help

Options:
  --eval <id>                Run specific eval(s) (comma-separated)
  --case <id>                Run specific case(s) (comma-separated)
  --trials <n>               Number of trials per case
  --json                     Output results as JSON
  --port <n>                 Server port (default: 4100)
  --cache <use|bypass|refresh>  Cache mode for this run (default: use)
  --no-cache                 Shortcut for --cache bypass
  --refresh-cache            Shortcut for --cache refresh
  --clear-cache              Clear the cache before starting the run
  `);
}
