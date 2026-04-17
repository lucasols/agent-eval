import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  caseRowSchema,
  runManifestSchema,
  runSummarySchema,
  traceSpanSchema,
} from '@agent-evals/shared';
import { z } from 'zod/v4';

const currentDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(currentDir, '../../..');
const exampleSourceWorkspace = resolve(repoRoot, 'examples/basic-agent');
const exampleNodeModulesPath = resolve(exampleSourceWorkspace, 'node_modules');
const cliBinPath = resolve(repoRoot, 'packages/cli/src/bin.ts');
const tempWorkspaceRoot = resolve(tmpdir(), 'agent-evals-cli-e2e');

const traceCollectionSchema = z.array(traceSpanSchema);

export type CommandResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

export async function withIsolatedExampleWorkspace<T>(
  fn: (workspacePath: string) => Promise<T>,
): Promise<T> {
  await mkdir(tempWorkspaceRoot, { recursive: true });
  const workspacePath = resolve(
    tempWorkspaceRoot,
    `workspace-${Math.random().toString(36).slice(2, 10)}`,
  );

  await cp(exampleSourceWorkspace, workspacePath, { recursive: true });
  await rm(resolve(workspacePath, 'node_modules'), {
    force: true,
    recursive: true,
  });
  await symlink(exampleNodeModulesPath, resolve(workspacePath, 'node_modules'));
  await rm(resolve(workspacePath, '.agent-evals'), {
    force: true,
    recursive: true,
  });

  try {
    return await fn(workspacePath);
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

export async function runExampleCli(
  workspacePath: string,
  args: string[],
): Promise<CommandResult> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' };
  delete childEnv.VITEST;
  delete childEnv.VITEST_MODE;
  delete childEnv.VITEST_POOL_ID;
  delete childEnv.VITEST_WORKER_ID;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliBinPath, ...args], {
      cwd: workspacePath,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('close', (exitCode) => {
      resolvePromise({
        exitCode,
        stderr: stderr.trimEnd(),
        stdout: stdout.trimEnd(),
      });
    });
    child.on('error', (error) => {
      rejectPromise(error);
    });
  });
}

export async function readSingleRunArtifacts(workspacePath: string): Promise<{
  cases: ReturnType<typeof caseRowSchema.parse>[];
  manifest: ReturnType<typeof runManifestSchema.parse>;
  summary: ReturnType<typeof runSummarySchema.parse>;
  traceFiles: string[];
  traces: Record<string, ReturnType<typeof traceCollectionSchema.parse>>;
}> {
  const runsPath = resolve(workspacePath, '.agent-evals/runs');
  const runDirectories = (await readdir(runsPath)).sort();
  const [runDirectory] = runDirectories;
  if (runDirectories.length !== 1 || runDirectory === undefined) {
    throw new Error(`Expected exactly one run directory, got ${runDirectories.length}`);
  }

  const runPath = resolve(runsPath, runDirectory);
  const summary = await readJsonFile(runSummarySchema, resolve(runPath, 'summary.json'));
  const manifest = await readJsonFile(runManifestSchema, resolve(runPath, 'run.json'));

  const casesText = await readFile(resolve(runPath, 'cases.jsonl'), 'utf8');
  const cases = casesText
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJson(caseRowSchema, line));

  const traceDirectoryPath = resolve(runPath, 'traces');
  const traceFiles = (await readdir(traceDirectoryPath)).sort();
  const traces = Object.fromEntries(
    await Promise.all(
      traceFiles.map(async (traceFileName) => {
        const trace = await readJsonFile(
          traceCollectionSchema,
          resolve(traceDirectoryPath, traceFileName),
        );
        return [traceFileName, trace] as const;
      }),
    ),
  );

  return {
    cases,
    manifest,
    summary,
    traceFiles,
    traces,
  };
}

export function normalizeTextSnapshot(
  workspacePath: string,
  text: string,
): string {
  return normalizeDynamicString(workspacePath, text).replace(
    /Duration: \d+\.\d+s/g,
    'Duration: <duration>',
  );
}

export function normalizeSnapshotValue(
  workspacePath: string,
  value: unknown,
  key: string | undefined = undefined,
): unknown {
  if (typeof value === 'string') {
    return normalizeDynamicString(workspacePath, value);
  }

  if (
    typeof value === 'number' &&
    (key === 'latencyMs' || key === 'totalDurationMs' || key === 'port')
  ) {
    return `<${key}>`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeSnapshotValue(workspacePath, item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeSnapshotValue(workspacePath, entryValue, entryKey),
      ]),
    );
  }

  return value;
}

export function summarizeTrace(
  trace: ReturnType<typeof traceCollectionSchema.parse>,
): Array<Record<string, unknown>> {
  return trace.map((span) => ({
    kind: span.kind,
    name: span.name,
    parentId: span.parentId,
    input: span.attributes?.input,
    output: span.attributes?.output,
    model: span.attributes?.model,
    usage: span.attributes?.usage,
    display: span.attributes?.__display,
    value: span.attributes?.value,
  }));
}

function parseJson<T>(
  schema: { parse(value: unknown): T },
  text: string,
): T {
  const parsed: unknown = JSON.parse(text);
  return schema.parse(parsed);
}

async function readJsonFile<T>(
  schema: { parse(value: unknown): T },
  filePath: string,
): Promise<T> {
  const text = await readFile(filePath, 'utf8');
  return parseJson(schema, text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeDynamicString(workspacePath: string, value: string): string {
  return value
    .replaceAll('\u00A0', ' ')
    .replaceAll(`/private${workspacePath}`, '<workspace>')
    .replaceAll(workspacePath, '<workspace>')
    .replaceAll(repoRoot, '<repo>')
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_[a-z0-9]+/g,
      '<run-id>',
    )
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<timestamp>')
    .replace(/span_\d+_\d+/g, '<span-id>')
    .replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:<port>')
    .replace(/http:\/\/localhost:\d+/g, 'http://localhost:<port>');
}
