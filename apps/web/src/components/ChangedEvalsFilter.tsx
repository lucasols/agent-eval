import type { ChangedEvals } from '@agent-evals/shared';
import { GitPullRequest } from 'lucide-react';
import { FilterTrigger, FilterTriggerCount } from '#src/components/TagFilter';
import { Tooltip } from '#src/components/Tooltip';
import { toggleChangedEvalsFilter } from '#src/stores/selectionStore';

type ChangedEvalsFilterProps = {
  changedEvals: Extract<ChangedEvals, { available: true }>;
  active: boolean;
};

/**
 * Toggle chip that keeps only evals whose file changed on the current branch
 * versus its base ref (usually the current pull request's base branch).
 */
export function ChangedEvalsFilter({
  changedEvals,
  active,
}: ChangedEvalsFilterProps) {
  const count = changedEvals.evalKeys.length;
  const fromPullRequest = changedEvals.baseRefSource === 'pullRequest';
  const source = fromPullRequest
    ? 'the pull request base'
    : 'cache.branchPruneBaseRef';

  return (
    <Tooltip
      content={`Evals whose file changed since ${changedEvals.baseRef} (${source}), including uncommitted changes`}
    >
      <FilterTrigger
        type="button"
        active={active}
        aria-pressed={active}
        onClick={toggleChangedEvalsFilter}
      >
        <GitPullRequest aria-hidden="true" />
        <FilterTriggerCount>{count}</FilterTriggerCount>
        {fromPullRequest ? 'Changed in PR' : 'Changed on branch'}
      </FilterTrigger>
    </Tooltip>
  );
}
