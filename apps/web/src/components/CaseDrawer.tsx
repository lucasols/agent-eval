import {
  extractApiCalls,
  extractLlmCalls,
  type CellValue,
  type ColumnDef,
  type LlmCostScenario,
  type RunLogPhase,
} from '@agent-evals/shared';
import { useActionFn } from '@ls-stack/react-utils/useActionFn';
import { Maximize2, Minimize2, TriangleAlert, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { styled } from 'vindur';
import { ApiCallRow } from '#src/components/ApiCallRow';
import { CacheHitRow } from '#src/components/CacheHitRow';
import { CaseRunLogs, getLogPhases } from '#src/components/CaseRunLogs';
import { CaseScores } from '#src/components/CaseScores';
import { EmptyState } from '#src/components/EmptyState';
import {
  ErrorDetails,
  type ErrorDetailItem,
} from '#src/components/ErrorDetails';
import {
  FormattedCellValue,
  hasRichColumnFormat,
  summarizeCellValue,
} from '#src/components/FormattedCellValue';
import { IconButton } from '#src/components/IconButton';
import { InputViewer } from '#src/components/InputViewer';
import { JsonViewer } from '#src/components/JsonViewer';
import { LlmCallRow } from '#src/components/LlmCallRow';
import { LlmCostScenarioToolbar } from '#src/components/LlmCostScenarioToolbar';
import { LoadingLine } from '#src/components/LoadingState';
import { MenuButton } from '#src/components/MenuButton';
import { ResizeHandle } from '#src/components/ResizeHandle';
import type { SplitButtonMenuEntry } from '#src/components/SplitButton';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
import { TraceTree } from '#src/components/TraceTree';
import { useResizableWidth } from '#src/hooks/useResizableWidth';
import {
  updateSearchParams,
  useSearchParams,
} from '#src/hooks/useSearchParams';
import { useWindowWidth } from '#src/hooks/useWindowWidth';
import { evalSummariesStore } from '#src/stores/evalsStore';
import { layoutStore } from '#src/stores/layoutStore';
import {
  caseDetailStore,
  closeCase,
  recalculateDerivedAttributesForCase,
  runStore,
} from '#src/stores/runStore';
import {
  DEFAULT_WORKSPACE_CONFIG,
  workspaceConfigStore,
} from '#src/stores/workspaceConfigStore';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import {
  getScopedCacheActivityEntries,
  type ScopedCacheActivityEntry,
} from '#src/utils/cacheActivity';
import { formatNumericCellValue } from '#src/utils/formatters';
import {
  findDiagnosticOutputMatch,
  formatDiagnosticOutputTooltip,
} from '#src/utils/outputDiagnostics';
import {
  getDisplayColumnLabel,
  mergeRuntimeColumnDefs,
} from '#src/utils/runtimeColumnDefs';

type Tab =
  | 'input'
  | 'output'
  | 'scores'
  | 'trace'
  | 'logs'
  | 'llmCalls'
  | 'apiCalls'
  | 'cache'
  | 'scoring'
  | 'raw'
  | 'failures'
  | 'error';

const TAB_LABELS: Record<Tab, string> = {
  input: 'Input',
  output: 'Output',
  scores: 'Scores',
  trace: 'Trace',
  logs: 'Logs',
  llmCalls: 'LLM calls',
  apiCalls: 'API calls',
  cache: 'Cache',
  scoring: 'Scoring',
  raw: 'Raw',
  failures: 'Failures',
  error: 'Error',
};

const DrawerLoading = styled.div`
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textMuted.var};
  font-size: 12px;
  flex-shrink: 0;
`;

const DrawerError = styled(DrawerLoading)`
  color: ${colors.error.var};
  padding: 20px;
  text-align: center;
`;

const DrawerRoot = styled.div`
  ${stack()}
  position: relative;
  flex-shrink: 0;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
`;

const Header = styled.div`
  ${stack({ gap: 10 })}
  padding: 14px 18px 12px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  flex-shrink: 0;
`;

const HeaderTop = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const HeaderActions = styled.div`
  ${inline({ align: 'center', gap: 2 })}
`;

const HeaderKicker = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const HeaderTitleRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
  min-width: 0;
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  min-width: 0;
`;

const CaseId = styled.span`
  ${monoFont};
  font-size: 17px;
  color: ${colors.text.var};
  font-weight: 600;
  letter-spacing: -0.01em;
`;

const TabBar = styled.div`
  ${inline({ gap: 4 })}
  border-bottom: 1px solid ${colors.border.var};
  padding: 10px 14px 0;
  flex-shrink: 0;
  overflow-x: auto;
`;

const TabButton = styled.button<{ active: boolean }>`
  position: relative;
  padding: 8px 12px;
  background: transparent;
  border: none;
  font-size: 12px;
  font-weight: 500;
  color: ${colors.textMuted.var};
  white-space: nowrap;
  margin-bottom: -1px;
  border-bottom: 1.5px solid transparent;

  &:hover {
    color: ${colors.text.var};
  }

  &.active {
    color: ${colors.text.var};
    border-bottom-color: ${colors.accent.var};
  }
`;

const TabContent = styled.div`
  flex: 1;
  overflow: auto;
  padding: 18px 20px;
`;

const OutputLayout = styled.div`
  ${stack()}
`;

const OutputBlock = styled.div`
  ${stack({ gap: 8 })}
  padding: 14px 0;
  border-bottom: 1px solid ${colors.border.var};

  &:first-child {
    padding-top: 0;
  }

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
`;

const OutputLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const OutputLabelRow = styled.div`
  ${inline({ align: 'center', gap: 6 })}
`;

const OutputWarningIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${colors.warning.var};
  flex-shrink: 0;

  & > svg {
    width: 12px;
    height: 12px;
    stroke-width: 2.5;
  }
`;

const OutputContent = styled.div`
  font-size: 13px;
  color: ${colors.text.var};
`;

const RawSections = styled.div`
  ${stack({ gap: 14 })}
`;

const RawLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
  margin-bottom: 8px;
`;

const ScalarValue = styled.div`
  ${monoFont};
  font-size: 13px;
  color: ${colors.text.var};
  white-space: pre-wrap;
  word-break: break-word;
`;

const ScoreFail = styled.span`
  color: ${colors.error.var};
`;

const ScorePass = styled.span`
  color: ${colors.success.var};
`;

const ScoringTraceList = styled.div`
  ${stack({ gap: 18 })}
  height: 100%;
  min-height: 320px;
`;

const ScoringTraceSection = styled.section`
  ${stack({ gap: 10 })}
  flex: 1 1 360px;
  min-height: 280px;
`;

const ScoringTraceHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const ScoringTraceTitle = styled.div`
  font-size: 12.5px;
  font-weight: 600;
  color: ${colors.text.var};
`;

const ScoringTraceFrame = styled.div`
  flex: 1;
  min-height: 0;
`;

const LlmCallsList = styled.div`
  ${stack({ gap: 8 })}
`;

const ApiCallsList = styled.div`
  ${stack({ gap: 8 })}
`;

const CacheToolbar = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
  margin-bottom: 12px;
`;

const CacheCount = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const CacheFilterSelect = styled.select`
  height: 28px;
  min-width: 150px;
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

const CacheEntriesList = styled.div`
  ${stack({ gap: 8 })}
`;

function resolveActiveTab(
  requestedTab: string | null,
  availableTabs: Tab[],
): Tab {
  if (!requestedTab) return 'input';
  const requested = parseTab(requestedTab);
  if (!requested) return 'input';
  return availableTabs.includes(requested) ? requested : 'input';
}

function parseTab(value: string): Tab | null {
  switch (value) {
    case 'input':
    case 'output':
    case 'scores':
    case 'trace':
    case 'logs':
    case 'llmCalls':
    case 'apiCalls':
    case 'cache':
    case 'scoring':
    case 'raw':
    case 'failures':
    case 'error':
      return value;
    case 'cacheHits':
      return 'cache';
    default:
      return null;
  }
}

type CacheFilter =
  | 'execute'
  | 'all'
  | 'hits'
  | 'added'
  | 'scoringHits'
  | 'scoringAdded';

export function CaseDrawer() {
  const searchParams = useSearchParams();
  const [logPhaseFilter, setLogPhaseFilter] = useState<RunLogPhase | 'all'>(
    'all',
  );
  const [cacheFilter, setCacheFilter] = useState<CacheFilter>('execute');
  const [costScenario, setCostScenario] = useState<LlmCostScenario>('actual');
  const { selectedCaseRunId, selectedCaseId } = runStore.useSelectorRC((s) => ({
    selectedCaseRunId: s.selectedCaseRunId,
    selectedCaseId: s.selectedCaseId,
  }));
  const selectedCaseResult = caseDetailStore.useItem(
    selectedCaseRunId === null || selectedCaseId === null
      ? null
      : { runId: selectedCaseRunId, caseId: selectedCaseId },
  );
  const selectedCaseDetail = selectedCaseResult.data;
  const evals = evalSummariesStore.useDocument().data ?? [];
  const { sidebarWidth } = layoutStore.useSelectorRC((s) => ({
    sidebarWidth: s.sidebarWidth,
  }));
  const workspaceConfig =
    workspaceConfigStore.useDocument().data ?? DEFAULT_WORKSPACE_CONFIG;
  const workspaceRoot = workspaceConfig.workspaceRoot;
  const llmCallsConfig = workspaceConfig.llmCalls;
  const apiCallsConfig = workspaceConfig.apiCalls;
  const windowWidth = useWindowWidth();
  const minWidth = 360;
  const maxWidth = Math.max(minWidth, windowWidth - sidebarWidth);
  const {
    width,
    dragging,
    rootRef,
    handlePointerDown,
    handleDoubleClick,
    setWidth,
  } = useResizableWidth<HTMLDivElement>({
    storageKey: 'agent-evals.case-drawer-width',
    minWidth,
    maxWidth,
    defaultWidth: 540,
    edge: 'left',
  });

  const preExpandWidthRef = useRef<number | null>(null);
  const isExpanded = width >= maxWidth;

  function toggleExpand() {
    if (isExpanded) {
      const previous = preExpandWidthRef.current ?? 540;
      preExpandWidthRef.current = null;
      setWidth(previous);
    } else {
      preExpandWidthRef.current = width;
      setWidth(maxWidth);
    }
  }

  const recalculateDerivedAttributesAction = useActionFn(async () => {
    if (selectedCaseRunId === null || selectedCaseId === null) return;
    await recalculateDerivedAttributesForCase({
      runId: selectedCaseRunId,
      caseId: selectedCaseId,
    });
  });

  if (selectedCaseResult.error !== null && selectedCaseDetail === null) {
    return (
      <DrawerError style={{ width: `${width}px` }}>
        {selectedCaseResult.error.message}
      </DrawerError>
    );
  }

  if (!selectedCaseDetail) {
    return (
      <DrawerLoading style={{ width: `${width}px` }}>
        <LoadingLine>Loading case</LoadingLine>
      </DrawerLoading>
    );
  }

  const d = selectedCaseDetail;
  const evalSummary = evals.find((e) => e.key === (d.evalKey ?? d.evalId));
  const columnDefs = mergeRuntimeColumnDefs(
    evalSummary?.columnDefs ?? [],
    d.columns,
  );
  const outputColumnDefs = orderOutputColumnDefs(columnDefs, d.columns);
  const hasOutputValue = outputColumnDefs.some((columnDef) =>
    hasRenderableOutputValue(d.columns[columnDef.key]),
  );

  const scoreColumns = columnDefs.filter((c) => c.isScore === true);
  const scoringTraces = d.scoringTraces ?? {};
  const scoringTraceEntries = Object.entries(scoringTraces);
  const llmCallEntries = extractLlmCalls(d.trace, llmCallsConfig);
  const apiCallEntries = extractApiCalls(d.trace, apiCallsConfig);
  const cacheEntries = getScopedCacheActivityEntries({
    caseDetail: d,
    scoreLabels: scoreColumns.map((scoreColumn) => ({
      key: scoreColumn.key,
      label: scoreColumn.label,
    })),
  });
  const filteredCacheEntries = filterCacheEntries(cacheEntries, cacheFilter);
  const logPhases = getLogPhases(d.logs);
  const selectedLogPhase =
    logPhaseFilter === 'all' || logPhases.includes(logPhaseFilter)
      ? logPhaseFilter
      : 'all';
  const filteredLogs =
    selectedLogPhase === 'all'
      ? d.logs
      : d.logs.filter((entry) => entry.phase === selectedLogPhase);
  const tabs: Tab[] = ['input', 'output'];
  if (scoreColumns.length > 0) tabs.push('scores');
  tabs.push('trace');
  if (d.logs.length > 0) tabs.push('logs');
  if (llmCallEntries.length > 0) tabs.push('llmCalls');
  if (apiCallEntries.length > 0) tabs.push('apiCalls');
  if (cacheEntries.length > 0) tabs.push('cache');
  if (scoringTraceEntries.length > 0) tabs.push('scoring');
  tabs.push('raw');
  if (d.assertionFailures.length > 0) tabs.push('failures');
  if (d.error) tabs.push('error');
  const activeTab = resolveActiveTab(searchParams.get('caseTab'), tabs);
  const menuEntries: SplitButtonMenuEntry[] = [
    {
      id: 'recalculate-derived-attributes',
      label: 'Recalculate derived attributes',
      description: 'Update this saved trace from the current call config.',
      onSelect: () => {
        void recalculateDerivedAttributesAction.call();
      },
    },
  ];

  return (
    <DrawerRoot
      ref={rootRef}
      style={{ width: `${width}px` }}
    >
      <ResizeHandle
        dragging={dragging}
        edge="left"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      />
      <Header>
        <HeaderTop>
          <HeaderKicker>Case</HeaderKicker>
          <HeaderActions>
            <IconButton
              onClick={toggleExpand}
              aria-label={
                isExpanded ? 'Collapse case drawer' : 'Expand case drawer'
              }
              aria-pressed={isExpanded}
            >
              {isExpanded ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
            <IconButton
              onClick={closeCase}
              aria-label="Close"
            >
              <X />
            </IconButton>
          </HeaderActions>
        </HeaderTop>
        <HeaderTitleRow>
          <HeaderLeft>
            <CaseId>{d.caseId}</CaseId>
            <StatusBadge status={d.status} />
          </HeaderLeft>
          <MenuButton
            menu={menuEntries}
            disabled={recalculateDerivedAttributesAction.isInProgress}
            aria-label="Case actions"
          />
        </HeaderTitleRow>
      </Header>

      <TabBar>
        {tabs.map((tab) => (
          <TabButton
            key={tab}
            onClick={() => {
              updateSearchParams((nextSearchParams) => {
                nextSearchParams.set('caseTab', tab);
              });
            }}
            active={activeTab === tab}
          >
            {TAB_LABELS[tab]}
          </TabButton>
        ))}
      </TabBar>

      <TabContent>
        {activeTab === 'input' ? <InputViewer value={d.input} /> : null}

        {activeTab === 'output' ? (
          hasOutputValue ? (
            <OutputLayout>
              {outputColumnDefs.map((c) => (
                <ColumnCell
                  key={c.key}
                  def={c}
                  value={d.columns[c.key]}
                />
              ))}
            </OutputLayout>
          ) : (
            <EmptyState
              title="No output recorded"
              description="This case run did not produce any output values to display."
            />
          )
        ) : null}

        {activeTab === 'scores' ? (
          <CaseScores
            scoreColumns={scoreColumns}
            columns={d.columns}
          />
        ) : null}

        {activeTab === 'trace' ? (
          <TraceTree
            spans={d.trace}
            traceDisplay={d.traceDisplay}
          />
        ) : null}

        {activeTab === 'logs' ? (
          <CaseRunLogs
            logs={filteredLogs}
            phases={logPhases}
            selectedPhase={selectedLogPhase}
            onPhaseChange={setLogPhaseFilter}
            workspaceRoot={workspaceRoot}
          />
        ) : null}

        {activeTab === 'llmCalls' ? (
          llmCallEntries.length > 0 ? (
            <>
              <LlmCostScenarioToolbar
                scenario={costScenario}
                onChange={setCostScenario}
              />
              <LlmCallsList>
                {llmCallEntries.map((entry) => (
                  <LlmCallRow
                    key={entry.id}
                    entry={entry}
                    costCurrencies={llmCallsConfig.costCurrencies}
                    scenario={costScenario}
                    pricing={llmCallsConfig.pricing}
                  />
                ))}
              </LlmCallsList>
            </>
          ) : (
            <EmptyState
              title="No LLM calls"
              description="No spans matched the configured LLM call kinds in this case run."
            />
          )
        ) : null}

        {activeTab === 'apiCalls' ? (
          apiCallEntries.length > 0 ? (
            <ApiCallsList>
              {apiCallEntries.map((entry) => (
                <ApiCallRow
                  key={entry.id}
                  entry={entry}
                />
              ))}
            </ApiCallsList>
          ) : (
            <EmptyState
              title="No API calls"
              description="No spans matched the configured API call kinds in this case run."
            />
          )
        ) : null}

        {activeTab === 'cache' ? (
          <>
            <CacheToolbar>
              <CacheCount>
                {String(filteredCacheEntries.length)} entries
              </CacheCount>
              <CacheFilterSelect
                value={cacheFilter}
                onChange={(event) => {
                  setCacheFilter(parseCacheFilter(event.currentTarget.value));
                }}
                aria-label="Filter cache entries"
              >
                <option value="execute">All execute cache</option>
                <option value="all">All cache</option>
                <option value="hits">Hits</option>
                <option value="added">New entries</option>
                <option value="scoringHits">Scoring hits</option>
                <option value="scoringAdded">Scoring new entries</option>
              </CacheFilterSelect>
            </CacheToolbar>
            {filteredCacheEntries.length > 0 ? (
              <CacheEntriesList>
                {filteredCacheEntries.map((scopedEntry) => {
                  const cacheIndex = cacheEntries.findIndex(
                    (cacheEntry) => cacheEntry.id === scopedEntry.id,
                  );
                  return (
                    <CacheHitRow
                      key={scopedEntry.id}
                      entry={scopedEntry.entry}
                      phase={scopedEntry.phase}
                      currentRunId={selectedCaseRunId ?? ''}
                      currentCaseKey={d.caseKey ?? d.caseId}
                      currentEvalKey={d.evalKey ?? d.evalId}
                      currentCacheIndex={cacheIndex < 0 ? 0 : cacheIndex}
                    />
                  );
                })}
              </CacheEntriesList>
            ) : (
              <EmptyState
                title="No cache entries"
                description="No cache activity matched this filter for the case run."
              />
            )}
          </>
        ) : null}

        {activeTab === 'scoring' ? (
          <ScoringTraceList>
            {scoringTraceEntries.map(([scoreKey, scoreTrace]) => {
              const scoreColumn = scoreColumns.find((c) => c.key === scoreKey);
              return (
                <ScoringTraceSection key={scoreKey}>
                  <ScoringTraceHeader>
                    <ScoringTraceTitle>
                      {scoreColumn?.label ?? scoreKey}
                    </ScoringTraceTitle>
                  </ScoringTraceHeader>
                  <ScoringTraceFrame>
                    <TraceTree
                      spans={scoreTrace.trace}
                      traceDisplay={scoreTrace.traceDisplay}
                    />
                  </ScoringTraceFrame>
                </ScoringTraceSection>
              );
            })}
          </ScoringTraceList>
        ) : null}

        {activeTab === 'raw' ? (
          <RawSections>
            <RawSection
              label="Input"
              data={d.input}
            />
            <RawSection
              label="Columns"
              data={d.columns}
            />
            <RawSection
              label="Trace"
              data={d.trace}
            />
            <RawSection
              label="Logs"
              data={d.logs}
            />
            <RawSection
              label="Scoring Traces"
              data={scoringTraces}
            />
          </RawSections>
        ) : null}

        {activeTab === 'failures' ? (
          <ErrorDetails
            label={
              d.assertionFailures.length === 1
                ? 'Assertion failure'
                : 'Assertion failures'
            }
            errors={d.assertionFailures.map((failure, index) =>
              toFailureDetailItem(failure, index),
            )}
          />
        ) : null}

        {activeTab === 'error' && d.error ? (
          <ErrorDetails
            label="Case error"
            errors={[
              {
                id: 'case-error',
                name: d.error.name,
                message: d.error.message,
                meta: undefined,
                stack: d.error.stack,
                attributes: undefined,
              },
            ]}
          />
        ) : null}
      </TabContent>
    </DrawerRoot>
  );
}

const hasRenderableOutputValue = (value: CellValue | undefined): boolean =>
  value !== undefined && value !== null;

function toFailureDetailItem(
  failure: { name?: string | undefined; message: string; stack?: string },
  index: number,
): ErrorDetailItem {
  return {
    id: `failure-${String(index)}-${failure.message}`,
    name: failure.name,
    message: failure.message,
    meta: undefined,
    stack: failure.stack,
    attributes: undefined,
  };
}

function orderOutputColumnDefs(
  columnDefs: ColumnDef[],
  columns: Record<string, CellValue>,
): ColumnDef[] {
  return columnDefs.toSorted(
    (a, b) =>
      Number(!hasRenderableOutputValue(columns[a.key])) -
      Number(!hasRenderableOutputValue(columns[b.key])),
  );
}

function filterCacheEntries(
  entries: ScopedCacheActivityEntry[],
  filter: CacheFilter,
): ScopedCacheActivityEntry[] {
  switch (filter) {
    case 'execute':
      return entries.filter((entry) => entry.phase.kind === 'case');
    case 'hits':
      return entries.filter((entry) => entry.entry.action === 'hit');
    case 'added':
      return entries.filter((entry) => entry.entry.action === 'added');
    case 'scoringHits':
      return entries.filter(
        (entry) =>
          entry.phase.kind === 'scoring' && entry.entry.action === 'hit',
      );
    case 'scoringAdded':
      return entries.filter(
        (entry) =>
          entry.phase.kind === 'scoring' && entry.entry.action === 'added',
      );
    case 'all':
      return entries;
  }
}

function parseCacheFilter(value: string): CacheFilter {
  if (
    value === 'execute' ||
    value === 'hits' ||
    value === 'added' ||
    value === 'scoringHits' ||
    value === 'scoringAdded'
  ) {
    return value;
  }

  return 'all';
}

function ColumnCell({
  def,
  value,
}: {
  def: ColumnDef;
  value: CellValue | undefined;
}) {
  const label = getDisplayColumnLabel(def);
  const diagnosticMatch = findDiagnosticOutputMatch(value, def.key);
  return (
    <OutputBlock>
      <OutputLabelRow>
        <OutputLabel>{label}</OutputLabel>
        {diagnosticMatch !== undefined ? (
          <Tooltip
            content={formatDiagnosticOutputTooltip(diagnosticMatch, label)}
          >
            <OutputWarningIcon
              aria-label={`Output contains ${diagnosticMatch.key} key`}
            >
              <TriangleAlert />
            </OutputWarningIcon>
          </Tooltip>
        ) : null}
      </OutputLabelRow>
      <OutputContent>{renderColumnValue(def, value)}</OutputContent>
    </OutputBlock>
  );
}

function renderColumnValue(def: ColumnDef, value: CellValue | undefined) {
  if (value === undefined || value === null) {
    return <ScalarValue>{'\u2014'}</ScalarValue>;
  }

  if (def.isScore && typeof value === 'number') {
    const passed =
      def.passThreshold === undefined ? true : value >= def.passThreshold;
    return (
      <ScalarValue>
        {passed ? (
          <ScorePass>{formatNumericCellValue(def, value)}</ScorePass>
        ) : (
          <ScoreFail>{formatNumericCellValue(def, value)}</ScoreFail>
        )}
      </ScalarValue>
    );
  }

  if (
    hasRichColumnFormat(def) ||
    typeof value === 'object' ||
    typeof value === 'string'
  ) {
    return (
      <FormattedCellValue
        def={def}
        value={value}
        inferMarkdown
        markdownRawToggle
      />
    );
  }

  return <ScalarValue>{summarizeCellValue(def, value)}</ScalarValue>;
}

function RawSection({ label, data }: { label: string; data: unknown }) {
  return (
    <div>
      <RawLabel>{label}</RawLabel>
      <JsonViewer
        value={data}
        compact
        maxHeight="raw"
        collapsed={6}
      />
    </div>
  );
}
