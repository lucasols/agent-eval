import { useState } from 'react';
import { styled } from 'vindur';
import { X } from 'lucide-react';
import { colors } from '#src/style/colors';
import { inline, monoFont, sansFont, stack } from '#src/style/helpers';
import { closeCase, runStore } from '../stores/runStore.ts';
import { DisplayBlockRenderer } from './DisplayBlockRenderer.tsx';
import { TraceTree } from './TraceTree.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { IconButton } from './IconButton.tsx';

type Tab = 'inputs' | 'output' | 'scores' | 'trace' | 'raw' | 'error';

const DrawerLoading = styled.div`
  width: 520px;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};
  font-size: 12px;
`;

const DrawerRoot = styled.div`
  ${stack()}
  width: 520px;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
`;

const Header = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 8 })}
  height: 44px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  flex-shrink: 0;
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  min-width: 0;
`;

const CaseId = styled.span`
  ${monoFont}
  font-size: 12.5px;
  color: ${colors.text.var};
  font-weight: 500;
`;

const TabBar = styled.div`
  ${inline({ gap: 0 })}
  border-bottom: 1px solid ${colors.border.var};
  padding: 0 8px;
  flex-shrink: 0;
  overflow-x: auto;
`;

const TabButton = styled.button<{ active: boolean }>`
  ${sansFont}
  position: relative;
  padding: 8px 12px;
  background: transparent;
  border: none;
  font-size: 12px;
  font-weight: 500;
  color: ${colors.textDim.var};
  text-transform: lowercase;
  letter-spacing: 0.02em;
  white-space: nowrap;

  &:hover {
    color: ${colors.textMuted.var};
  }

  &.active {
    color: ${colors.text.var};
  }

  &.active::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: -1px;
    height: 1.5px;
    background: ${colors.accent.var};
    border-radius: 2px;
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

const ScoresList = styled.div`
  ${stack({ gap: 10 })}
`;

const ScoreCard = styled.div`
  padding: 12px;
  background: ${colors.surface.var};
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
`;

const ScoreHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  margin-bottom: 6px;
`;

const ScoreLabel = styled.strong`
  font-size: 12.5px;
  font-weight: 500;
  color: ${colors.text.var};
`;

const ScoreValue = styled.span<{ pass: boolean; fail: boolean }>`
  ${monoFont}
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: ${colors.textMuted.var};

  &.pass {
    color: ${colors.success.var};
  }
  &.fail {
    color: ${colors.error.var};
  }
`;

const ScoreReason = styled.div`
  font-size: 12px;
  color: ${colors.textMuted.var};
  line-height: 1.5;
`;

const RawSections = styled.div`
  ${stack({ gap: 14 })}
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

export function CaseDrawer() {
  const { selectedCaseDetail } = runStore.useSelectorRC((s) => ({
    selectedCaseDetail: s.selectedCaseDetail,
  }));
  const [activeTab, setActiveTab] = useState<Tab>('inputs');

  if (!selectedCaseDetail) {
    return <DrawerLoading>Loading case...</DrawerLoading>;
  }

  const d = selectedCaseDetail;
  const tabs: Tab[] = ['inputs', 'output', 'scores', 'trace', 'raw'];
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
        {activeTab === 'inputs' ? (
          <div>
            {d.displayInput.map((block, i) => (
              <DisplayBlockRenderer key={i} block={block} />
            ))}
          </div>
        ) : null}

        {activeTab === 'output' ? (
          <div>
            {d.displayOutput.length > 0 ? (
              d.displayOutput.map((block, i) => (
                <DisplayBlockRenderer key={i} block={block} />
              ))
            ) : (
              <OutputPre>{JSON.stringify(d.output, null, 2)}</OutputPre>
            )}
          </div>
        ) : null}

        {activeTab === 'scores' ? (
          <ScoresList>
            {d.scores.map((s) => {
              const pass = s.pass ?? s.score >= 0.5;
              return (
                <ScoreCard key={s.id}>
                  <ScoreHeader>
                    <ScoreLabel>{s.label ?? s.id}</ScoreLabel>
                    <ScoreValue pass={pass} fail={!pass}>
                      {s.score.toFixed(2)}
                    </ScoreValue>
                  </ScoreHeader>
                  {s.reason ? <ScoreReason>{s.reason}</ScoreReason> : null}
                  {s.display?.map((block, i) => (
                    <DisplayBlockRenderer key={i} block={block} />
                  ))}
                </ScoreCard>
              );
            })}
          </ScoresList>
        ) : null}

        {activeTab === 'trace' ? <TraceTree spans={d.trace} /> : null}

        {activeTab === 'raw' ? (
          <RawSections>
            <RawSection label="Input" data={d.input} />
            <RawSection label="Output" data={d.output} />
            <RawSection label="Scores" data={d.scores} />
            <RawSection label="Trace" data={d.trace} />
          </RawSections>
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

function RawSection({ label, data }: { label: string; data: unknown }) {
  return (
    <div>
      <RawLabel>{label}</RawLabel>
      <RawPre>{JSON.stringify(data, null, 2)}</RawPre>
    </div>
  );
}
