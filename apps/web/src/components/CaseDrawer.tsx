import type { CellValue, ColumnDef, DisplayBlock } from '@agent-evals/shared';
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
import {
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
} from '../utils/formatters.ts';
import { DisplayBlockRenderer } from './DisplayBlockRenderer.tsx';
import { IconButton } from './IconButton.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import { JsonViewer } from './JsonViewer.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { TraceTree } from './TraceTree.tsx';

type Tab = 'input' | 'output' | 'trace' | 'raw' | 'failures' | 'error';

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
  padding: 16px;
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

const ColumnsGrid = styled.div`
  ${stack({ gap: 8 })}
  margin-top: 12px;
`;

const ColumnRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  padding: 10px 12px;
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
`;

const ColumnLabel = styled.div`
  ${kicker}
  color: ${colors.textMuted.var};
`;

const ColumnValueText = styled.div`
  ${monoFont};
  font-size: 12px;
  color: ${colors.text.var};
  text-align: right;
  max-width: 60%;
  word-break: break-all;
`;

const ScoreFail = styled.span`
  color: ${colors.error.var};
`;

const ScorePass = styled.span`
  color: ${colors.success.var};
`;

const FailureList = styled.ul`
  ${stack({ gap: 6 })}
  list-style: disc inside;
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
  const primaryCol = columnDefs.find((c) => c.primary);

  const tabs: Tab[] = ['input', 'output', 'trace', 'raw'];
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
              aria-label={isExpanded ? 'Collapse case drawer' : 'Expand case drawer'}
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
          <div>
            {primaryCol ? (
              <PrimaryBlocks value={d.columns[primaryCol.key]} />
            ) : null}
            <ColumnsGrid>
              {columnDefs
                .filter((c) => !c.primary)
                .map((c) => (
                  <ColumnCell
                    key={c.key}
                    def={c}
                    value={d.columns[c.key]}
                  />
                ))}
            </ColumnsGrid>
          </div>
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
            {d.assertionFailures.map((msg, i) => (
              <li key={i}>{msg}</li>
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

function PrimaryBlocks({ value }: { value: CellValue | undefined }) {
  if (!Array.isArray(value)) {
    return value === undefined ? '\u2014' : <JsonViewer value={value} />;
  }
  return (
    <div>
      {value.map((block: DisplayBlock, i) => (
        <DisplayBlockRenderer
          key={i}
          block={block}
        />
      ))}
    </div>
  );
}

function ColumnCell({
  def,
  value,
}: {
  def: ColumnDef;
  value: CellValue | undefined;
}) {
  return (
    <ColumnRow>
      <ColumnLabel>{def.label}</ColumnLabel>
      <ColumnValueText>{renderCellValue(def, value)}</ColumnValueText>
    </ColumnRow>
  );
}

function renderCellValue(def: ColumnDef, value: CellValue | undefined) {
  if (value === undefined || value === null) return '\u2014';

  if (def.isScore && typeof value === 'number') {
    const passed =
      def.passThreshold === undefined ? true : value >= def.passThreshold;
    return passed ? (
      <ScorePass>{formatScore(value)}</ScorePass>
    ) : (
      <ScoreFail>{formatScore(value)}</ScoreFail>
    );
  }

  if (typeof value === 'number') {
    if (def.format === 'usd') return formatCost(value);
    if (def.format === 'duration') return formatDuration(value);
    if (def.format === 'percent') return formatPercent(value);
    return formatScore(value);
  }

  if (Array.isArray(value)) {
    return `${String(value.length)} block(s)`;
  }

  return String(value);
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
