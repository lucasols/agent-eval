import {
  getEvalDisplayStatus,
  getEvalTitle,
  type EvalSummary,
} from '@agent-evals/shared';
import {
  ChevronDown,
  Play,
  SquareArrowOutUpRight,
  SquareStop,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { resultify } from 't-result';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { EvalRunsChart } from '#src/components/EvalRunsChart';
import {
  EvalRunsSection,
  getApplicableRunFilterOptions,
  getFilterLabel,
  parseRunFilter,
  RUN_FILTER_SEARCH_PARAM,
  runMatchesFilter,
  setRunFilterSearchParam,
} from '#src/components/EvalRunsSection';
import { IconButton } from '#src/components/IconButton';
import { MenuButton } from '#src/components/MenuButton';
import { PathBreadcrumb } from '#src/components/PathBreadcrumb';
import {
  SplitButton,
  type SplitButtonMenuEntry,
} from '#src/components/SplitButton';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
import { useSearchParams } from '#src/hooks/useSearchParams';
import { evalsStore, openEvalInEditor } from '#src/stores/evalsStore';
import { getRunsForEval, historyStore } from '#src/stores/historyStore';
import {
  cleanRunsForEval,
  clearCacheForEval,
  cancelRun,
  deleteRuns,
  recomputeStatusesForEval,
  runStore,
  startRun,
} from '#src/stores/runStore';
import { selectEval, selectFolder } from '#src/stores/selectionStore';
import { workspaceConfigStore } from '#src/stores/workspaceConfigStore';
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
import { getDisplayFolderSegments } from '#src/utils/buildEvalTree';
import { buildChartPoints } from '#src/utils/chartData';
import {
  buildEvalDebugCliCommand,
  buildEvalRunCliCommand,
} from '#src/utils/cliCommand';
import { buildEvalScopedRunRows } from '#src/utils/evalRuns';
import { computeStatDisplay } from '#src/utils/evalStats';
import { getFreshnessTooltip } from '#src/utils/freshness';

type EvalCardProps = { evalSummary: EvalSummary; mode: 'single' | 'stacked' };

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
    overflow-y: auto;
    overflow-x: hidden;
  }
`;

const StatsGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  background: ${colors.border.var};
  border-bottom: 1px solid ${colors.border.var};
`;

const Stat = styled.div`
  ${stack({ gap: 6 })}
  padding: 12px 16px 13px;
  background: ${colors.bg.var};
  flex: 1 1 160px;
  min-width: 160px;
`;

const StatLabel = styled.div`
  ${kicker};
  ${inline({ gap: 6, align: 'center' })}
  min-width: 0;
  font-size: 9px;
  color: ${colors.textMuted.var};
`;

const StatLabelText = styled.span`
  ${ellipsis};
`;

const StatAggregate = styled.span`
  color: ${colors.textDim.var};
  flex-shrink: 0;
`;

const StatValue = styled.div<{ accent: boolean }>`
  ${tabularNums};
  font-size: 20px;
  font-weight: 500;
  color: ${colors.text.var};
  letter-spacing: -0.02em;
  line-height: 1.1;

  &.accent {
    color: ${colors.accentDim.var};
  }
`;

const Section = styled.div<{ fill: boolean }>`
  ${stack({ gap: 0 })}
  padding: 20px 32px 24px;

  &:not(:last-child) {
    border-bottom: 1px solid ${colors.border.var};
  }

  &.fill {
    min-height: 480px;
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
  min-width: 0;
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

const SectionLabelRight = styled.span`
  ${inline({ justify: 'right', align: 'center', gap: 10 })}
  min-width: 0;
  flex: 1;
`;

const CollapsedChartLabels = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  min-width: 0;
  justify-content: flex-end;
  color: ${colors.textMuted.var};
  font-size: 12px;
`;

const CollapsedChartLabelItem = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  min-width: 0;
`;

const CollapsedChartLabel = styled.span`
  ${ellipsis};
  max-width: 180px;
`;

const CollapsedChartSeparator = styled.span`
  color: ${colors.textMuted.var};
`;

const SCORE_HISTORY_COLLAPSED_STORAGE_KEY =
  'agent-evals.eval-card.score-history-collapsed.v2';

function readScoreHistoryCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(
    SCORE_HISTORY_COLLAPSED_STORAGE_KEY,
  );
  return stored === null ? true : stored === '1';
}

async function copyTextToClipboard(
  text: string,
  promptTitle: string,
): Promise<void> {
  const copyResult = await resultify(() => navigator.clipboard.writeText(text));
  if (!copyResult.error) return;

  window.prompt(promptTitle, text);
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
  const searchParams = useSearchParams();

  const charts = evalSummary.charts ?? [];
  const chartLabels = charts.map(
    (chart, index) => chart.heading ?? `Chart ${String(index + 1)}`,
  );
  const {
    allRunRows,
    visibleRunRows,
    perChartData,
    completedRunCount,
    latestSummary,
    latestCases,
  } = useMemo(() => {
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

    const perChart =
      isSingle && charts.length > 0
        ? charts.map((config) =>
            buildChartPoints({
              rows,
              config,
              columnDefs: evalSummary.columnDefs,
              limit: 20,
            }),
          )
        : [];

    const completed = rows.filter(
      (r) => r.manifest.status === 'completed' && r.summary.totalCases > 0,
    );

    return {
      allRunRows: rows,
      visibleRunRows: isStacked ? rows.slice(0, 1) : rows,
      perChartData: perChart,
      completedRunCount: Math.min(completed.length, 20),
      latestSummary: rows[0]?.summary ?? null,
      latestCases: rows[0]?.cases ?? [],
    };
  }, [
    runs,
    currentRun,
    evalSummary.id,
    evalSummary.columnDefs,
    isSingle,
    isStacked,
    charts,
  ]);

  const stats = evalSummary.stats ?? [];
  const statDisplays = stats.map((stat) =>
    computeStatDisplay(stat, { evalSummary, latestSummary, latestCases }),
  );

  const isRunning =
    currentRun?.manifest.status === 'running' &&
    runTargetsEvalLocal(currentRun.manifest.target, evalSummary.id);
  const hasScoreHistory =
    isSingle && charts.length > 0 && completedRunCount > 1;
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

  function handleStop(e: React.MouseEvent) {
    e.stopPropagation();
    void cancelRun(currentRun?.manifest.id);
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
      description: 'Remove every cached entry tied to this eval id.',
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

  const runFilterOptions = getApplicableRunFilterOptions(allRunRows);
  const runFilter = parseRunFilter(
    searchParams.get(RUN_FILTER_SEARCH_PARAM),
    runFilterOptions,
  );
  const filteredRunRows = allRunRows.filter((run) =>
    runMatchesFilter(run, runFilter),
  );
  const clearableFilteredRunRows = filteredRunRows.filter(
    (run) => run.manifest.status !== 'running',
  );
  const showClearFilteredRunsAction =
    isSingle && runFilter !== 'all' && clearableFilteredRunRows.length > 0;
  const runFilterLabel = getFilterLabel(runFilter, runFilterOptions);

  async function handleClearFilteredRuns() {
    const runCount = clearableFilteredRunRows.length;
    if (runCount === 0) return;
    const filterLabel = runFilterLabel.toLowerCase();
    const noun = runCount === 1 ? 'run' : 'runs';
    const confirmed = window.confirm(
      `Delete ${String(runCount)} ${filterLabel} ${noun} for this eval? This cannot be undone.`,
    );
    if (!confirmed) return;

    setMaintenanceAction('clean');
    try {
      await deleteRuns(clearableFilteredRunRows.map((run) => run.manifest.id));
      setRunFilterSearchParam('all');
    } finally {
      setMaintenanceAction(null);
    }
  }

  async function handleCopyCliRunCommand() {
    const { packageManager } = workspaceConfigStore.state;
    await copyTextToClipboard(
      buildEvalRunCliCommand({ packageManager, evalId: evalSummary.id }),
      'Copy CLI run command',
    );
  }

  async function handleCopyCliDebugCommand() {
    const { packageManager } = workspaceConfigStore.state;
    await copyTextToClipboard(
      buildEvalDebugCliCommand({ packageManager, evalId: evalSummary.id }),
      'Copy CLI debug command',
    );
  }

  const moreMenu: SplitButtonMenuEntry[] = [
    {
      id: 'copy-cli-run-command',
      label: 'Copy CLI run command',
      description: 'Copy the package-manager command for this eval.',
      onSelect: () => {
        void handleCopyCliRunCommand();
      },
    },
    {
      id: 'copy-cli-debug-command',
      label: 'Copy CLI debug command',
      description: 'Copy the Node inspector command for this eval.',
      onSelect: () => {
        void handleCopyCliDebugCommand();
      },
    },
    { kind: 'separator' },
    ...(showClearFilteredRunsAction
      ? [
          {
            id: 'clear-filtered-runs',
            label: 'Clear filtered runs',
            description: `Delete ${runFilterLabel.toLowerCase()} saved runs for this eval.`,
            tone: 'danger',
            onSelect: () => {
              void handleClearFilteredRuns();
            },
          } satisfies SplitButtonMenuEntry,
        ]
      : []),
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
                <Title large={isSingle}>{getEvalTitle(evalSummary)}</Title>
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
            {isRunning ? (
              <Button
                variant="danger"
                leftIcon={<SquareStop />}
                onClick={handleStop}
                aria-label="Stop run"
              >
                Stop
              </Button>
            ) : (
              <SplitButton
                label="Run"
                leftIcon={<Play />}
                onPrimaryClick={handleRun}
                menu={cacheMenu}
                aria-label="Run"
              />
            )}
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
          {statDisplays.length > 0 ? (
            <StatsGrid>
              {statDisplays.map((stat, index) => (
                <Stat key={`${stat.label}-${index}`}>
                  <StatLabel>
                    <StatLabelText>{stat.label}</StatLabelText>
                    {stat.aggregateLabel === undefined ? null : (
                      <StatAggregate>{stat.aggregateLabel}</StatAggregate>
                    )}
                  </StatLabel>
                  <StatValue accent={stat.accent}>{stat.value}</StatValue>
                </Stat>
              ))}
            </StatsGrid>
          ) : null}

          {hasScoreHistory ? (
            <Section fill={false}>
              <SectionLabel collapsed={scoreHistoryCollapsed}>
                <SectionLabelLeft
                  type="button"
                  onClick={() => setScoreHistoryCollapsed((v) => !v)}
                  aria-expanded={!scoreHistoryCollapsed}
                  aria-label={
                    scoreHistoryCollapsed
                      ? 'Expand history charts'
                      : 'Collapse history charts'
                  }
                >
                  <SectionChevron open={!scoreHistoryCollapsed}>
                    <ChevronDown />
                  </SectionChevron>
                  <SectionLabelText>History</SectionLabelText>
                </SectionLabelLeft>
                <SectionLabelRight>
                  {scoreHistoryCollapsed ? (
                    <CollapsedChartLabels>
                      {chartLabels.map((label, index) => (
                        <CollapsedChartLabelItem key={`${label}-${index}`}>
                          {index > 0 ? (
                            <CollapsedChartSeparator>·</CollapsedChartSeparator>
                          ) : null}
                          <CollapsedChartLabel>{label}</CollapsedChartLabel>
                        </CollapsedChartLabelItem>
                      ))}
                    </CollapsedChartLabels>
                  ) : (
                    <SectionMeta>
                      {completedRunCount}{' '}
                      {completedRunCount === 1 ? 'run' : 'runs'}
                    </SectionMeta>
                  )}
                </SectionLabelRight>
              </SectionLabel>
              {scoreHistoryCollapsed
                ? null
                : charts.map((config, i) => (
                    <EvalRunsChart
                      key={`chart-${i}`}
                      config={config}
                      data={perChartData[i] ?? []}
                      columnDefs={evalSummary.columnDefs}
                    />
                  ))}
            </Section>
          ) : null}

          <Section fill={isSingle}>
            <EvalRunsSection
              key={visibleRunRows.map((run) => run.manifest.id).join(':')}
              runs={visibleRunRows}
              columnDefs={evalSummary.columnDefs}
              evalId={evalSummary.id}
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
