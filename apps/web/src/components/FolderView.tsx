import type { EvalSummary } from '@agent-evals/shared';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, stack } from '#src/style/helpers';
import {
  cleanRunsForEval,
  clearCacheForEval,
  recomputeStatusesForEval,
  startRun,
  runStore,
} from '../stores/runStore.ts';
import { selectFolder } from '../stores/selectionStore.ts';
import {
  getStatusBreakdown,
  type StatusBreakdown,
} from '../utils/buildEvalTree.ts';
import { EmptyState } from './EmptyState.tsx';
import { EvalCard } from './EvalCard.tsx';
import { MenuButton } from './MenuButton.tsx';
import { PathBreadcrumb } from './PathBreadcrumb.tsx';
import { SplitButton, type SplitButtonMenuEntry } from './SplitButton.tsx';

type FolderViewProps = { folderPath: string; evals: EvalSummary[] };

const Root = styled.div`
  height: 100%;
  overflow: auto;
`;

const Header = styled.div`
  ${stack({ gap: 6 })}
  padding: 22px 32px 18px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bg.var};
  position: sticky;
  top: 0;
  z-index: 3;
`;

const TitleRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 14 })}
`;

const HeaderMeta = styled.div`
  ${inline({ align: 'center', gap: 12 })}
`;

const Count = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  flex-wrap: wrap;
`;

const TotalPill = styled.span`
  ${inline({ gap: 5, align: 'center' })}
  ${kicker};
  padding: 3px 9px;
  border-radius: 999px;
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  line-height: 1;
  letter-spacing: 0.04em;
`;

const TotalPillValue = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;
`;

type BreakdownTone =
  | 'running'
  | 'pass'
  | 'fail'
  | 'stale'
  | 'outdated'
  | 'cancelled'
  | 'pending';

const BreakdownPill = styled.span<{
  running: boolean;
  pass: boolean;
  fail: boolean;
  stale: boolean;
  outdated: boolean;
  cancelled: boolean;
  pending: boolean;
}>`
  ${inline({ gap: 5, align: 'center' })}
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 9.5px;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 500;
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};
  border: 1px solid transparent;

  &.pass {
    color: ${colors.success.var};
    background: ${colors.success.alpha(0.08)};
    border-color: ${colors.success.alpha(0.18)};
  }
  &.fail {
    color: ${colors.error.var};
    background: ${colors.error.alpha(0.08)};
    border-color: ${colors.error.alpha(0.18)};
  }
  &.running {
    color: ${colors.accentDim.var};
    background: ${colors.accent.alpha(0.1)};
    border-color: ${colors.accent.alpha(0.22)};
  }
  &.cancelled {
    color: ${colors.warning.var};
    background: ${colors.warning.alpha(0.08)};
    border-color: ${colors.warning.alpha(0.18)};
  }
  &.stale {
    color: ${colors.textMuted.var};
    background: ${colors.surfaceActive.var};
    border-color: ${colors.border.var};
  }
  &.outdated {
    color: ${colors.warning.var};
    background: ${colors.warning.alpha(0.1)};
    border-color: ${colors.warning.alpha(0.22)};
  }
  &.pending {
    color: ${colors.textMuted.var};
    background: ${colors.surface.var};
    border-color: ${colors.border.var};
  }
`;

const BreakdownValue = styled.span`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: -0.01em;
`;

const BREAKDOWN_STATUS_ORDER: Array<{
  key: Exclude<keyof StatusBreakdown, 'total'>;
  label: string;
  tone: BreakdownTone;
}> = [
  { key: 'running', label: 'running', tone: 'running' },
  { key: 'pass', label: 'pass', tone: 'pass' },
  { key: 'fail', label: 'fail', tone: 'fail' },
  { key: 'error', label: 'error', tone: 'fail' },
  { key: 'stale', label: 'stale', tone: 'stale' },
  { key: 'outdated', label: 'outdated', tone: 'outdated' },
  { key: 'cancelled', label: 'cancelled', tone: 'cancelled' },
  { key: 'pending', label: 'pending', tone: 'pending' },
];

const Stack = styled.div`
  ${stack({ gap: 20 })}
  padding: 24px 32px 40px;
`;

export function FolderView({ folderPath, evals }: FolderViewProps) {
  const [maintenanceAction, setMaintenanceAction] = useState<
    'recompute' | 'clean' | null
  >(null);
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));
  const displaySegments = folderPath
    .split('/')
    .filter((segment) => segment.length > 0);
  const currentLabel = displaySegments.at(-1) ?? '/';
  const parentSegments = displaySegments
    .slice(0, -1)
    .map((label, index) => ({
      label,
      path: displaySegments.slice(0, index + 1).join('/'),
    }));
  const evalIds = evals.map((ev) => ev.id);
  const isEvalRunning = (evalId: string): boolean =>
    currentRun?.manifest.status === 'running' &&
    targetIncludesEval(currentRun.manifest.target, evalId);
  const isRunning =
    currentRun?.manifest.status === 'running' &&
    evalIds.some((evalId) =>
      targetIncludesEval(currentRun.manifest.target, evalId),
    );
  const breakdown = getStatusBreakdown(evals, isEvalRunning);
  const breakdownItems = BREAKDOWN_STATUS_ORDER.filter(
    ({ key }) => breakdown[key] > 0,
  );

  function handleRunAll() {
    if (evalIds.length === 0) return;
    void startRun({ mode: 'evalIds', evalIds });
  }

  function handleRecomputeStatuses() {
    setMaintenanceAction('recompute');
    void Promise.all(
      evalIds.map((evalId) => recomputeStatusesForEval(evalId)),
    ).finally(() => {
      setMaintenanceAction(null);
    });
  }

  function handleCleanRuns() {
    setMaintenanceAction('clean');
    void Promise.all(evalIds.map((evalId) => cleanRunsForEval(evalId))).finally(
      () => {
        setMaintenanceAction(null);
      },
    );
  }

  const cacheMenu: SplitButtonMenuEntry[] = [
    {
      id: 'run-default',
      label: 'Run (use cache)',
      description: 'Read on hit, write on miss.',
      onSelect: () => {
        void startRun({ mode: 'evalIds', evalIds }, { cacheMode: 'use' });
      },
    },
    {
      id: 'run-no-cache',
      label: 'Run without cache',
      description: 'Skip reads and writes for this run.',
      onSelect: () => {
        void startRun({ mode: 'evalIds', evalIds }, { cacheMode: 'bypass' });
      },
    },
    {
      id: 'run-refresh',
      label: 'Refresh cache',
      description: 'Force re-execution and overwrite entries.',
      onSelect: () => {
        void startRun({ mode: 'evalIds', evalIds }, { cacheMode: 'refresh' });
      },
    },
    { kind: 'separator' },
    {
      id: 'clear-cache',
      label: 'Clear cache for these evals',
      description: 'Remove cached span entries tied to every eval in view.',
      tone: 'danger',
      onSelect: () => {
        if (
          !window.confirm(
            `Clear cached entries for ${String(evalIds.length)} evals in this view?`,
          )
        ) {
          return;
        }
        void Promise.all(evalIds.map((evalId) => clearCacheForEval(evalId)));
      },
    },
  ];

  const moreMenu: SplitButtonMenuEntry[] = [
    {
      id: 'recompute-status',
      label: 'Recompute status',
      description:
        'Recalculate statuses for saved runs that touched these evals.',
      onSelect: handleRecomputeStatuses,
    },
    {
      id: 'clean-runs',
      label: 'Clean runs',
      description: 'Delete saved terminal runs that touched these evals.',
      tone: 'danger',
      onSelect: () => {
        if (
          !window.confirm(
            `Delete saved runs for ${String(evalIds.length)} evals in this view?`,
          )
        ) {
          return;
        }
        handleCleanRuns();
      },
    },
  ];

  return (
    <Root>
      <Header>
        <TitleRow>
          <PathBreadcrumb
            segments={parentSegments}
            currentLabel={currentLabel}
            onSelect={selectFolder}
          />
          <HeaderMeta>
            <Count>
              <TotalPill>
                <TotalPillValue>{evals.length}</TotalPillValue>
                {evals.length === 1 ? 'eval' : 'evals'}
              </TotalPill>
              {breakdownItems.map(({ key, label, tone }) => (
                <BreakdownPill
                  key={key}
                  pass={tone === 'pass'}
                  fail={tone === 'fail'}
                  running={tone === 'running'}
                  cancelled={tone === 'cancelled'}
                  stale={tone === 'stale'}
                  outdated={tone === 'outdated'}
                  pending={tone === 'pending'}
                >
                  <BreakdownValue>{breakdown[key]}</BreakdownValue>
                  {label}
                </BreakdownPill>
              ))}
            </Count>
            <SplitButton
              label={isRunning ? 'Running' : 'Run all'}
              leftIcon={<Play />}
              onPrimaryClick={handleRunAll}
              disabled={evalIds.length === 0 || isRunning}
              menu={cacheMenu}
              aria-label="Run all"
            />
            <MenuButton
              menu={moreMenu}
              disabled={evalIds.length === 0 || maintenanceAction !== null}
              aria-label="More eval actions"
            />
          </HeaderMeta>
        </TitleRow>
      </Header>
      {evals.length === 0 ? (
        <EmptyState
          title="No evals here"
          description="This folder doesn't contain any evals."
        />
      ) : (
        <Stack>
          {evals.map((ev) => (
            <EvalCard
              key={ev.id}
              evalSummary={ev}
              mode="stacked"
            />
          ))}
        </Stack>
      )}
    </Root>
  );
}

function targetIncludesEval(
  target: { mode: string; evalIds?: string[] },
  evalId: string,
): boolean {
  if (target.mode === 'all') return true;
  if (target.mode === 'evalIds') {
    return target.evalIds?.includes(evalId) ?? false;
  }
  return false;
}
