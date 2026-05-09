import {
  DEFAULT_API_CALLS_CONFIG,
  DEFAULT_LLM_CALLS_CONFIG,
  type ConfigReloadState,
  type ResolvedApiCallsConfig,
  type ResolvedLlmCallsConfig,
} from '@agent-evals/shared';
import { createDocumentStore } from 'tsdf';
import { apiClient, getRpcResultUnwrap } from '#src/api/client';
import { dataStoreManager } from '#src/stores/dataStoreManager';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type WorkspaceConfig = {
  workspaceRoot: string;
  packageManager: PackageManager;
  llmCalls: ResolvedLlmCallsConfig;
  apiCalls: ResolvedApiCallsConfig;
  configReload: ConfigReloadState;
};

const DEFAULT_CONFIG_RELOAD_STATE: ConfigReloadState = {
  status: 'idle',
  activeRunCount: 0,
  lastChangedAt: null,
  lastReloadedAt: null,
};

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  workspaceRoot: '',
  packageManager: 'pnpm',
  llmCalls: DEFAULT_LLM_CALLS_CONFIG,
  apiCalls: DEFAULT_API_CALLS_CONFIG,
  configReload: DEFAULT_CONFIG_RELOAD_STATE,
};

export const workspaceConfigStore = createDocumentStore<WorkspaceConfig>({
  id: 'document-workspace-config',
  storeManager: dataStoreManager,
  usesRealTimeUpdates: true,
  fetchFn: async (signal) => {
    return getRpcResultUnwrap(
      apiClient.api.workspace.$get(undefined, { init: { signal } }),
    );
  },
});

export function getWorkspaceConfig(): WorkspaceConfig {
  return workspaceConfigStore.store.state.data ?? DEFAULT_WORKSPACE_CONFIG;
}

/** Update config-reload state from the app-wide event stream. */
export function setConfigReloadState(configReload: ConfigReloadState): void {
  const updated = workspaceConfigStore.updateState((draft) => {
    draft.configReload = configReload;
  });
  if (updated) return;

  workspaceConfigStore.store.setState({
    data: { ...DEFAULT_WORKSPACE_CONFIG, configReload },
    error: null,
    status: 'success',
    refetchOnMount: false,
  });
}
