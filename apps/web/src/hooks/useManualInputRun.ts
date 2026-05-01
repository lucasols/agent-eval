import type { CacheMode, EvalSummary } from '@agent-evals/shared';
import { useState } from 'react';
import {
  startRun,
  type ManualInputStartRunFailure,
} from '#src/stores/runStore';

type SupportedCacheMode = Extract<CacheMode, 'use' | 'bypass' | 'refresh'>;

/**
 * Hook owning a single eval's manual-input modal state plus the submission
 * pipeline. Returns:
 *
 * - `isOpen` / `isSubmitting` flags for the modal renderer.
 * - `serverFailure` from the most recent rejected submission.
 * - `open(cacheMode)` to open the modal preconfigured for one cache mode.
 * - `submit(values)` to POST the run and close on success.
 * - `cancel()` to dismiss the modal and clear failures.
 */
export function useManualInputRun(evalSummary: EvalSummary) {
  const [activeCacheMode, setActiveCacheMode] =
    useState<SupportedCacheMode | null>(null);
  const [serverFailure, setServerFailure] = useState<
    ManualInputStartRunFailure | undefined
  >(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function open(cacheMode: SupportedCacheMode): void {
    setServerFailure(undefined);
    setActiveCacheMode(cacheMode);
  }

  function cancel(): void {
    setActiveCacheMode(null);
    setServerFailure(undefined);
    setIsSubmitting(false);
  }

  async function submit(values: Record<string, unknown>): Promise<void> {
    if (activeCacheMode === null) return;
    setIsSubmitting(true);
    const result = await startRun(
      { mode: 'evalIds', evalKeys: [evalSummary.key] },
      {
        cacheMode: activeCacheMode,
        manualInputs: { [evalSummary.key]: values },
      },
    );
    setIsSubmitting(false);
    if (result.status === 'started') {
      cancel();
      return;
    }
    if (result.status === 'manual-input-error') {
      setServerFailure(
        result.failures.find((entry) => entry.evalKey === evalSummary.key),
      );
      return;
    }
    if (result.status === 'error') {
      setServerFailure({
        evalKey: evalSummary.key,
        evalId: evalSummary.id,
        reason: 'invalid',
        issues: [{ path: '', message: result.message }],
      });
    }
  }

  return {
    isOpen: activeCacheMode !== null,
    isSubmitting,
    serverFailure,
    open,
    cancel,
    submit,
  };
}
