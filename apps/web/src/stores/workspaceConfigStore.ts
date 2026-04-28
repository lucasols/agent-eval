import {
  DEFAULT_LLM_CALLS_CONFIG,
  type ResolvedLlmCallsConfig,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { Store } from 't-state';
import { z } from 'zod/v4';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const llmCallsConfigSchema: z.ZodType<ResolvedLlmCallsConfig> = z.object({
  kinds: z.array(z.string()),
  attributes: z.object({
    model: z.string(),
    provider: z.string(),
    inputTokens: z.string(),
    outputTokens: z.string(),
    cachedInputTokens: z.string(),
    reasoningTokens: z.string(),
    totalTokens: z.string(),
    cost: z.string(),
    steps: z.string(),
    finishReason: z.string(),
    input: z.string(),
    output: z.string(),
    reasoning: z.string(),
    toolCalls: z.string(),
  }),
  metrics: z.array(
    z.object({
      label: z.string(),
      path: z.string(),
      format: z.enum(['string', 'number', 'duration', 'json', 'boolean']),
      numberFormat: z
        .object({
          notation: z.enum(['standard', 'compact']).optional(),
          compactDisplay: z.enum(['short', 'long']).optional(),
          prefix: z.string().optional(),
          suffix: z.string().optional(),
          decimalPlaces: z.number().int().min(0).optional(),
        })
        .optional(),
      placements: z.array(z.enum(['header', 'body'])),
    }),
  ),
});

const workspaceInfoSchema = z.object({
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
  llmCalls: llmCallsConfigSchema,
});

type WorkspaceConfigState = {
  packageManager: PackageManager;
  llmCalls: ResolvedLlmCallsConfig;
  hasLoaded: boolean;
};

const DEFAULT_PACKAGE_MANAGER: PackageManager = 'pnpm';

/**
 * Holds workspace-level configuration the UI fetches once on app boot from
 * `/api/workspace`: the detected package manager (used to render CLI command
 * snippets) and the resolved LLM-calls config used by the LLM calls tab in the
 * case-run drawer. Falls back to defaults until the fetch completes so the UI
 * can render before the network round-trip resolves.
 */
export const workspaceConfigStore = new Store<WorkspaceConfigState>({
  state: {
    packageManager: DEFAULT_PACKAGE_MANAGER,
    llmCalls: DEFAULT_LLM_CALLS_CONFIG,
    hasLoaded: false,
  },
});

/**
 * Fetch `/api/workspace` and update {@link workspaceConfigStore} with the
 * resolved values. Any network or parse failure falls back to defaults so the
 * UI keeps working when the server is briefly unreachable.
 */
export async function fetchWorkspaceConfig(): Promise<void> {
  const fetchResult = await resultify(() => fetch('/api/workspace'));
  if (fetchResult.error || !fetchResult.value.ok) {
    workspaceConfigStore.setPartialState({ hasLoaded: true });
    return;
  }

  const jsonResult = await resultify(() => fetchResult.value.json());
  if (jsonResult.error) {
    workspaceConfigStore.setPartialState({ hasLoaded: true });
    return;
  }

  const parseResult = resultify(() =>
    workspaceInfoSchema.parse(jsonResult.value),
  );
  if (parseResult.error) {
    workspaceConfigStore.setPartialState({ hasLoaded: true });
    return;
  }

  workspaceConfigStore.setState({
    packageManager: parseResult.value.packageManager,
    llmCalls: parseResult.value.llmCalls,
    hasLoaded: true,
  });
}
