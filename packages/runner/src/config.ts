import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { agentEvalsConfigSchema, type AgentEvalsConfig } from '@agent-evals/shared';
import { z } from 'zod/v4';

const configModuleSchema = z.object({
  default: agentEvalsConfigSchema.optional(),
  config: agentEvalsConfigSchema.optional(),
});

const defaultConfig: AgentEvalsConfig = {
  include: ['**/*.eval.ts'],
  defaultTrials: 1,
  concurrency: 2,
  traceDisplay: {
    attributes: [
      { path: 'input', label: 'Input', format: 'json', placements: ['section'] },
      { path: 'output', label: 'Output', format: 'json', placements: ['section'] },
    ],
  },
};

export async function loadConfig(): Promise<AgentEvalsConfig> {
  const cwd = process.cwd();
  const configPath = resolve(cwd, 'agent-evals.config.ts');

  if (!existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const imported: unknown = await import(pathToFileURL(configPath).href);
    const configModule = configModuleSchema.parse(imported);
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
