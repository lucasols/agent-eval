import { getEvalDisplayStatus, type EvalSummary } from '@agent-evals/shared';
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Play,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  kicker,
  monoFont,
  stack,
  tabularNums,
  transition,
} from '#src/style/helpers';
import { evalsStore, openEvalInEditor } from '../stores/evalsStore.ts';
import { getRunsForEval, historyStore } from '../stores/historyStore.ts';
import {
  cleanRunsForEval,
  clearCacheForEval,
  recomputeStatusesForEval,
  runStore,
  startRun,
} from '../stores/runStore.ts';
import { selectEval, selectFolder } from '../stores/selectionStore.ts';
import { getDisplayFolderSegments } from '../utils/buildEvalTree.ts';
import { buildEvalScopedRunRows } from '../utils/evalRuns.ts';
import {
  formatCost,
  formatDuration,
  formatScore,
} from '../utils/formatters.ts';
import { getFreshnessTooltip } from '../utils/freshness.ts';
import { EvalRunsChart } from './EvalRunsChart.tsx';
import { EvalRunsTable } from './EvalRunsTable.tsx';
import { IconButton } from './IconButton.tsx';
import { MenuButton } from './MenuButton.tsx';
import { PathBreadcrumb } from './PathBreadcrumb.tsx';
import { SplitButton, type SplitButtonMenuEntry } from './SplitButton.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { Tooltip } from './Tooltip.tsx';

type EvalCardProps = { evalSummary: EvalSummary; mode: 'single' | 'stacked' };

const RUN_SHORT_ID_PREFIX = /^r/;

const Card = styled.section<{ stacked: boolean; single: boolean }>`
  ${stack({ gap: 0 })}
  background: transparent;

  &.stacked {
    border: 1px solid ${colors.border.var};
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: ${colors.bg.var};
  }

  &.single {
    height: 100%;
    overflow: hidden;
  }
`;

const Header = styled.header<{ collapsible: boolean; sticky: boolean }>`
  ${stack({ gap: 0 })}
  padding: 22px 32px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bg.var};

  &.sticky {
    position: sticky;
    top: 0;
    z-index: 3;
  }

  &.collapsible {
    cursor: pointer;
    padding: 16px 24px;
  }
`;

const HeaderTopRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  width: 100%;
`;

const BreadcrumbWrap = styled.div`
  margin-bottom: 14px;
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  min-width: 0;
  flex: 1;
`;

const TitleBlock = styled.div`
  ${stack({ gap: 8 })}
  min-width: 0;
  flex: 1;
`;

const TitleRow = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  min-width: 0;
`;

const Title = styled.h2<{ large: boolean }>`
  ${ellipsis};
  font-size: 16px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.02em;
  margin: 0;

  &.large {
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.1;
  }
`;

const Description = styled.div`
  font-size: 12.5px;
  color: ${colors.textMuted.var};
  max-width: 720px;
  line-height: 1.5;
`;

const StatusWrap = styled.span`
  display: inline-flex;
`;

const FilePath = styled.div`
  ${monoFont};
  ${ellipsis};
  font-size: 11.5px;
  color: ${colors.textMuted.var};
`;

const HeaderRight = styled.div`
  ${inline({ gap: 8, align: 'center' })}
  flex-shrink: 0;
`;

const Chevron = styled.span<{ open: boolean }>`
  ${transition({ property: 'transform' })}
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};
  transform: rotate(-90deg);

  &.open {
    transform: rotate(0deg);
  }

  & > svg {
    width: 14px;
    height: 14px;
  }
`;

const Body = styled.div<{ scroll: boolean }>`
  ${stack({ gap: 0 })}

  &.scroll {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1px;
  background: ${colors.border.var};
  border-bottom: 1px solid ${colors.border.var};
`;

const Stat = styled.div`
  ${stack({ gap: 10 })}
  padding: 18px 22px 20px;
  background: ${colors.bg.var};
`;

const StatLabel = styled.div`
  ${kicker};
  font-size: 9px;
  color: ${colors.textMuted.var};
`;

const StatValue = styled.div<{ accent: boolean; cost: boolean }>`
  ${tabularNums};
  font-size: 30px;
  font-weight: 500;
  color: ${colors.text.var};
  letter-spacing: -0.03em;
  line-height: 1;

  &.accent {
    color: ${colors.accentDim.var};
  }
  &.cost {
    color: ${colors.cost.var};
  }
`;

const Section = styled.div<{ fill: boolean }>`
  ${stack({ gap: 0 })}
  padding: 20px 32px 24px;

  &:not(:last-child) {
    border-bottom: 1px solid ${colors.border.var};
  }

  &.fill {
    flex: 1;
    min-height: 0;
  }
`;

const SectionLabel = styled.div<{ collapsed: boolean }>`
  ${inline({ justify: 'space-between', align: 'center' })}
  margin-bottom: 14px;

  &.collapsed {
    margin-bottom: 0;
  }
`;

const SectionLabelLeft = styled.button`
  ${inline({ gap: 8, align: 'center' })}
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
`;

const SectionChevron = styled.span<{ open: boolean }>`
  ${transition({ property: 'transform' })}
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};
  transform: rotate(-90deg);

  &.open {
    transform: rotate(0deg);
  }

  & > svg {
    width: 14px;
    height: 14px;
  }
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
  ${inline({ gap: 4, align: 'center' })}
`;

const SCORE_HISTORY_COLLAPSED_STORAGE_KEY =
  'agent-evals.eval-card.score-history-collapsed';

function readScoreHistoryCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.localStorage.getItem(SCORE_HISTORY_COLLAPSED_STORAGE_KEY) === '1'
  );
}

export function EvalCard({ evalSummary, mode }: EvalCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [scoreHistoryCollapsed, setScoreHistoryCollapsed] = useState(
    readScoreHistoryCollapsed,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      SCORE_HISTORY_COLLAPSED_STORAGE_KEY,
      scoreHistoryCollapsed ? '1' : '0',
    );
  }, [scoreHistoryCollapsed]);

  const [maintenanceAction, setMaintenanceAction] = useState<
    'recompute' | 'clean' | null
  >(null);
  const isStacked = mode === 'stacked';
  const isSingle = mode === 'single';

  const { runs } = historyStore.useSelectorRC((s) => ({ runs: s.runs }));
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));

  const { visibleRunRows, chartData, latestSummary } = useMemo(() => {
    const evalRuns = getRunsForEval(runs, evalSummary.id);
    const liveRun =
      currentRun &&
      runTargetsEvalLocal(currentRun.manifest.target, evalSummary.id)
        ? currentRun
        : null;

    const merged = evalRuns.filter(
      (r) => r.manifest.id !== liveRun?.manifest.id,
    );
    if (liveRun) {
      merged.unshift(liveRun);
    }

    const rows = buildEvalScopedRunRows(merged, evalSummary.id);

    const points = isSingle
      ? [...rows]
          .reverse()
          .filter(
            (r) =>
              r.manifest.status === 'completed' &&
              r.summary.averageScore !== null,
          )
          .slice(-20)
          .map((r, index, completedRuns) => ({
            axisLabel:
              index === completedRuns.length - 1
                ? 'LATEST'
                : r.manifest.shortId.replace(RUN_SHORT_ID_PREFIX, ''),
            shortId: r.manifest.shortId,
            startedAt: r.manifest.startedAt,
            score: r.summary.averageScore ?? 0,
            cost: r.summary.cost.totalUsd,
          }))
      : [];

    return {
      visibleRunRows: isStacked ? rows.slice(0, 1) : rows,
      chartData: points,
      latestSummary: rows[0]?.summary ?? null,
    };
  }, [runs, currentRun, evalSummary.id, isSingle, isStacked]);

  const isRunning =
    currentRun?.manifest.status === 'running' &&
    runTargetsEvalLocal(currentRun.manifest.target, evalSummary.id);
  const hasScoreHistory = isSingle && chartData.length > 1;
  const displayStatus = getEvalDisplayStatus({
    freshnessStatus: evalSummary.freshnessStatus,
    stale: evalSummary.stale,
    outdated: evalSummary.outdated,
    lastRunStatus: evalSummary.lastRunStatus,
    isRunning,
  });
  const statusTooltip =
    evalSummary.stale || evalSummary.outdated
      ? getFreshnessTooltip(evalSummary)
      : undefined;

  function handleRun(e: React.MouseEvent) {
    e.stopPropagation();
    void startRun({ mode: 'evalIds', evalIds: [evalSummary.id] });
  }

  const cacheMenu: SplitButtonMenuEntry[] = [
    {
      id: 'run-default',
      label: 'Run (use cache)',
      description: 'Read on hit, write on miss.',
      onSelect: () => {
        void startRun(
          { mode: 'evalIds', evalIds: [evalSummary.id] },
          { cacheMode: 'use' },
        );
      },
    },
    {
      id: 'run-no-cache',
      label: 'Run without cache',
      description: 'Skip reads and writes for this run.',
      onSelect: () => {
        void startRun(
          { mode: 'evalIds', evalIds: [evalSummary.id] },
          { cacheMode: 'bypass' },
        );
      },
    },
    {
      id: 'run-refresh',
      label: 'Refresh cache',
      description: 'Force re-execution and overwrite entries.',
      onSelect: () => {
        void startRun(
          { mode: 'evalIds', evalIds: [evalSummary.id] },
          { cacheMode: 'refresh' },
        );
      },
    },
    { kind: 'separator' },
    {
      id: 'clear-cache',
      label: 'Clear cache for this eval',
      description: 'Remove every cached span entry tied to this eval id.',
      tone: 'danger',
      onSelect: () => {
        if (!window.confirm('Clear cached entries for this eval?')) return;
        void clearCacheForEval(evalSummary.id);
      },
    },
  ];

  async function handleRecomputeStatuses() {
    setMaintenanceAction('recompute');
    try {
      await recomputeStatusesForEval(evalSummary.id);
    } finally {
      setMaintenanceAction(null);
    }
  }

  async function handleCleanRuns() {
    setMaintenanceAction('clean');
    try {
      await cleanRunsForEval(evalSummary.id);
    } finally {
      setMaintenanceAction(null);
    }
  }

  const moreMenu: SplitButtonMenuEntry[] = [
    {
      id: 'recompute-status',
      label: 'Recompute status',
      description:
        'Recalculate statuses for saved runs that touched this eval.',
      onSelect: () => {
        void handleRecomputeStatuses();
      },
    },
    {
      id: 'clean-runs',
      label: 'Clean runs',
      description: 'Delete saved terminal runs that touched this eval.',
      tone: 'danger',
      onSelect: () => {
        if (!window.confirm('Delete saved runs for this eval?')) return;
        void handleCleanRuns();
      },
    },
  ];

  const showBody = !isStacked || !collapsed;

  function onHeaderClick() {
    if (!isStacked) return;
    setCollapsed((v) => !v);
  }

  const pathSegments = evalSummary.filePath.split('/');
  const filename =
    pathSegments[pathSegments.length - 1] ?? evalSummary.filePath;
  const breadcrumbSegments = getDisplayFolderSegments(
    evals,
    evalSummary.filePath,
  ).map((segment, index, segments) => ({
    segment,
    path: segments.slice(0, index + 1).join('/'),
  }));

  return (
    <Card
      stacked={isStacked}
      single={isSingle}
    >
      <Header
        collapsible={isStacked}
        sticky={isSingle}
        onClick={onHeaderClick}
      >
        {isSingle ? (
          <BreadcrumbWrap>
            <PathBreadcrumb
              segments={breadcrumbSegments.map(({ segment, path }) => ({
                label: segment,
                path,
              }))}
              currentLabel={filename}
              onSelect={selectFolder}
              onOpenInEditor={() => {
                void openEvalInEditor(evalSummary.id);
              }}
            />
          </BreadcrumbWrap>
        ) : null}
        <HeaderTopRow>
          <HeaderLeft>
            {isStacked ? (
              <Chevron open={!collapsed}>
                <ChevronDown />
              </Chevron>
            ) : null}
            <TitleBlock>
              <TitleRow>
                <Title large={isSingle}>
                  {evalSummary.title ?? evalSummary.id}
                </Title>
                <StatusWrap title={statusTooltip ?? undefined}>
                  <StatusBadge status={displayStatus} />
                </StatusWrap>
              </TitleRow>
              {isSingle ? null : (
                <FilePath title={evalSummary.filePath}>
                  {evalSummary.filePath}
                </FilePath>
              )}
              {isSingle && evalSummary.caseCount !== null ? (
                <Description>
                  {evalSummary.caseCount}{' '}
                  {evalSummary.caseCount === 1 ? 'case' : 'cases'} · see score
                  history and per-case results below.
                </Description>
              ) : null}
            </TitleBlock>
          </HeaderLeft>
          <HeaderRight onClick={(e) => e.stopPropagation()}>
            {isStacked ? (
              <Tooltip content="Open eval page">
                <IconButton
                  aria-label="Open eval page"
                  onClick={() => selectEval(evalSummary.id)}
                >
                  <SquareArrowOutUpRight />
                </IconButton>
              </Tooltip>
            ) : null}
            <SplitButton
              label={isRunning ? 'Running' : 'Run'}
              leftIcon={<Play />}
              onPrimaryClick={handleRun}
              disabled={isRunning}
              menu={cacheMenu}
              aria-label="Run"
            />
            <MenuButton
              menu={moreMenu}
              disabled={maintenanceAction !== null}
              aria-label="More eval actions"
            />
          </HeaderRight>
        </HeaderTopRow>
      </Header>

      {showBody ? (
        <Body scroll={isSingle}>
          <StatsGrid>
            <Stat>
              <StatLabel>Cases</StatLabel>
              <StatValue
                accent={false}
                cost={false}
              >
                {evalSummary.caseCount ?? '\u2014'}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Avg score</StatLabel>
              <StatValue
                accent={true}
                cost={false}
              >
                {formatScore(latestSummary?.averageScore ?? null)}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Pass / Fail</StatLabel>
              <StatValue
                accent={false}
                cost={false}
              >
                {latestSummary
                  ? `${latestSummary.passedCases}/${latestSummary.failedCases + latestSummary.errorCases}`
                  : '\u2014'}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Duration</StatLabel>
              <StatValue
                accent={false}
                cost={false}
              >
                {formatDuration(latestSummary?.totalDurationMs ?? null)}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Cost</StatLabel>
              <StatValue
                accent={false}
                cost={true}
              >
                {formatCost(latestSummary?.cost.totalUsd ?? null)}
              </StatValue>
            </Stat>
          </StatsGrid>

          {hasScoreHistory ? (
            <Section fill={false}>
              <SectionLabel collapsed={scoreHistoryCollapsed}>
                <SectionLabelLeft
                  type="button"
                  onClick={() => setScoreHistoryCollapsed((v) => !v)}
                  aria-expanded={!scoreHistoryCollapsed}
                  aria-label={
                    scoreHistoryCollapsed
                      ? 'Expand score history'
                      : 'Collapse score history'
                  }
                >
                  <SectionChevron open={!scoreHistoryCollapsed}>
                    <ChevronDown />
                  </SectionChevron>
                  <SectionLabelText>Score history</SectionLabelText>
                </SectionLabelLeft>
                <SectionMeta>
                  {chartData.length} {chartData.length === 1 ? 'run' : 'runs'}
                </SectionMeta>
              </SectionLabel>
              {scoreHistoryCollapsed ? null : (
                <EvalRunsChart data={chartData} />
              )}
            </Section>
          ) : null}

          <Section fill={isSingle}>
            <RunsSection
              key={visibleRunRows.map((run) => run.manifest.id).join(':')}
              runs={visibleRunRows}
              columnDefs={evalSummary.columnDefs}
              passThreshold={evalSummary.passThreshold ?? 0.5}
              fillHeight={isSingle}
            />
          </Section>
        </Body>
      ) : null}
    </Card>
  );
}

function runTargetsEvalLocal(
  target: { mode: string; evalIds?: string[] },
  evalId: string,
): boolean {
  if (target.mode === 'all') return true;
  if (target.mode === 'evalIds') {
    return target.evalIds?.includes(evalId) ?? false;
  }
  return false;
}

function RunsSection({
  runs,
  columnDefs,
  passThreshold,
  fillHeight,
}: {
  runs: Parameters<typeof EvalRunsTable>[0]['runs'];
  columnDefs: Parameters<typeof EvalRunsTable>[0]['columnDefs'];
  passThreshold: number;
  fillHeight: boolean;
}) {
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => {
    const latestRun = runs[0];
    return latestRun ? new Set([latestRun.manifest.id]) : new Set();
  });

  const allRunsExpanded =
    runs.length > 0 && runs.every((run) => expandedRunIds.has(run.manifest.id));

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
      return new Set(runs.map((run) => run.manifest.id));
    });
  }

  return (
    <>
      <SectionLabel collapsed={false}>
        <SectionLabelText>Runs</SectionLabelText>
        <SectionActions>
          {runs.length > 0 ? (
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
          <SectionMeta>
            {runs.length > 0
              ? `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`
              : 'no runs'}
          </SectionMeta>
        </SectionActions>
      </SectionLabel>
      <EvalRunsTable
        runs={runs}
        columnDefs={columnDefs}
        passThreshold={passThreshold}
        expandedRunIds={expandedRunIds}
        onToggleExpandedRun={toggleExpandedRun}
        fillHeight={fillHeight}
      />
    </>
  );
}
