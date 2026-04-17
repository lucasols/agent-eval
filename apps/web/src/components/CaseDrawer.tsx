import { useState } from 'react';
import { styled } from 'vindur';
import { X } from 'lucide-react';
import type { CellValue, ColumnDef, DisplayBlock } from '@agent-evals/shared';
import { colors } from '#src/style/colors';
import { inline, monoFont, sansFont, stack } from '#src/style/helpers';
import { closeCase, runStore } from '../stores/runStore.ts';
import { evalsStore } from '../stores/evalsStore.ts';
import { DisplayBlockRenderer } from './DisplayBlockRenderer.tsx';
import { TraceTree } from './TraceTree.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { IconButton } from './IconButton.tsx';
import {
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
} from '../utils/formatters.ts';

type Tab = 'input' | 'output' | 'trace' | 'raw' | 'failures' | 'error';

const DrawerLoading = styled.div`
  width: 540px;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
`;

const DrawerRoot = styled.div`
  ${stack()}
  width: 540px;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
  box-shadow: -16px 0 40px -20px ${colors.black.alpha(0.15)};
`;

const Header = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
  height: 52px;
  padding: 0 14px 0 20px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  flex-shrink: 0;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: ${colors.accent.var};
  }
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  min-width: 0;
`;

const CaseId = styled.span`
  ${monoFont}
  font-size: 13px;
  color: ${colors.text.var};
  font-weight: 700;
  letter-spacing: -0.005em;
`;

const TabBar = styled.div`
  ${inline({ gap: 0 })}
  border-bottom: 1px solid ${colors.border.var};
  padding: 0 12px;
  flex-shrink: 0;
  overflow-x: auto;
  background: ${colors.bg.alpha(0.3)};
`;

const TabButton = styled.button<{ active: boolean }>`
  ${sansFont}
  position: relative;
  padding: 11px 14px;
  background: transparent;
  border: none;
  font-size: 10px;
  font-weight: 700;
  color: ${colors.textDim.var};
  text-transform: uppercase;
  letter-spacing: 0.2em;
  white-space: nowrap;

  &:hover {
    color: ${colors.textMuted.var};
  }

  &.active {
    color: ${colors.accent.var};
  }

  &.active::after {
    content: '';
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: -1px;
    height: 2px;
    background: ${colors.accent.var};
  }
`;

const TabContent = styled.div`
  flex: 1;
  overflow: auto;
  padding: 16px;
`;

const OutputPre = styled.pre`
  ${monoFont}
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  padding: 10px;
`;

const ErrorContainer = styled.div`
  color: ${colors.error.var};
`;

const ErrorTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
`;

const ErrorStack = styled.pre`
  ${monoFont}
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
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${colors.textDim.var};
  margin-bottom: 6px;
`;

const RawPre = styled.pre`
  ${monoFont}
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  background: ${colors.surface.var};
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid ${colors.border.var};
  max-height: 320px;
  overflow: auto;
`;

const ColumnsGrid = styled.div`
  ${stack({ gap: 8 })}
  margin-top: 12px;
`;

const ColumnRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  padding: 8px 10px;
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
`;

const ColumnLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${colors.textDim.var};
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const ColumnValueText = styled.div`
  ${monoFont}
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

export function CaseDrawer() {
  const { selectedCaseDetail } = runStore.useSelectorRC((s) => ({
    selectedCaseDetail: s.selectedCaseDetail,
  }));
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const [activeTab, setActiveTab] = useState<Tab>('input');

  if (!selectedCaseDetail) {
    return <DrawerLoading>Loading case...</DrawerLoading>;
  }

  const d = selectedCaseDetail;
  const evalSummary = evals.find((e) => e.id === d.evalId);
  const columnDefs = evalSummary?.columnDefs ?? [];
  const primaryCol = columnDefs.find((c) => c.primary);

  const tabs: Tab[] = ['input', 'output', 'trace', 'raw'];
  if (d.assertionFailures.length > 0) tabs.push('failures');
  if (d.error) tabs.push('error');

  return (
    <DrawerRoot>
      <Header>
        <HeaderLeft>
          <CaseId>{d.caseId}</CaseId>
          <StatusBadge status={d.status} />
        </HeaderLeft>
        <IconButton onClick={closeCase} aria-label="Close">
          <X />
        </IconButton>
      </Header>

      <TabBar>
        {tabs.map((tab) => (
          <TabButton
            key={tab}
            onClick={() => setActiveTab(tab)}
            active={activeTab === tab}
          >
            {tab}
          </TabButton>
        ))}
      </TabBar>

      <TabContent>
        {activeTab === 'input' ? (
          <OutputPre>{JSON.stringify(d.input, null, 2)}</OutputPre>
        ) : null}

        {activeTab === 'output' ? (
          <div>
            {primaryCol ? (
              <PrimaryBlocks value={d.columns[primaryCol.key]} />
            ) : null}
            <ColumnsGrid>
              {columnDefs
                .filter((c) => !c.primary)
                .map((c) => (
                  <ColumnCell key={c.key} def={c} value={d.columns[c.key]} />
                ))}
            </ColumnsGrid>
          </div>
        ) : null}

        {activeTab === 'trace' ? <TraceTree spans={d.trace} /> : null}

        {activeTab === 'raw' ? (
          <RawSections>
            <RawSection label="Input" data={d.input} />
            <RawSection label="Columns" data={d.columns} />
            <RawSection label="Trace" data={d.trace} />
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
    return (
      <OutputPre>{value === undefined ? '\u2014' : JSON.stringify(value, null, 2)}</OutputPre>
    );
  }
  return (
    <div>
      {value.map((block: DisplayBlock, i) => (
        <DisplayBlockRenderer key={i} block={block} />
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
      <RawPre>{JSON.stringify(data, null, 2)}</RawPre>
    </div>
  );
}
