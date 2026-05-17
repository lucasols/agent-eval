import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '@agent-evals/runner';
import {
  getEvalDisplayStatus,
  getEvalTitle,
  type CaseRow,
  type CacheMode,
  type RunManifest,
  type RunSummary,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { printHelp, type HelpTopic } from './cliHelp.ts';
import { collectManualInputs } from './manualInputArgs.ts';

type CliCommand = 'app' | 'list' | 'run' | 'show-runs' | 'cache' | 'help';

type CliArgs = {
  command: CliCommand;
  subcommand: string | undefined;
  positionals: string[];
  showHelp: boolean;
  helpTopic: HelpTopic;
  unknownHelpTarget: string | undefined;
  evalIds: string[];
  files: string[];
  caseIds: string[];
  tagsFilter: string[];
  trials: number;
  json: boolean;
  port: number;
  cacheMode: CacheMode;
  clearCache: boolean;
  temporary: boolean;
  all: boolean;
  loadEnv: boolean;
  /** JSON value supplied with `--input`; used as the manual input for a single targeted eval. */
  inputJson: string | undefined;
  /**
   * Path supplied with `--input-file`; resolved as JSON. The file may be the
   * raw input value (for a single-eval run) or an object keyed by eval key
   * mapping to per-eval inputs (for multi-eval runs).
   */
  inputFilePath: string | undefined;
};

function parseArgs(argv: string[]): CliArgs {
  const normalizedArgv = argv.filter((arg) => arg !== '--no-env');
  const args: CliArgs = {
    command: 'help',
    subcommand: undefined,
    positionals: [],
    showHelp: false,
    helpTopic: 'global',
    unknownHelpTarget: undefined,
    evalIds: [],
    files: [],
    caseIds: [],
    tagsFilter: [],
    trials: 1,
    json: false,
    port: 4100,
    cacheMode: 'use',
    clearCache: false,
    temporary: false,
    all: false,
    loadEnv: normalizedArgv.length === argv.length,
    inputJson: undefined,
    inputFilePath: undefined,
  };

  const command = normalizedArgv[0];
  if (command === '--help' || command === '-h') {
    args.showHelp = true;
    return args;
  }

  if (isCliCommand(command)) {
    args.command = command;
    args.helpTopic = command === 'help' ? 'global' : command;
  } else if (command !== undefined && !command.startsWith('-')) {
    args.unknownHelpTarget = command;
  }

  let cursor = 1;
  if (args.command === 'cache') {
    const sub = normalizedArgv[cursor];
    if (sub === 'list' || sub === 'clear' || sub === 'repair') {
      args.subcommand = sub;
      args.helpTopic = `cache ${sub}`;
      cursor++;
    } else if (sub !== undefined && !sub.startsWith('-')) {
      args.unknownHelpTarget = `cache ${sub}`;
    }
  }

  for (let i = cursor; i < normalizedArgv.length; i++) {
    const arg = normalizedArgv[i];
    if (arg === undefined) continue;
    const next = normalizedArgv[i + 1];

    if (arg === '--help' || arg === '-h') {
      args.showHelp = true;
    } else if (arg === '--eval' && next) {
      args.evalIds.push(...next.split(','));
      i++;
    } else if (arg === '--file' && next) {
      args.files.push(...next.split(','));
      i++;
    } else if (arg === '--case' && next) {
      args.caseIds.push(...next.split(','));
      i++;
    } else if (arg === '--tags-filter' && next) {
      args.tagsFilter.push(...next.split(','));
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
    } else if (arg === '--temporary') {
      args.temporary = true;
    } else if (arg === '--input' && next !== undefined) {
      args.inputJson = next;
      i++;
    } else if (arg === '--input-file' && next !== undefined) {
      args.inputFilePath = next;
      i++;
    } else if (arg === '--all') {
      args.all = true;
    } else if (!arg.startsWith('-')) {
      args.positionals.push(arg);
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

  if (args.loadEnv && !loadWorkspaceEnv()) {
    process.exit(1);
  }

  if (args.showHelp) {
    if (args.unknownHelpTarget !== undefined) {
      console.error(`No help found for "${args.unknownHelpTarget}".`);
      process.exit(1);
    }
    printHelp(args.helpTopic);
    return;
  }

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
    case 'show-runs':
      await commandShowRuns(args);
      break;
    case 'cache':
      await commandCache(args);
      break;
    case 'help':
    default:
      printHelp(args.helpTopic);
      break;
  }
}

function isCliCommand(command: string | undefined): command is CliCommand {
  return (
    command === 'app' ||
    command === 'list' ||
    command === 'run' ||
    command === 'show-runs' ||
    command === 'cache' ||
    command === 'help'
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replaceAll('\\', '/');
  let regex = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      i++;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegex(char ?? '');
    }
  }
  return new RegExp(`${regex}$`);
}

function fileMatches(pattern: string, filePath: string): boolean {
  const normalized = pattern.replaceAll('\\', '/');
  return normalized === filePath || globToRegex(normalized).test(filePath);
}

function loadWorkspaceEnv(): boolean {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return true;
  }

  const loadResult = resultify(() => {
    process.loadEnvFile(envPath);
  });
  if (loadResult.error) {
    console.error(
      `Failed to load .env at ${envPath}: ${loadResult.error.message}`,
    );
    return false;
  }

  return true;
}

function formatUnknownErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

type HonoAppLike = { fetch: (...args: unknown[]) => Response };

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

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
      { cwd: repoRoot, stdio: 'inherit' },
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
  await ensureWebUiIsBuilt();

  const { serve } = await import('@hono/node-server');
  const bundledWebDist = resolve(currentDir, 'apps/web/dist');
  if (existsSync(bundledWebDist)) {
    process.env.AGENT_EVALS_WEB_DIST = bundledWebDist;
  }

  const appModule: unknown = await import('../../../apps/server/src/app.ts');
  const runnerModule: unknown =
    await import('../../../apps/server/src/runner.ts');

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

  const discoveryIssues = runner.getDiscoveryIssues();
  if (discoveryIssues.length > 0) {
    console.error('Discovery errors:\n');
    for (const issue of discoveryIssues) {
      console.error(`  ${issue.message}`);
    }
    console.error('');
  }

  const evals = runner.getEvals();

  if (evals.length === 0) {
    console.info('No eval files found.');
    if (discoveryIssues.length > 0) process.exit(1);
    return;
  }

  console.info('Discovered evals:\n');
  for (const ev of evals) {
    const displayStatus = getEvalDisplayStatus({
      freshnessStatus: ev.freshnessStatus,
      stale: ev.stale,
      outdated: ev.outdated,
      lastRunStatus: ev.lastRunStatus,
    });
    const title = getEvalTitle(ev);
    console.info(`  ${title}`);
    console.info(`    id: ${ev.id}`);
    console.info(`    file: ${ev.filePath}`);
    if (displayStatus !== 'pending') {
      console.info(`    status: ${displayStatus}`);
    }
    if (ev.caseCount !== null) {
      console.info(`    cases: ${String(ev.caseCount)}`);
    }
    console.info('');
  }
  if (discoveryIssues.length > 0) process.exit(1);
}

async function commandRun(args: CliArgs): Promise<void> {
  const runner = createRunner({ watchForChanges: false });
  await runner.init();

  const runTargetsAllEvals =
    args.evalIds.length === 0 &&
    args.caseIds.length === 0 &&
    args.files.length === 0 &&
    args.tagsFilter.length === 0;
  if (runTargetsAllEvals && !runner.getAllowCliRunAll()) {
    console.error(
      'This workspace disables running all evals from the CLI. Pass --eval <id>, --file <path|glob>, --case <id>, or --tags-filter <expr> to run a targeted subset.',
    );
    process.exit(1);
  }

  if (args.clearCache) {
    await runner.clearCache();
    if (!args.json) {
      console.info('Cleared cache before run.');
      console.info('');
    }
  }

  const target =
    args.caseIds.length > 0
      ? {
          mode: 'caseIds' as const,
          caseIds: args.caseIds,
          evalIds: args.evalIds.length > 0 ? args.evalIds : undefined,
          files: args.files.length > 0 ? args.files : undefined,
          tagsFilter: args.tagsFilter.length > 0 ? args.tagsFilter : undefined,
        }
      : args.evalIds.length > 0
        ? {
            mode: 'evalIds' as const,
            evalIds: args.evalIds,
            files: args.files.length > 0 ? args.files : undefined,
            tagsFilter:
              args.tagsFilter.length > 0 ? args.tagsFilter : undefined,
          }
        : args.files.length > 0
          ? {
              mode: 'evalIds' as const,
              files: args.files,
              tagsFilter:
                args.tagsFilter.length > 0 ? args.tagsFilter : undefined,
            }
          : args.tagsFilter.length > 0
            ? { mode: 'evalIds' as const, tagsFilter: args.tagsFilter }
            : { mode: 'all' as const };

  const manualInputsResult = await collectManualInputs({
    runner,
    args: {
      evalIds: args.evalIds,
      files: args.files,
      caseIds: args.caseIds,
      tagsFilter: args.tagsFilter,
      inputJson: args.inputJson,
      inputFilePath: args.inputFilePath,
    },
  });
  if (manualInputsResult.error !== null) {
    console.error(manualInputsResult.error);
    process.exit(1);
  }

  const runResult = await resultify(() =>
    runner.startRun({
      target,
      trials: args.trials,
      temporary: args.temporary,
      cache: { mode: args.cacheMode },
      manualInputs: manualInputsResult.value,
    }),
  );
  if (runResult.error) {
    console.error('Failed to start run:');
    console.error(formatUnknownErrorDetails(runResult.error));
    process.exit(1);
  }
  const run = runResult.value;

  if (!args.json) {
    console.info(`Run started: ${run.manifest.id}`);
    console.info(`Trials: ${String(args.trials)}`);
    if (args.cacheMode !== 'use') {
      console.info(`Cache mode: ${args.cacheMode}`);
    }
    if (args.temporary) {
      console.info('Temporary: yes');
    }
    console.info('');
  }

  await waitForRunCompletion(runner, run.manifest.id);

  const finalRun = runner.getRun(run.manifest.id);
  if (!finalRun) {
    process.exit(1);
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
    if (summary.totalCases > 0) {
      console.info(
        `Pass Rate: ${String(summary.passedCases)}/${String(summary.totalCases)}`,
      );
    }
    if (summary.totalDurationMs !== null) {
      console.info(`Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
    }
    if (summary.errorMessage !== null) {
      console.info('');
      console.info(summary.errorMessage);
    }
  }

  const hasFailures =
    summary.status === 'error' ||
    summary.failedCases > 0 ||
    summary.errorCases > 0;

  if (hasFailures) {
    process.exit(1);
  }
}

type RunSnapshot = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
};

type RunFileIndex = {
  id: string;
  shortId: string;
  status: RunManifest['status'];
  temporary: boolean;
  startedAt: string;
  endedAt: string | null;
  target: RunManifest['target'];
  summary: RunSummary;
  files: {
    dir: string;
    run: string;
    summary: string;
    cases: string;
    caseDetailsDir: string;
    tracesDir: string;
  };
  cases: Array<{
    caseId: string;
    caseKey: string | undefined;
    evalId: string;
    evalKey: string | undefined;
    status: CaseRow['status'];
    files: { caseDetail: string; trace: string };
  }>;
};

async function commandShowRuns(args: CliArgs): Promise<void> {
  const runner = createRunner({ watchForChanges: false });
  await runner.init();

  const runRef = args.positionals[0];
  if (runRef !== undefined) {
    const run = resolveRunSnapshot(runner, runRef);
    if (!run) {
      printMissingRun(runRef);
      process.exit(1);
    }
    const index = buildRunFileIndex(runner.getWorkspaceRoot(), run);
    if (args.json) {
      printJson(index);
      return;
    }
    printRunFileIndex(index);
    return;
  }

  const indexes = getSortedRunSnapshots(runner).map((run) =>
    buildRunFileIndex(runner.getWorkspaceRoot(), run),
  );
  if (args.json) {
    printJson(indexes);
    return;
  }
  printRunFileIndexes(indexes);
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
      console.info(`    stored: ${entry.storedAt}`);
      console.info(`    last accessed: ${entry.lastAccessedAt}`);
      console.info('');
    }
    return;
  }

  if (args.subcommand === 'clear') {
    if (args.evalIds.length > 0 || args.files.length > 0) {
      const evalIds = runner
        .getEvals()
        .filter(
          (ev) =>
            (args.evalIds.length === 0 || args.evalIds.includes(ev.id)) &&
            (args.files.length === 0 ||
              args.files.some((file) => fileMatches(file, ev.filePath))),
        )
        .map((ev) => ev.id);
      for (const evalId of evalIds) {
        const entries = await runner.listCache();
        const prefix = `${evalId}.`;
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
      console.info(`Cleared cache entries for: ${evalIds.join(', ')}`);
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
  }

  if (args.subcommand === 'repair') {
    const summary = await runner.repairCache();
    if (args.json) {
      console.info(JSON.stringify(summary, null, 2));
      return;
    }
    console.info('Cache repair complete.');
    console.info(`Removed cache files: ${String(summary.removedCacheFiles)}`);
    console.info(`Removed debug files: ${String(summary.removedDebugFiles)}`);
    console.info(`Removed blob files: ${String(summary.removedBlobFiles)}`);
    console.info(`Removed index rows: ${String(summary.removedIndexRows)}`);
    console.info(`Rewritten indexes: ${String(summary.rewrittenIndexes)}`);
    return;
  }

  printHelp(args.helpTopic);
}

function getSortedRunSnapshots(
  runner: ReturnType<typeof createRunner>,
): RunSnapshot[] {
  return runner
    .getRuns()
    .toSorted((a, b) => getRunStartTime(a) - getRunStartTime(b))
    .map((manifest) => runner.getRun(manifest.id))
    .filter((run): run is RunSnapshot => run !== undefined);
}

function buildRunFileIndex(
  workspaceRoot: string,
  run: RunSnapshot,
): RunFileIndex {
  const runDir = join(workspaceRoot, '.agent-evals', 'runs', run.manifest.id);
  const caseIdCounts = new Map<string, number>();
  for (const caseRow of run.cases) {
    caseIdCounts.set(
      caseRow.caseId,
      (caseIdCounts.get(caseRow.caseId) ?? 0) + 1,
    );
  }
  const seenCaseIds = new Set<string>();
  return {
    id: run.manifest.id,
    shortId: run.manifest.shortId,
    status: run.manifest.status,
    temporary: run.manifest.temporary,
    startedAt: run.manifest.startedAt,
    endedAt: run.manifest.endedAt,
    target: run.manifest.target,
    summary: run.summary,
    files: {
      dir: runDir,
      run: join(runDir, 'run.json'),
      summary: join(runDir, 'summary.json'),
      cases: join(runDir, 'cases.jsonl'),
      caseDetailsDir: join(runDir, 'case-details'),
      tracesDir: join(runDir, 'traces'),
    },
    cases: run.cases.map((caseRow) => {
      const duplicateCaseIdCount = caseIdCounts.get(caseRow.caseId) ?? 0;
      const hasPreviousCaseWithId = seenCaseIds.has(caseRow.caseId);
      const fileId =
        duplicateCaseIdCount > 1 && hasPreviousCaseWithId
          ? (caseRow.caseKey ?? caseRow.caseId)
          : caseRow.caseId;
      seenCaseIds.add(caseRow.caseId);
      const fileName = `${encodeURIComponent(fileId)}.json`;
      return {
        caseId: caseRow.caseId,
        caseKey: caseRow.caseKey,
        evalId: caseRow.evalId,
        evalKey: caseRow.evalKey,
        status: caseRow.status,
        files: {
          caseDetail: join(runDir, 'case-details', fileName),
          trace: join(runDir, 'traces', fileName),
        },
      };
    }),
  };
}

function resolveRunSnapshot(
  runner: ReturnType<typeof createRunner>,
  runRef: string | undefined,
): RunSnapshot | undefined {
  const runs = getSortedRunSnapshots(runner);
  if (runs.length === 0) return undefined;

  if (runRef === undefined || runRef === 'latest') {
    return runs[runs.length - 1];
  }

  return runs.find(
    (run) => run.manifest.id === runRef || run.manifest.shortId === runRef,
  );
}

function printMissingRun(runRef: string | undefined): void {
  console.error(
    runRef === undefined
      ? 'No saved runs found.'
      : `No saved run found for "${runRef}".`,
  );
}

function getRunStartTime(manifest: RunManifest): number {
  const parsed = new Date(manifest.startedAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function printJson(value: unknown): void {
  console.info(JSON.stringify(value, null, 2));
}

function printRunFileIndexes(indexes: RunFileIndex[]): void {
  if (indexes.length === 0) {
    console.info('No saved runs.');
    return;
  }

  console.info(`Saved runs (${String(indexes.length)}):\n`);
  for (const index of indexes) {
    printRunFileIndex(index);
    console.info('');
  }
}

function printRunFileIndex(index: RunFileIndex): void {
  console.info(
    `${index.shortId} (${index.id})  ${index.status}${index.temporary ? '  temporary' : ''}  ${formatCaseCounts(index.summary)}`,
  );
  console.info(`  dir: ${index.files.dir}`);
  console.info(`  run: ${index.files.run}`);
  console.info(`  summary: ${index.files.summary}`);
  console.info(`  cases: ${index.files.cases}`);
  console.info(`  case details: ${index.files.caseDetailsDir}`);
  console.info(`  traces: ${index.files.tracesDir}`);
  if (index.cases.length === 0) return;

  console.info('  case files:');
  for (const caseEntry of index.cases) {
    console.info(
      `    ${caseEntry.caseId} [${caseEntry.evalId}] ${caseEntry.status}`,
    );
    console.info(`      detail: ${caseEntry.files.caseDetail}`);
    console.info(`      trace: ${caseEntry.files.trace}`);
  }
}

function formatCaseCounts(summary: RunSummary): string {
  return [
    `${String(summary.totalCases)} total`,
    `${String(summary.passedCases)} passed`,
    `${String(summary.failedCases)} failed`,
    `${String(summary.errorCases)} errors`,
    `${String(summary.cancelledCases)} cancelled`,
  ].join(', ');
}

async function waitForRunCompletion(
  runner: ReturnType<typeof createRunner>,
  runId: string,
): Promise<void> {
  return new Promise((resolvePromise) => {
    const check = () => {
      const run = runner.getRun(runId);
      if (
        !run ||
        run.manifest.status === 'completed' ||
        run.manifest.status === 'cancelled' ||
        run.manifest.status === 'error'
      ) {
        resolvePromise();
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}
