import type { ColumnDef } from '@agent-evals/shared';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { styled } from 'vindur';
import { EvalRunsTable } from '#src/components/EvalRunsTable';
import { IconButton } from '#src/components/IconButton';
import { Tooltip } from '#src/components/Tooltip';
import {
  updateSearchParams,
  useSearchParams,
} from '#src/hooks/useSearchParams';
import { colors } from '#src/style/colors';
import { inline, monoFont } from '#src/style/helpers';
import type { ScopedRunRow } from '#src/utils/evalRuns';

export type RunFilter =
  | 'all'
  | 'successful'
  | 'unsuccessful'
  | 'failed'
  | 'errored'
  | 'cancelled'
  | 'running'
  | 'pending'
  | 'last24h';

const RUN_FILTER_OPTIONS: Array<{ value: RunFilter; label: string }> = [
  { value: 'all', label: 'All runs' },
  { value: 'last24h', label: 'Last 24h' },
  { value: 'successful', label: 'Successful' },
  { value: 'unsuccessful', label: 'Unsuccessful' },
  { value: 'failed', label: 'Failed' },
  { value: 'errored', label: 'Errored' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
];

export const RUN_FILTER_SEARCH_PARAM = 'runFilter';
const LAST_24H_MS = 24 * 60 * 60 * 1000;

const SectionLabel = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  margin-bottom: 14px;
`;

const SectionLabelText = styled.span`
  font-size: 13.5px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;
`;

const SectionMeta = styled.span`
  ${monoFont};
  font-size: 10.5px;
  color: ${colors.textMuted.var};
`;

const SectionActions = styled.div`
  ${inline({ gap: 6, align: 'center' })}
`;

const RunFilterSelect = styled.select`
  height: 28px;
  min-width: 132px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  padding: 0 26px 0 9px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;

  &:hover {
    border-color: ${colors.borderStrong.var};
  }

  &:focus {
    outline: 2px solid ${colors.accent.alpha(0.25)};
    outline-offset: 1px;
    border-color: ${colors.accent.alpha(0.65)};
  }
`;

export function runMatchesFilter(
  run: ScopedRunRow,
  filter: RunFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'last24h') return runStartedWithinLast24h(run);
  if (filter === 'successful') return run.summary.status === 'pass';
  if (filter === 'unsuccessful') {
    return (
      run.summary.status === 'fail' ||
      run.summary.status === 'error' ||
      run.summary.status === 'cancelled'
    );
  }
  if (filter === 'failed') return run.summary.status === 'fail';
  if (filter === 'errored') return run.summary.status === 'error';
  if (filter === 'cancelled') return run.summary.status === 'cancelled';
  if (filter === 'running') return run.summary.status === 'running';
  return run.summary.status === 'pending';
}

function runStartedWithinLast24h(run: ScopedRunRow): boolean {
  const startedAtMs = new Date(run.manifest.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return false;
  const ageMs = Date.now() - startedAtMs;
  return ageMs >= 0 && ageMs <= LAST_24H_MS;
}

export function getApplicableRunFilterOptions(
  runs: ScopedRunRow[],
): Array<{ value: RunFilter; label: string }> {
  return RUN_FILTER_OPTIONS.filter(
    (option) =>
      option.value === 'all' ||
      runs.some((run) => runMatchesFilter(run, option.value)),
  );
}

export function parseRunFilter(
  value: string | null,
  options: Array<{ value: RunFilter }>,
): RunFilter {
  return options.find((option) => option.value === value)?.value ?? 'all';
}

export function getFilterLabel(
  filter: RunFilter,
  options: Array<{ value: RunFilter; label: string }>,
): string {
  if (filter === 'all') return 'Saved';
  return options.find((option) => option.value === filter)?.label ?? 'Filtered';
}

export function setRunFilterSearchParam(filter: RunFilter): void {
  updateSearchParams((searchParams) => {
    if (filter === 'all') searchParams.delete(RUN_FILTER_SEARCH_PARAM);
    else searchParams.set(RUN_FILTER_SEARCH_PARAM, filter);
  });
}

type EvalRunsSectionProps = {
  runs: ScopedRunRow[];
  columnDefs: ColumnDef[];
  evalKey: string;
};

export function EvalRunsSection({
  runs,
  columnDefs,
  evalKey,
}: EvalRunsSectionProps) {
  const searchParams = useSearchParams();
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => {
    const latestRun = runs[0];
    return latestRun ? new Set([latestRun.manifest.id]) : new Set();
  });
  const runFilterOptions = getApplicableRunFilterOptions(runs);
  const runFilter = parseRunFilter(
    searchParams.get(RUN_FILTER_SEARCH_PARAM),
    runFilterOptions,
  );
  const filteredRuns = runs.filter((run) => runMatchesFilter(run, runFilter));

  const allRunsExpanded =
    filteredRuns.length > 0 &&
    filteredRuns.every((run) => expandedRunIds.has(run.manifest.id));

  function toggleExpandedRun(runId: string) {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  function toggleAllRuns() {
    setExpandedRunIds(() => {
      if (allRunsExpanded) return new Set<string>();
      return new Set(filteredRuns.map((run) => run.manifest.id));
    });
  }

  const runCountLabel =
    runFilter === 'all'
      ? runs.length > 0
        ? `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`
        : 'no runs'
      : `${filteredRuns.length} of ${runs.length} ${
          runs.length === 1 ? 'run' : 'runs'
        }`;

  return (
    <>
      <SectionLabel>
        <SectionLabelText>Runs</SectionLabelText>
        <SectionActions>
          {runs.length > 0 ? (
            <RunFilterSelect
              aria-label="Filter runs"
              value={runFilter}
              onChange={(event) =>
                setRunFilterSearchParam(
                  parseRunFilter(event.target.value, runFilterOptions),
                )
              }
            >
              {runFilterOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </RunFilterSelect>
          ) : null}
          {filteredRuns.length > 0 ? (
            <Tooltip
              content={
                allRunsExpanded
                  ? 'Collapse all run cases'
                  : 'Expand all run cases'
              }
            >
              <IconButton
                aria-label={
                  allRunsExpanded
                    ? 'Collapse all run cases'
                    : 'Expand all run cases'
                }
                onClick={toggleAllRuns}
              >
                {allRunsExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
              </IconButton>
            </Tooltip>
          ) : null}
          <SectionMeta>{runCountLabel}</SectionMeta>
        </SectionActions>
      </SectionLabel>
      <EvalRunsTable
        runs={filteredRuns}
        columnDefs={columnDefs}
        expandedRunIds={expandedRunIds}
        onToggleExpandedRun={toggleExpandedRun}
        runScope={{ kind: 'eval', id: evalKey }}
        emptyMessage={
          runFilter === 'all' ? undefined : 'No runs match this filter'
        }
      />
    </>
  );
}
