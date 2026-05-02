import {
  configReloadStateSchema,
  DEFAULT_API_CALLS_CONFIG,
  DEFAULT_LLM_CALLS_CONFIG,
  type ConfigReloadState,
  type ResolvedApiCallsConfig,
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
    cacheCreationInputTokens: z.string(),
    cacheCreationInput1hTokens: z.string(),
    reasoningTokens: z.string(),
    latencyMs: z.string(),
    steps: z.string(),
    finishReason: z.string(),
    input: z.string(),
    output: z.string(),
    reasoning: z.string(),
    toolCalls: z.string(),
  }),
  derivedAttributes: z.array(z.object({ path: z.string().optional() })),
  metrics: z.array(
    z.object({
      label: z.string(),
      tooltip: z.string().optional(),
      path: z.string(),
      format: z.enum(['string', 'number', 'duration', 'json', 'boolean']),
      numberFormat: z
        .object({
          notation: z.enum(['standard', 'compact']).optional(),
          compactDisplay: z.enum(['short', 'long']).optional(),
          prefix: z.string().optional(),
          suffix: z.string().optional(),
          minDecimalPlaces: z.number().int().min(0).optional(),
          maxDecimalPlaces: z.number().int().min(0).optional(),
        })
        .optional(),
      placements: z.array(z.enum(['header', 'body'])),
    }),
  ),
  pricing: z.array(
    z.object({
      model: z.string(),
      provider: z.string().optional(),
      inputUsdPerMillion: z.number().optional(),
      outputUsdPerMillion: z.number().optional(),
      cachedInputUsdPerMillion: z.number().optional(),
      cacheCreationInputUsdPerMillion: z.number().optional(),
      cacheCreationInput1hUsdPerMillion: z.number().optional(),
      reasoningUsdPerMillion: z.number().optional(),
    }),
  ),
});

const apiCallsConfigSchema: z.ZodType<ResolvedApiCallsConfig> = z.object({
  kinds: z.array(z.string()),
  attributes: z.object({
    method: z.string(),
    url: z.string(),
    statusCode: z.string(),
    request: z.string(),
    response: z.string(),
    requestBody: z.string(),
    responseBody: z.string(),
    headers: z.string(),
    durationMs: z.string(),
    error: z.string(),
  }),
  derivedAttributes: z.array(z.object({ path: z.string().optional() })),
  metrics: z.array(
    z.object({
      label: z.string(),
      tooltip: z.string().optional(),
      path: z.string(),
      format: z.enum(['string', 'number', 'duration', 'json', 'boolean']),
      numberFormat: z
        .object({
          notation: z.enum(['standard', 'compact']).optional(),
          compactDisplay: z.enum(['short', 'long']).optional(),
          prefix: z.string().optional(),
          suffix: z.string().optional(),
          minDecimalPlaces: z.number().int().min(0).optional(),
          maxDecimalPlaces: z.number().int().min(0).optional(),
        })
        .optional(),
      placements: z.array(z.enum(['header', 'body'])),
    }),
  ),
});

const workspaceInfoSchema = z.object({
  workspaceRoot: z.string(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
  llmCalls: llmCallsConfigSchema,
  apiCalls: apiCallsConfigSchema,
  configReload: configReloadStateSchema,
});

type WorkspaceConfigState = {
  workspaceRoot: string;
  packageManager: PackageManager;
  llmCalls: ResolvedLlmCallsConfig;
  apiCalls: ResolvedApiCallsConfig;
  configReload: ConfigReloadState;
  hasLoaded: boolean;
};

const DEFAULT_PACKAGE_MANAGER: PackageManager = 'pnpm';
const DEFAULT_CONFIG_RELOAD_STATE: ConfigReloadState = {
  status: 'idle',
  activeRunCount: 0,
  lastChangedAt: null,
  lastReloadedAt: null,
};

/**
 * Holds workspace-level configuration the UI fetches once on app boot from
 * `/api/workspace`: the detected package manager (used to render CLI command
 * snippets), plus the resolved LLM/API-call configs used by the case-run
 * drawer. Falls back to defaults until the fetch completes so the UI can
 * render before the network round-trip resolves.
 */
export const workspaceConfigStore = new Store<WorkspaceConfigState>({
  state: {
    workspaceRoot: '',
    packageManager: DEFAULT_PACKAGE_MANAGER,
    llmCalls: DEFAULT_LLM_CALLS_CONFIG,
    apiCalls: DEFAULT_API_CALLS_CONFIG,
    configReload: DEFAULT_CONFIG_RELOAD_STATE,
    hasLoaded: false,
  },
});

/** Update config-reload state from the app-wide event stream. */
export function setConfigReloadState(configReload: ConfigReloadState): void {
  workspaceConfigStore.setPartialState({ configReload });
}

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
    workspaceRoot: parseResult.value.workspaceRoot,
    packageManager: parseResult.value.packageManager,
    llmCalls: parseResult.value.llmCalls,
    apiCalls: parseResult.value.apiCalls,
    configReload: parseResult.value.configReload,
    hasLoaded: true,
  });
}
