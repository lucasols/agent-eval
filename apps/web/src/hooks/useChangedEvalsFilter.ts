import { useMemo } from 'react';
import { changedEvalsStore } from '#src/stores/evalsStore';
import { selectionStore } from '#src/stores/selectionStore';

/**
 * Read the "changed in PR" eval filter. `filterKeys` is the set of changed
 * eval keys while the filter is active and changed evals are available, else
 * `null` (no filtering), so an unresolvable base branch never hides evals.
 */
export function useChangedEvalsFilter() {
  const { changedOnly } = selectionStore.useSelectorRC((s) => ({
    changedOnly: s.changedOnly,
  }));
  const changedEvalsResult = changedEvalsStore.useDocument();
  const changedEvals =
    changedEvalsResult.data?.available === true
      ? changedEvalsResult.data
      : null;
  const changedEvalKeys = useMemo(
    () => (changedEvals === null ? null : new Set(changedEvals.evalKeys)),
    [changedEvals],
  );

  return {
    changedOnly,
    changedEvals,
    filterKeys: changedOnly ? changedEvalKeys : null,
  };
}
