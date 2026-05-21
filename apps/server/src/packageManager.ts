import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resultify } from 't-result';
import { z } from 'zod';

const packageJsonSchema = z.object({ packageManager: z.string().optional() });
const packageManagerNameSeparatorRegex = /[ @/]/;

export type WorkspacePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

function normalizePackageManager(
  value: string | undefined,
): WorkspacePackageManager | undefined {
  if (!value) return undefined;
  const name = value.split(packageManagerNameSeparatorRegex)[0];
  if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
    return name;
  }
  return undefined;
}

async function readPackageManagerField(
  workspaceRoot: string,
): Promise<WorkspacePackageManager | undefined> {
  const packageJson = await resultify(() =>
    readFile(join(workspaceRoot, 'package.json'), 'utf8'),
  );
  if (packageJson.error) return undefined;

  const parsedJson = resultify((): unknown => JSON.parse(packageJson.value));
  if (parsedJson.error) return undefined;

  const parsedPackage = resultify(() =>
    packageJsonSchema.parse(parsedJson.value),
  );
  if (parsedPackage.error) return undefined;

  return normalizePackageManager(parsedPackage.value.packageManager);
}

function detectFromLockfile(
  workspaceRoot: string,
): WorkspacePackageManager | undefined {
  if (existsSync(join(workspaceRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(workspaceRoot, 'yarn.lock'))) return 'yarn';
  if (
    existsSync(join(workspaceRoot, 'bun.lock')) ||
    existsSync(join(workspaceRoot, 'bun.lockb'))
  ) {
    return 'bun';
  }
  if (existsSync(join(workspaceRoot, 'package-lock.json'))) return 'npm';
  return undefined;
}

/** Detect the package manager users should use when running workspace CLI commands. */
export async function detectWorkspacePackageManager(
  workspaceRoot: string,
): Promise<WorkspacePackageManager> {
  return (
    (await readPackageManagerField(workspaceRoot)) ??
    detectFromLockfile(workspaceRoot) ??
    normalizePackageManager(process.env.npm_config_user_agent) ??
    'pnpm'
  );
}
