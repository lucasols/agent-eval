import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { AgentEvalsConfig } from '@agent-evals/shared';

const defaultConfig: AgentEvalsConfig = {
  include: ['**/*.eval.ts'],
  localStateDir: '.agent-evals',
  recordedCacheDir: 'evals/recordings',
  defaultCacheMode: 'local',
  defaultTrials: 1,
  concurrency: 2,
};

export async function loadConfig(): Promise<AgentEvalsConfig> {
  const cwd = process.cwd();
  const configPath = resolve(cwd, 'agent-evals.config.ts');

  if (!existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const configModule = await import(pathToFileURL(configPath).href) as { default?: AgentEvalsConfig; config?: AgentEvalsConfig };
    const userConfig = configModule.default ?? configModule.config;

    if (!userConfig) {
      return defaultConfig;
    }

    return {
      ...defaultConfig,
      ...userConfig,
    };
  } catch (error) {
    console.error('Failed to load agent-evals.config.ts:', error);
    return defaultConfig;
  }
}
