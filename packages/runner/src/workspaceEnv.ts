import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { resultify } from 't-result';

const shellEnvKeys = new Set(Object.keys(process.env));
const appliedWorkspaceEnvValues = new Map<string, string>();

export type WorkspaceEnvLoadResult = { error: null } | { error: string };

export async function loadWorkspaceEnv(
  workspaceRoot: string,
): Promise<WorkspaceEnvLoadResult> {
  const envPath = resolve(workspaceRoot, '.env');
  if (!existsSync(envPath)) {
    applyWorkspaceEnv(new Map());
    return { error: null };
  }

  const readResult = await resultify(() => readFile(envPath, 'utf-8'));
  if (readResult.error) {
    return {
      error: `Failed to read .env at ${envPath}: ${readResult.error.message}`,
    };
  }

  const parseResult = resultify(() => parseEnv(readResult.value));
  if (parseResult.error) {
    return {
      error: `Failed to parse .env at ${envPath}: ${parseResult.error.message}`,
    };
  }

  applyWorkspaceEnv(new Map(getEnvEntries(parseResult.value)));
  return { error: null };
}

function getEnvEntries(env: NodeJS.Dict<string>): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) entries.push([key, value]);
  }
  return entries;
}

function applyWorkspaceEnv(nextValues: Map<string, string>): void {
  for (const [key, previousValue] of appliedWorkspaceEnvValues) {
    if (nextValues.has(key)) continue;
    if (process.env[key] === previousValue) {
      delete process.env[key];
    }
    appliedWorkspaceEnvValues.delete(key);
  }

  for (const [key, value] of nextValues) {
    if (shellEnvKeys.has(key)) continue;
    process.env[key] = value;
    appliedWorkspaceEnvValues.set(key, value);
  }
}
