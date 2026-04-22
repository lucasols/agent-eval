import type { CellValue, ColumnDef } from '@agent-evals/shared';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useRef } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { useResizableWidth } from '../hooks/useResizableWidth.ts';
import {
  updateSearchParams,
  useSearchParams,
} from '../hooks/useSearchParams.ts';
import { useWindowWidth } from '../hooks/useWindowWidth.ts';
import { evalsStore } from '../stores/evalsStore.ts';
import { layoutStore } from '../stores/layoutStore.ts';
import { closeCase, runStore } from '../stores/runStore.ts';
import { formatScore } from '../utils/formatters.ts';
import { EmptyState } from './EmptyState.tsx';
import {
  FormattedCellValue,
  hasRichColumnFormat,
  summarizeCellValue,
} from './FormattedCellValue.tsx';
import { IconButton } from './IconButton.tsx';
import { JsonViewer } from './JsonViewer.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { TraceTree } from './TraceTree.tsx';

type Tab =
  | 'input'
  | 'output'
  | 'scores'
  | 'trace'
  | 'raw'
  | 'failures'
  | 'error';

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
  ${kicker}
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
  text-transform: capitalize;

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
  ${kicker}
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

const ScoresList = styled.div`
  ${stack({ gap: 12 })}
`;

const ScoreRow = styled.div`
  ${stack({ gap: 8 })}
  padding: 12px 14px;
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
`;

const ScoreRowHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const ScoreRowLabel = styled.div`
  font-size: 12.5px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.005em;
`;

const ScoreRowValue = styled.span`
  ${monoFont};
  font-size: 13px;
  font-weight: 500;
  color: ${colors.text.var};
`;

const ScoreBar = styled.div`
  position: relative;
  height: 6px;
  border-radius: 4px;
  background: ${colors.surface.var};
  overflow: hidden;
`;

const ScoreBarFill = styled.div<{ pass: boolean; fail: boolean }>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  background: ${colors.textDim.var};

  &.pass {
    background: ${colors.success.var};
  }
  &.fail {
    background: ${colors.error.var};
  }
`;

const ScoreRowMeta = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const ScoreStatusTag = styled.span<{ pass: boolean; fail: boolean }>`
  ${kicker};
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  line-height: 1.2;

  &.pass {
    background: ${colors.success.alpha(0.12)};
    color: ${colors.success.var};
  }
  &.fail {
    background: ${colors.error.alpha(0.12)};
    color: ${colors.error.var};
  }
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
    case 'raw':
    case 'failures':
    case 'error':
      return value;
    default:
      return null;
  }
}

export function CaseDrawer() {
  const searchParams = useSearchParams();
  const { selectedCaseDetail } = runStore.useSelectorRC((s) => ({
    selectedCaseDetail: s.selectedCaseDetail,
  }));
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const { sidebarWidth } = layoutStore.useSelectorRC((s) => ({
    sidebarWidth: s.sidebarWidth,
  }));
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
  const tabs: Tab[] = ['input', 'output'];
  if (scoreColumns.length > 0) tabs.push('scores');
  tabs.push('trace', 'raw');
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
            {tab}
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
          <ScoresList>
            {scoreColumns.map((c) => {
              const raw = d.columns[c.key];
              const value =
                typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
              const threshold = c.passThreshold;
              const pass =
                value !== null && threshold !== undefined && value >= threshold;
              const fail =
                value !== null && threshold !== undefined && value < threshold;
              const fillWidth =
                value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
              return (
                <ScoreRow key={c.key}>
                  <ScoreRowHeader>
                    <ScoreRowLabel>{c.label}</ScoreRowLabel>
                    <ScoreRowValue>
                      {value === null ? '\u2014' : formatScore(value)}
                    </ScoreRowValue>
                  </ScoreRowHeader>
                  {value !== null ? (
                    <ScoreBar>
                      <ScoreBarFill
                        pass={pass}
                        fail={fail}
                        style={{ width: `${fillWidth}%` }}
                      />
                    </ScoreBar>
                  ) : null}
                  <ScoreRowMeta>
                    {threshold !== undefined ? (
                      <ScoreStatusTag
                        pass={pass}
                        fail={fail}
                      >
                        {value === null ? 'NO VALUE' : pass ? 'PASS' : 'FAIL'}
                      </ScoreStatusTag>
                    ) : (
                      <ScoreStatusTag
                        pass={false}
                        fail={false}
                      >
                        INFO
                      </ScoreStatusTag>
                    )}
                    {threshold !== undefined ? (
                      <span>threshold {formatScore(threshold)}</span>
                    ) : (
                      <span>informational</span>
                    )}
                  </ScoreRowMeta>
                </ScoreRow>
              );
            })}
          </ScoresList>
        ) : null}

        {activeTab === 'trace' ? (
          <TraceTree
            spans={d.trace}
            traceDisplay={d.traceDisplay}
          />
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
          <ScorePass>{formatScore(value)}</ScorePass>
        ) : (
          <ScoreFail>{formatScore(value)}</ScoreFail>
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
