import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { createRunner } from './runner.ts';

const createdWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdWorkspaces.map(async (workspacePath) => {
      await rm(workspacePath, { recursive: true, force: true });
    }),
  );
  createdWorkspaces.length = 0;
});

async function createReloadWorkspace(): Promise<{
  workspacePath: string;
  configPath: string;
  envPath: string;
  startedLogPath: string;
}> {
  const workspacePath = await mkdtemp(
    join(tmpdir(), 'agent-evals-runner-config-reload-'),
  );
  createdWorkspaces.push(workspacePath);

  await mkdir(join(workspacePath, 'evals'), { recursive: true });
  await mkdir(join(workspacePath, 'other'), { recursive: true });
  await mkdir(join(workspacePath, 'node_modules', '@agent-evals'), {
    recursive: true,
  });
  await symlink(
    join(dirname(fileURLToPath(import.meta.url)), '../../sdk'),
    join(workspacePath, 'node_modules', '@agent-evals', 'sdk'),
  );
  const configPath = join(workspacePath, 'agent-evals.config.ts');
  const envPath = join(workspacePath, '.env');
  const startedLogPath = join(workspacePath, 'run-started.txt');
  await writeConfig(configPath, 'evals/**/*.eval.ts');
  await writeFile(
    join(workspacePath, 'evals', 'active.eval.ts'),
    `import { appendFile } from 'node:fs/promises';
import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'active-config-eval',
  title: 'Active Config Eval',
  cases: [{ id: 'active-case', input: {} }],
  execute: async () => {
    await appendFile(${JSON.stringify(startedLogPath)}, 'started\\n');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  },
});
`,
  );
  await writeFile(
    join(workspacePath, 'evals', 'env.eval.ts'),
    `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'env-config-eval',
  title: 'Env Config Eval',
  cases: [{ id: 'env-case', input: {} }],
  columns: {
    queue: { label: 'Queue' },
  },
  execute: ({ setOutput }) => {
    setOutput('queue', process.env.AGENT_EVALS_CONFIG_RELOAD_TEST_QUEUE ?? 'missing');
  },
});
`,
  );
  await writeFile(
    join(workspacePath, 'other', 'next.eval.ts'),
    `import { defineEval } from '@agent-evals/sdk';

defineEval({
  id: 'next-config-eval',
  title: 'Next Config Eval',
});
`,
  );

  return { workspacePath, configPath, envPath, startedLogPath };
}

async function writeConfig(configPath: string, include: string): Promise<void> {
  await writeFile(
    configPath,
    `export default {
  include: ['${include}'],
};
`,
  );
}

describe('runner config reload watcher', () => {
  test('reloads .env changes while idle', async () => {
    const { workspacePath, envPath } = await createReloadWorkspace();
    const previousEnvValue = process.env.AGENT_EVALS_CONFIG_RELOAD_TEST_QUEUE;
    delete process.env.AGENT_EVALS_CONFIG_RELOAD_TEST_QUEUE;
    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const runner = createRunner({ watchForChanges: true });

    try {
      await writeFile(
        envPath,
        'AGENT_EVALS_CONFIG_RELOAD_TEST_QUEUE=priority-refunds\n',
      );
      await runner.init();

      const firstRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['env-config-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => runner.getRun(firstRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');
      expect(runner.getRun(firstRun.manifest.id)?.cases[0]?.columns.queue).toBe(
        'priority-refunds',
      );

      await writeFile(
        envPath,
        'AGENT_EVALS_CONFIG_RELOAD_TEST_QUEUE=priority-escalations\n',
      );

      await expect
        .poll(() => runner.getConfigReloadState().lastReloadedAt, {
          timeout: 10_000,
        })
        .not.toBeNull();

      const secondRun = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['env-config-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => runner.getRun(secondRun.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');
      expect(
        runner.getRun(secondRun.manifest.id)?.cases[0]?.columns.queue,
      ).toBe('priority-escalations');
      expect(runner.getConfigReloadState().status).toBe('idle');
    } finally {
      await runner.close();
      process.chdir(previousCwd);
      if (previousEnvValue === undefined) {
        delete process.env.AGENT_EVALS_CONFIG_RELOAD_TEST_QUEUE;
      } else {
        process.env.AGENT_EVALS_CONFIG_RELOAD_TEST_QUEUE = previousEnvValue;
      }
    }
  }, 15_000);

  test('reloads agent-evals.config.ts changes while idle', async () => {
    const { workspacePath, configPath } = await createReloadWorkspace();
    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const runner = createRunner({ watchForChanges: true });

    try {
      await runner.init();
      expect(runner.getEval('active-config-eval')?.title).toBe(
        'Active Config Eval',
      );
      expect(runner.getEval('next-config-eval')).toBeUndefined();

      await writeConfig(configPath, 'other/**/*.eval.ts');

      await expect
        .poll(() => runner.getConfigReloadState().lastReloadedAt, {
          timeout: 10_000,
        })
        .not.toBeNull();
      await expect
        .poll(() => runner.getEval('next-config-eval')?.title, {
          timeout: 10_000,
        })
        .toBe('Next Config Eval');
      expect(runner.getEval('active-config-eval')).toBeUndefined();
      expect(runner.getConfigReloadState().status).toBe('idle');
    } finally {
      await runner.close();
      process.chdir(previousCwd);
    }
  }, 15_000);

  test('defers config reload while a run is active', async () => {
    const { workspacePath, configPath, startedLogPath } =
      await createReloadWorkspace();
    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const runner = createRunner({ watchForChanges: true });

    try {
      await runner.init();
      const run = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['active-config-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => existsSync(startedLogPath), { timeout: 10_000 })
        .toBe(true);

      await writeConfig(configPath, 'other/**/*.eval.ts');

      await expect
        .poll(() => runner.getConfigReloadState().status, { timeout: 10_000 })
        .toBe('pending');
      expect(runner.getConfigReloadState().activeRunCount).toBe(1);

      await expect
        .poll(() => runner.getRun(run.manifest.id)?.manifest.status, {
          timeout: 10_000,
        })
        .toBe('completed');
      await expect
        .poll(() => runner.getConfigReloadState().status, { timeout: 10_000 })
        .toBe('idle');
      expect(runner.getConfigReloadState().lastReloadedAt).not.toBeNull();
      expect(runner.getEval('next-config-eval')?.title).toBe(
        'Next Config Eval',
      );
    } finally {
      await runner.close();
      process.chdir(previousCwd);
    }
  }, 15_000);

  test('applies pending config reload after cancellation makes the runner idle', async () => {
    const { workspacePath, configPath, startedLogPath } =
      await createReloadWorkspace();
    const previousCwd = process.cwd();
    process.chdir(workspacePath);
    const runner = createRunner({ watchForChanges: true });

    try {
      await runner.init();
      const run = await runner.startRun({
        target: { mode: 'evalIds', evalIds: ['active-config-eval'] },
        trials: 1,
      });
      await expect
        .poll(() => existsSync(startedLogPath), { timeout: 10_000 })
        .toBe(true);

      await writeConfig(configPath, 'other/**/*.eval.ts');

      await expect
        .poll(() => runner.getConfigReloadState().status, { timeout: 10_000 })
        .toBe('pending');

      await runner.cancelRun(run.manifest.id);

      await expect
        .poll(() => runner.getConfigReloadState().status, { timeout: 10_000 })
        .toBe('idle');
      expect(runner.getEval('next-config-eval')?.title).toBe(
        'Next Config Eval',
      );
    } finally {
      await runner.close();
      process.chdir(previousCwd);
    }
  }, 15_000);
});
