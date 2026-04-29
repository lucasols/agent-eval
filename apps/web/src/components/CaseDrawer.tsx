import {
  extractApiCalls,
  extractCacheEntries,
  extractLlmCalls,
  type CacheActivityEntry,
  type CellValue,
  type ColumnDef,
  type RunLogPhase,
} from '@agent-evals/shared';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { styled } from 'vindur';
import { ApiCallRow } from '#src/components/ApiCallRow';
import { CacheHitRow } from '#src/components/CacheHitRow';
import { CaseRunLogs, getLogPhases } from '#src/components/CaseRunLogs';
import { CaseScores } from '#src/components/CaseScores';
import { EmptyState } from '#src/components/EmptyState';
import {
  FormattedCellValue,
  hasRichColumnFormat,
  summarizeCellValue,
} from '#src/components/FormattedCellValue';
import { IconButton } from '#src/components/IconButton';
import { JsonViewer } from '#src/components/JsonViewer';
import { LlmCallRow } from '#src/components/LlmCallRow';
import { ResizeHandle } from '#src/components/ResizeHandle';
import { StatusBadge } from '#src/components/StatusBadge';
import { TraceTree } from '#src/components/TraceTree';
import { useResizableWidth } from '#src/hooks/useResizableWidth';
import {
  updateSearchParams,
  useSearchParams,
} from '#src/hooks/useSearchParams';
import { useWindowWidth } from '#src/hooks/useWindowWidth';
import { evalsStore } from '#src/stores/evalsStore';
import { layoutStore } from '#src/stores/layoutStore';
import { closeCase, runStore } from '#src/stores/runStore';
import { workspaceConfigStore } from '#src/stores/workspaceConfigStore';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatNumericCellValue } from '#src/utils/formatters';

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
  ${inline({ gap: 10, align: 'center' })}
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

const OutputContent = styled.div`
  font-size: 13px;
  color: ${colors.text.var};
`;

const ErrorContainer = styled.div`
  color: ${colors.error.var};
`;

const ErrorTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
`;

const ErrorStack = styled.pre`
  ${monoFont};
  font-size: 11px;
  white-space: pre-wrap;
  opacity: 0.8;
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  padding: 10px;
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
`;

const ScoringTraceSection = styled.section`
  ${stack({ gap: 10 })}
`;

const ScoringTraceHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const ScoringTraceTitle = styled.div`
  font-size: 12.5px;
  font-weight: 600;
  color: ${colors.text.var};
`;

const FailureList = styled.ul`
  ${stack({ gap: 10 })}
  list-style: none;
  padding: 0;
  margin: 0;
`;

const FailureItem = styled.li`
  ${stack({ gap: 6 })}
  padding: 12px;
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
`;

const FailureMessage = styled.div`
  color: ${colors.error.var};
  font-size: 12.5px;
  line-height: 1.5;
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

type CacheFilter = 'all' | 'hits' | 'added';

export function CaseDrawer() {
  const searchParams = useSearchParams();
  const [logPhaseFilter, setLogPhaseFilter] = useState<RunLogPhase | 'all'>(
    'all',
  );
  const [cacheFilter, setCacheFilter] = useState<CacheFilter>('all');
  const { selectedCaseDetail } = runStore.useSelectorRC((s) => ({
    selectedCaseDetail: s.selectedCaseDetail,
  }));
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const { sidebarWidth } = layoutStore.useSelectorRC((s) => ({
    sidebarWidth: s.sidebarWidth,
  }));
  const { llmCallsConfig, apiCallsConfig } = workspaceConfigStore.useSelectorRC(
    (s) => ({ llmCallsConfig: s.llmCalls, apiCallsConfig: s.apiCalls }),
  );
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

  if (!selectedCaseDetail) {
    return (
      <DrawerLoading style={{ width: `${width}px` }}>
        Loading case...
      </DrawerLoading>
    );
  }

  const d = selectedCaseDetail;
  const evalSummary = evals.find((e) => e.id === d.evalId);
  const columnDefs = evalSummary?.columnDefs ?? [];
  const hasOutputValue = columnDefs.some((columnDef) =>
    hasRenderableOutputValue(d.columns[columnDef.key]),
  );

  const scoreColumns = columnDefs.filter((c) => c.isScore === true);
  const scoringTraces = d.scoringTraces ?? {};
  const scoringTraceEntries = Object.entries(scoringTraces);
  const llmCallEntries = extractLlmCalls(d.trace, llmCallsConfig);
  const apiCallEntries = extractApiCalls(d.trace, apiCallsConfig);
  const cacheEntries = extractCacheEntries(d.trace, d.cacheRefs);
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
        {activeTab === 'input' ? <JsonViewer value={d.input} /> : null}

        {activeTab === 'output' ? (
          hasOutputValue ? (
            <OutputLayout>
              {columnDefs.map((c) => (
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
          />
        ) : null}

        {activeTab === 'llmCalls' ? (
          llmCallEntries.length > 0 ? (
            <LlmCallsList>
              {llmCallEntries.map((entry) => (
                <LlmCallRow
                  key={entry.id}
                  entry={entry}
                />
              ))}
            </LlmCallsList>
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
                <option value="all">All cache</option>
                <option value="hits">Hits</option>
                <option value="added">New entries</option>
              </CacheFilterSelect>
            </CacheToolbar>
            {filteredCacheEntries.length > 0 ? (
              <CacheEntriesList>
                {filteredCacheEntries.map((entry) => (
                  <CacheHitRow
                    key={entry.id}
                    entry={entry}
                  />
                ))}
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
                  <TraceTree
                    spans={scoreTrace.trace}
                    traceDisplay={scoreTrace.traceDisplay}
                  />
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
          <FailureList>
            {d.assertionFailures.map((failure, i) => (
              <FailureItem key={`${failure.message}-${String(i)}`}>
                <FailureMessage>{failure.message}</FailureMessage>
                {failure.stack ? (
                  <ErrorStack>{failure.stack}</ErrorStack>
                ) : null}
              </FailureItem>
            ))}
          </FailureList>
        ) : null}

        {activeTab === 'error' && d.error ? (
          <ErrorContainer>
            <ErrorTitle>
              {d.error.name ?? 'Error'}: {d.error.message}
            </ErrorTitle>
            {d.error.stack ? <ErrorStack>{d.error.stack}</ErrorStack> : null}
          </ErrorContainer>
        ) : null}
      </TabContent>
    </DrawerRoot>
  );
}

function hasRenderableOutputValue(value: CellValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  return true;
}

function filterCacheEntries(
  entries: CacheActivityEntry[],
  filter: CacheFilter,
): CacheActivityEntry[] {
  switch (filter) {
    case 'hits':
      return entries.filter((entry) => entry.action === 'hit');
    case 'added':
      return entries.filter((entry) => entry.action === 'added');
    case 'all':
      return entries;
  }
}

function parseCacheFilter(value: string): CacheFilter {
  if (value === 'hits' || value === 'added') return value;
  return 'all';
}

function ColumnCell({
  def,
  value,
}: {
  def: ColumnDef;
  value: CellValue | undefined;
}) {
  return (
    <OutputBlock>
      <OutputLabel>{def.label}</OutputLabel>
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

  if (hasRichColumnFormat(def) || typeof value === 'object') {
    return (
      <FormattedCellValue
        def={def}
        value={value}
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
