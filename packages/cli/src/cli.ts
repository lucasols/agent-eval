import { createRunner } from '@agent-evals/runner';

type CliArgs = {
  command: 'app' | 'list' | 'run' | 'help';
  evalIds: string[];
  caseIds: string[];
  noCache: boolean;
  trials: number;
  json: boolean;
  port: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: 'help',
    evalIds: [],
    caseIds: [],
    noCache: false,
    trials: 1,
    json: false,
    port: 4100,
  };

  const command = argv[0];
  if (
    command === 'app' ||
    command === 'list' ||
    command === 'run' ||
    command === 'help'
  ) {
    args.command = command;
  }

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--eval' && next) {
      args.evalIds.push(...next.split(','));
      i++;
    } else if (arg === '--case' && next) {
      args.caseIds.push(...next.split(','));
      i++;
    } else if (arg === '--no-cache') {
      args.noCache = true;
    } else if (arg === '--trials' && next) {
      args.trials = Number(next);
      i++;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--port' && next) {
      args.port = Number(next);
      i++;
    }
  }

  return args;
}

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
    case 'help':
    default:
      printHelp();
      break;
  }
}

type HonoAppLike = { fetch: (...args: unknown[]) => Response };

async function importUnknown(specifier: string): Promise<unknown> {
  const mod: unknown = await import(specifier);
  return mod;
}

function isHonoAppModule(mod: unknown): mod is { app: HonoAppLike } {
  if (typeof mod !== 'object' || mod === null || !('app' in mod)) {
    return false;
  }
  const { app } = mod;
  return (
    typeof app === 'object' &&
    app !== null &&
    'fetch' in app &&
    typeof app.fetch === 'function'
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

  const target =
    args.evalIds.length > 0
      ? { mode: 'evalIds' as const, evalIds: args.evalIds }
      : { mode: 'all' as const };

  const run = await runner.startRun({
    target,
    disableCache: args.noCache,
    trials: args.trials,
  });

  if (!args.json) {
    console.info(`Run started: ${run.manifest.id}`);
    if (args.noCache) {
      console.info('Cache: disabled');
    }
    console.info(`Trials: ${String(args.trials)}`);
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

  const hasFailures =
    summary.failedCases > 0 || summary.errorCases > 0;

  if (hasFailures) {
    process.exit(1);
  }
}

async function waitForRunCompletion(
  runner: ReturnType<typeof createRunner>,
  runId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const run = runner.getRun(runId);
      if (
        !run ||
        run.manifest.status === 'completed' ||
        run.manifest.status === 'cancelled' ||
        run.manifest.status === 'error'
      ) {
        resolve();
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
  app                Start server with UI
  list               List discovered evals
  run                Run evals
  help               Show this help

Options:
  --eval <id>        Run specific eval(s) (comma-separated)
  --case <id>        Run specific case(s) (comma-separated)
  --no-cache         Disable caching for this run (bypass reads and writes)
  --trials <n>       Number of trials per case
  --json             Output results as JSON
  --port <n>         Server port (default: 4100)
  `);
}
