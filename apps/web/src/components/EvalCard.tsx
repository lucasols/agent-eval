import {
  getEvalDisplayStatus,
  getEvalTitle,
  type CacheMode,
  type EvalSummary,
} from '@agent-evals/shared';
import {
  ChevronDown,
  Play,
  SquareArrowOutUpRight,
  SquareStop,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { CasePickerModal } from '#src/components/CasePickerModal';
import { EvalHistorySection } from '#src/components/EvalHistorySection';
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
import { ManualInputModal } from '#src/components/ManualInputModal';
import { MenuButton } from '#src/components/MenuButton';
import { PathBreadcrumb } from '#src/components/PathBreadcrumb';
import {
  SplitButton,
  type SplitButtonMenuEntry,
} from '#src/components/SplitButton';
import { StatusBadge } from '#src/components/StatusBadge';
import { TagChips } from '#src/components/TagChips';
import { Tooltip } from '#src/components/Tooltip';
import { useElapsedRunTime } from '#src/hooks/useElapsedRunTime';
import { useManualInputRun } from '#src/hooks/useManualInputRun';
import { useSearchParams } from '#src/hooks/useSearchParams';
import { evalSummariesStore, openEvalInEditor } from '#src/stores/evalsStore';
import { getRunsForEval, runHistoryStore } from '#src/stores/historyStore';
import {
  cleanRunsForEval,
  cancelRun,
  clearCacheForEval,
  deleteRuns,
  recomputeStatusesForEval,
  runStore,
  startRun,
} from '#src/stores/runStore';
import { selectEval, selectFolder } from '#src/stores/selectionStore';
import {
  DEFAULT_WORKSPACE_CONFIG,
  workspaceConfigStore,
} from '#src/stores/workspaceConfigStore';
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
import { chartHasNumericValue } from '#src/utils/chartVisibility';
import {
  buildEvalDebugCliCommand,
  buildEvalRunCliCommand,
} from '#src/utils/cliCommand';
import { copyTextToClipboard } from '#src/utils/clipboard';
import { buildEvalScopedRunRows } from '#src/utils/evalRuns';
import { computeStatDisplay } from '#src/utils/evalStats';
import { getFreshnessTooltip } from '#src/utils/freshness';
import { runTargetsEval as runTargetsEvalLocal } from '#src/utils/runTargeting';
import {
  readScoreHistoryCollapsed,
  writeScoreHistoryCollapsed,
} from '#src/utils/scoreHistoryCollapsed';
import { shouldShowStatDisplay } from '#src/utils/statVisibility';

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

export function EvalCard({ evalSummary, mode }: EvalCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [casePickerCacheMode, setCasePickerCacheMode] =
    useState<CacheMode>('use');
  const [casePickerTemporary, setCasePickerTemporary] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [scoreHistoryCollapsed, setScoreHistoryCollapsed] = useState(
    readScoreHistoryCollapsed,
  );

  useEffect(() => {
    writeScoreHistoryCollapsed(scoreHistoryCollapsed);
  }, [scoreHistoryCollapsed]);

  const [maintenanceAction, setMaintenanceAction] = useState<
    'recompute' | 'clean' | 'clear-cache' | null
  >(null);
  const isStacked = mode === 'stacked';
  const isSingle = mode === 'single';

  const runHistoryResult = runHistoryStore.useDocument();
  const runs = runHistoryResult.data ?? [];
  const evals = evalSummariesStore.useDocument().data ?? [];
  const workspaceConfig =
    workspaceConfigStore.useDocument().data ?? DEFAULT_WORKSPACE_CONFIG;
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));
  const searchParams = useSearchParams();

  const charts = evalSummary.charts ?? [];
  const {
    allRunRows,
    visibleRunRows,
    perChartData,
    completedRunCount,
    latestSummary,
    latestCases,
  } = useMemo(() => {
    const evalRuns = getRunsForEval(runs, evalSummary.key);
    const liveRun =
      currentRun &&
      runTargetsEvalLocal(currentRun.manifest.target, evalSummary.key)
        ? currentRun
        : null;

    const merged = evalRuns.filter(
      (r) => r.manifest.id !== liveRun?.manifest.id,
    );
    if (liveRun) {
      merged.unshift(liveRun);
    }

    const rows = buildEvalScopedRunRows(merged, evalSummary.key);

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
    evalSummary.key,
    evalSummary.columnDefs,
    isSingle,
    isStacked,
    charts,
  ]);

  const stats = evalSummary.stats ?? [];
  const statDisplays = stats
    .map((stat) => ({
      stat,
      display: computeStatDisplay(stat, {
        evalSummary,
        latestSummary,
        latestCases,
      }),
    }))
    .filter(({ stat, display }) => shouldShowStatDisplay(stat, display))
    .map(({ display }) => display);
  const visibleCharts = charts
    .map((config, index) => ({ config, data: perChartData[index] ?? [] }))
    .filter(
      ({ config, data }) =>
        config.hideIfNoValue !== true || chartHasNumericValue(config, data),
    );
  const chartLabels = visibleCharts.map(
    ({ config }, index) => config.heading ?? `Chart ${String(index + 1)}`,
  );
  const knownCaseIds = useMemo(() => {
    const fromSummary = evalSummary.caseIds ?? [];
    const sourceCaseIds =
      fromSummary.length > 0
        ? fromSummary
        : latestCases.map((caseRow) => caseRow.caseId);
    return [...new Set(sourceCaseIds)];
  }, [evalSummary.caseIds, latestCases]);
  const knownCases = useMemo(() => {
    const latestTagsByCaseId = new Map(
      latestCases.map((caseRow) => [caseRow.caseId, caseRow.tags ?? []]),
    );
    return knownCaseIds.map((caseId) => ({
      id: caseId,
      tags: latestTagsByCaseId.get(caseId) ?? evalSummary.tags ?? [],
    }));
  }, [evalSummary.tags, knownCaseIds, latestCases]);

  const isRunning =
    currentRun?.manifest.status === 'running' &&
    runTargetsEvalLocal(currentRun.manifest.target, evalSummary.key);
  const runningElapsedLabel = useElapsedRunTime(
    isRunning ? currentRun.manifest.startedAt : null,
  );
  const primaryRunIsTemporary = visibleRunRows[0]?.manifest.temporary === true;
  const hasScoreHistory =
    isSingle && visibleCharts.length > 0 && completedRunCount > 1;
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

  const requiresManualInput = evalSummary.manualInput !== undefined;
  const manualInputRun = useManualInputRun(evalSummary);

  function openCasePicker(cacheMode: CacheMode) {
    setCasePickerCacheMode(cacheMode);
    setCasePickerTemporary(true);
    setSelectedCaseIds(knownCaseIds);
    setCasePickerOpen(true);
  }

  function closeCasePicker() {
    setCasePickerOpen(false);
  }

  function toggleCaseId(caseId: string) {
    setSelectedCaseIds((current) =>
      current.includes(caseId)
        ? current.filter((selected) => selected !== caseId)
        : [...current, caseId],
    );
  }

  function startSelectedCaseRun() {
    if (selectedCaseIds.length === 0) return;
    setCasePickerOpen(false);
    void startRun(
      {
        mode: 'caseIds',
        evalKeys: [evalSummary.key],
        caseIds: selectedCaseIds,
      },
      { cacheMode: casePickerCacheMode, temporary: casePickerTemporary },
    );
  }
  function startEvalRun(
    cacheMode: 'use' | 'bypass' | 'refresh',
    temporary = false,
  ) {
    if (requiresManualInput) {
      manualInputRun.open(cacheMode, temporary);
      return;
    }
    void startRun(
      { mode: 'evalIds', evalKeys: [evalSummary.key] },
      { cacheMode, temporary },
    );
  }
  function handleRun(e: React.MouseEvent) {
    e.stopPropagation();
    startEvalRun('use', primaryRunIsTemporary);
  }
  function handleStop(e: React.MouseEvent) {
    e.stopPropagation();
    void cancelRun(currentRun?.manifest.id);
  }
  const cacheMenu: SplitButtonMenuEntry[] = [
    {
      id: 'run-default',
      label: 'Run',
      description: 'Run with default eval config',
      onSelect: () => startEvalRun('use'),
    },
    {
      id: 'run-temporary',
      label: 'Run temporary',
      description: 'Persist this run until the next run starts.',
      onSelect: () => startEvalRun('use', true),
    },
    ...(requiresManualInput
      ? []
      : [
          {
            id: 'run-specific-cases',
            label: 'Run specific cases',
            description: 'Choose which cases to execute.',
            onSelect: () => openCasePicker('use'),
          } satisfies SplitButtonMenuEntry,
        ]),
    {
      id: 'run-no-cache',
      label: 'Run without cache',
      description: 'Skip reads and writes for this run.',
      onSelect: () => startEvalRun('bypass'),
    },
    {
      id: 'run-refresh',
      label: 'Refresh cache',
      description: 'Force re-execution and overwrite entries.',
      onSelect: () => startEvalRun('refresh'),
    },
  ];
  async function handleRecomputeStatuses() {
    setMaintenanceAction('recompute');
    try {
      await recomputeStatusesForEval(evalSummary.key);
    } finally {
      setMaintenanceAction(null);
    }
  }

  async function handleCleanRuns() {
    setMaintenanceAction('clean');
    try {
      await cleanRunsForEval(evalSummary.key);
    } finally {
      setMaintenanceAction(null);
    }
  }

  async function handleClearCache() {
    setMaintenanceAction('clear-cache');
    try {
      await clearCacheForEval(evalSummary.key);
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
    await copyTextToClipboard(
      buildEvalRunCliCommand({
        packageManager: workspaceConfig.packageManager,
        evalId: evalSummary.id,
        filePath: evalSummary.filePath,
      }),
      'Copy CLI run command',
    );
  }

  async function handleCopyCliDebugCommand() {
    await copyTextToClipboard(
      buildEvalDebugCliCommand({
        packageManager: workspaceConfig.packageManager,
        evalId: evalSummary.id,
        filePath: evalSummary.filePath,
      }),
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
    ...(isSingle
      ? [
          {
            id: 'clear-cache',
            label: 'Clear cache for this eval',
            description: 'Remove cached entries recorded by saved runs.',
            tone: 'danger',
            onSelect: () => {
              if (!window.confirm('Clear cached entries for this eval?')) {
                return;
              }
              void handleClearCache();
            },
          } satisfies SplitButtonMenuEntry,
        ]
      : []),
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
                void openEvalInEditor(evalSummary.key);
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
                  <StatusBadge
                    status={displayStatus}
                    detail={
                      displayStatus === 'running'
                        ? (runningElapsedLabel ?? undefined)
                        : undefined
                    }
                  />
                </StatusWrap>
              </TitleRow>
              {isSingle ? null : (
                <FilePath title={evalSummary.filePath}>
                  {evalSummary.filePath}
                </FilePath>
              )}
              <TagChips tags={evalSummary.tags ?? []} />
            </TitleBlock>
          </HeaderLeft>
          <HeaderRight onClick={(e) => e.stopPropagation()}>
            {isStacked ? (
              <Tooltip content="Open eval page">
                <IconButton
                  aria-label="Open eval page"
                  onClick={() => selectEval(evalSummary.key)}
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
                label={primaryRunIsTemporary ? 'Temp run' : 'Run'}
                leftIcon={<Play />}
                onPrimaryClick={handleRun}
                menu={cacheMenu}
                aria-label={primaryRunIsTemporary ? 'Temp run' : 'Run'}
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
            <EvalHistorySection
              collapsed={scoreHistoryCollapsed}
              chartLabels={chartLabels}
              completedRunCount={completedRunCount}
              visibleCharts={visibleCharts}
              columnDefs={evalSummary.columnDefs}
              onToggle={() => setScoreHistoryCollapsed((v) => !v)}
            />
          ) : null}

          <Section fill={isSingle}>
            <EvalRunsSection
              key={visibleRunRows.map((run) => run.manifest.id).join(':')}
              runs={visibleRunRows}
              columnDefs={evalSummary.columnDefs}
              evalKey={evalSummary.key}
              isLoadingRuns={runHistoryResult.isLoading && runs.length === 0}
            />
          </Section>
        </Body>
      ) : null}
      <CasePickerModal
        isOpen={casePickerOpen}
        title="Run Specific Cases"
        subtitle={getEvalTitle(evalSummary)}
        cases={knownCases}
        selectedCaseIds={selectedCaseIds}
        cacheMode={casePickerCacheMode}
        temporary={casePickerTemporary}
        onCacheModeChange={setCasePickerCacheMode}
        onTemporaryChange={setCasePickerTemporary}
        onSelectedCaseIdsChange={setSelectedCaseIds}
        onToggleCaseId={toggleCaseId}
        onCancel={closeCasePicker}
        onRun={startSelectedCaseRun}
      />
      {requiresManualInput && evalSummary.manualInput ? (
        <ManualInputModal
          evalSummary={evalSummary}
          descriptor={evalSummary.manualInput}
          isOpen={manualInputRun.isOpen}
          onCancel={manualInputRun.cancel}
          onSubmit={manualInputRun.submit}
          serverFailure={manualInputRun.serverFailure}
          isSubmitting={manualInputRun.isSubmitting}
        />
      ) : null}
    </Card>
  );
}
