import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { evalSummarySchema } from '@agent-evals/shared';
import { resultify } from 't-result';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { repoRoot, withIsolatedExampleWorkspace } from './cliTestUtils.ts';

const cliBinPath = resolve(repoRoot, 'packages/cli/src/bin.ts');
const evalSummariesSchema = z.array(evalSummarySchema);

test('app keeps loaded eval metadata for unchanged files after watcher refreshes', async () => {
  await withIsolatedExampleWorkspace(async (workspacePath) => {
    const port = await getFreePort();
    const app = startApp(workspacePath, port);

    try {
      const baseline = await waitForTagCounts(
        port,
        (counts) => Object.keys(counts).length > 0,
      );
      expect(baseline).toMatchInlineSnapshot(`
        {
          "example": 23,
          "manual": 1,
          "playground": 5,
          "refunds": 3,
          "slow": 1,
        }
      `);

      const evalFilePath = resolve(
        workspacePath,
        'evals/refund-workflow.eval.ts',
      );
      const originalSource = await readFile(evalFilePath, 'utf8');
      await writeFile(
        evalFilePath,
        originalSource.replace(
          "tags: ['refunds'],",
          "tags: ['refunds', 'edited'],",
        ),
      );

      // Only the edited file re-imports; every other eval must keep its tags.
      expect(
        await waitForTagCounts(port, (counts) => counts.edited === 1),
      ).toEqual({ ...baseline, edited: 1 });

      // Reverting reuses an already-imported source fingerprint.
      await writeFile(evalFilePath, originalSource);
      expect(
        await waitForTagCounts(port, (counts) => counts.edited === undefined),
      ).toEqual(baseline);
    } finally {
      app.kill();
    }
  });
}, 60_000);

test('app keeps discovered metadata for other evals after a run finishes', async () => {
  await withIsolatedExampleWorkspace(async (workspacePath) => {
    const port = await getFreePort();
    const app = startApp(workspacePath, port);

    try {
      const baseline = await waitForTagCounts(
        port,
        (counts) => Object.keys(counts).length > 0,
      );

      const created = runCreatedSchema.parse(
        await (
          await fetch(`http://localhost:${String(port)}/api/runs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              target: {
                mode: 'evalIds',
                evalKeys: [
                  'evals%2Fsupport%2Frefunds%2Fescalations%2Fhigh-value-refund.eval.ts#high-value-refund',
                ],
              },
              trials: 1,
            }),
          })
        ).json(),
      );
      await expect
        .poll(() => fetchRunStatus(port, created.manifest.id), {
          timeout: 30_000,
          interval: 250,
        })
        .toBe('completed');

      // The run child only prepares the targeted eval; its placeholders for
      // every other eval must not overwrite the app's discovered metadata.
      expect(await fetchTagCounts(port)).toEqual(baseline);
    } finally {
      app.kill();
    }
  });
}, 60_000);

const runCreatedSchema = z.object({ manifest: z.object({ id: z.string() }) });

async function fetchRunStatus(
  port: number,
  runId: string,
): Promise<string | null> {
  const response = await fetch(
    `http://localhost:${String(port)}/api/runs/${encodeURIComponent(runId)}`,
  );
  if (!response.ok) return null;
  return runCreatedSchema
    .extend({ manifest: z.object({ id: z.string(), status: z.string() }) })
    .parse(await response.json()).manifest.status;
}

function startApp(workspacePath: string, port: number): ChildProcess {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' };
  delete childEnv.VITEST;
  delete childEnv.VITEST_MODE;
  delete childEnv.VITEST_POOL_ID;
  delete childEnv.VITEST_WORKER_ID;

  return spawn(process.execPath, [cliBinPath, 'app', '--port', String(port)], {
    cwd: workspacePath,
    env: childEnv,
    stdio: 'ignore',
  });
}

async function waitForTagCounts(
  port: number,
  isReady: (counts: Record<string, number>) => boolean,
): Promise<Record<string, number>> {
  let lastCounts: Record<string, number> = {};
  await expect
    .poll(
      async () => {
        const counts = await fetchTagCounts(port);
        if (counts !== null) lastCounts = counts;
        return counts !== null && isReady(counts);
      },
      { timeout: 30_000, interval: 250 },
    )
    .toBe(true);
  return lastCounts;
}

async function fetchTagCounts(
  port: number,
): Promise<Record<string, number> | null> {
  const response = await resultify(() =>
    fetch(`http://localhost:${String(port)}/api/evals`, {
      signal: AbortSignal.timeout(2_000),
    }),
  );
  // The app is still starting while the port refuses connections.
  if (response.error || !response.value.ok) return null;

  const evals = evalSummariesSchema.parse(await response.value.json());
  const counts: Record<string, number> = {};
  for (const tag of evals.flatMap((evalSummary) => evalSummary.tags ?? [])) {
    counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') {
          rejectPort(new Error('Could not allocate a free port'));
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}
