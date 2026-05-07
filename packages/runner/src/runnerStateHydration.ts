import type { RunnerRunState } from './runChildManager.ts';
import type { PersistedRunSnapshot } from './runPersistence.ts';

/** Rehydrate a persisted run while preserving live listeners/process handles. */
export function toRunnerRunState(
  snapshot: PersistedRunSnapshot,
  existing?: RunnerRunState,
): RunnerRunState {
  return {
    ...snapshot,
    listeners: existing?.listeners ?? new Set(),
    childProcess: existing?.childProcess,
    childTerminalReceived: existing?.childTerminalReceived ?? false,
  };
}
