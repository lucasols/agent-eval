import { resolve } from 'node:path';
import type { ConfigReloadState, SseEnvelope } from '@agent-evals/shared';
import { watch, type FSWatcher } from 'chokidar';

type ConfigReloadControllerOptions = {
  getActiveRunCount: () => number;
  closeRunnerWatchers: () => Promise<void>;
  loadRunnerState: () => Promise<void>;
  emitToDiscoveryListeners: (event: SseEnvelope) => void;
};

/** Coordinates idle-only reloads for `agent-evals.config.ts` in app mode. */
export function createConfigReloadController({
  getActiveRunCount,
  closeRunnerWatchers,
  loadRunnerState,
  emitToDiscoveryListeners,
}: ConfigReloadControllerOptions) {
  let watcher: FSWatcher | undefined;
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  let reloadPromise: Promise<void> | undefined;
  let state: ConfigReloadState = {
    status: 'idle',
    activeRunCount: 0,
    lastChangedAt: null,
    lastReloadedAt: null,
  };

  function currentState(): ConfigReloadState {
    return { ...state, activeRunCount: getActiveRunCount() };
  }

  function emitReloadEvent(): void {
    emitToDiscoveryListeners({
      type: 'config.reload',
      timestamp: new Date().toISOString(),
      payload: currentState(),
    });
  }

  function setState(
    patch: Partial<Omit<ConfigReloadState, 'activeRunCount'>>,
  ): void {
    state = { ...state, ...patch, activeRunCount: getActiveRunCount() };
    emitReloadEvent();
  }

  async function close(): Promise<void> {
    if (reloadTimer !== undefined) {
      clearTimeout(reloadTimer);
      reloadTimer = undefined;
    }
    const watcherToClose = watcher;
    watcher = undefined;
    if (watcherToClose !== undefined) await watcherToClose.close();
  }

  async function reloadConfigNow(changedAt: string): Promise<void> {
    setState({ status: 'reloading', lastChangedAt: changedAt });
    await close();
    await closeRunnerWatchers();
    await loadRunnerState();
    setState({
      status: 'idle',
      lastChangedAt: changedAt,
      lastReloadedAt: new Date().toISOString(),
    });
  }

  async function reloadConfig(changedAt: string): Promise<void> {
    if (reloadPromise !== undefined) {
      setState({ status: 'pending', lastChangedAt: changedAt });
      await reloadPromise;
      await reloadIfPendingAndIdle();
      return;
    }

    reloadPromise = reloadConfigNow(changedAt);
    try {
      await reloadPromise;
    } finally {
      reloadPromise = undefined;
    }
  }

  async function handleConfigChanged(): Promise<void> {
    const changedAt = new Date().toISOString();
    if (getActiveRunCount() > 0) {
      setState({ status: 'pending', lastChangedAt: changedAt });
      return;
    }

    await reloadConfig(changedAt);
  }

  async function reloadIfPendingAndIdle(): Promise<void> {
    if (state.status !== 'pending') return;
    if (getActiveRunCount() > 0) {
      state = currentState();
      return;
    }
    await reloadConfig(state.lastChangedAt ?? new Date().toISOString());
  }

  async function setupWatcher(): Promise<void> {
    const nextWatcher = watch(resolve(process.cwd(), 'agent-evals.config.ts'), {
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
      ignoreInitial: true,
      persistent: true,
    });
    watcher = nextWatcher;

    const scheduleReload = () => {
      if (reloadTimer !== undefined) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        void handleConfigChanged();
      }, 50);
    };

    nextWatcher.on('change', scheduleReload);
    nextWatcher.on('add', scheduleReload);
    nextWatcher.on('unlink', scheduleReload);

    await new Promise<void>((ready) => {
      nextWatcher.once('ready', ready);
    });
  }

  return { close, currentState, reloadIfPendingAndIdle, setupWatcher };
}
