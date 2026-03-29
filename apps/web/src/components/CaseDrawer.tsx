import { styled, css } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { inline, stack, monoFont } from '#src/style/helpers.ts';
import { runStore, closeCase } from '../stores/runStore.ts';
import { DisplayBlockRenderer } from './DisplayBlockRenderer.tsx';
import { TraceTree } from './TraceTree.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { useState } from 'react';

type Tab = 'inputs' | 'output' | 'scores' | 'trace' | 'raw' | 'error';

const DrawerLoading = styled.div`
  width: 480px;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.surface.var};
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textMuted.var};
`;

const DrawerRoot = styled.div`
  width: 480px;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.surface.var};
  ${stack()}
  overflow: hidden;
`;

const DrawerHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${colors.border.var};
  ${inline({ justify: 'space-between' })}
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 8 })}
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${colors.textMuted.var};
  font-size: 18px;
`;

const TabBar = styled.div`
  display: flex;
  border-bottom: 1px solid ${colors.border.var};
  overflow: auto;
`;

const activeTabStyle = css`
  border-bottom: 2px solid ${colors.accent.var};
  color: ${colors.text.var};
  font-weight: 600;
`;

const inactiveTabStyle = css`
  border-bottom: 2px solid transparent;
  color: ${colors.textMuted.var};
  font-weight: 400;
`;

const TabButton = styled.button`
  padding: 8px 16px;
  background: none;
  border: none;
  font-size: 13px;
  text-transform: capitalize;
  white-space: nowrap;
`;

const TabContent = styled.div`
  flex: 1;
  overflow: auto;
  padding: 16px;
`;

const OutputPre = styled.pre`
  ${monoFont}
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
`;

const ScoresList = styled.div`
  ${stack({ gap: 12 })}
`;

const ScoreCard = styled.div`
  padding: 12px;
  background: ${colors.bg.var};
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
`;

const ScoreHeader = styled.div`
  ${inline({ justify: 'space-between' })}
  margin-bottom: 4px;
`;

const ScoreValue = styled.span`
  ${monoFont}

  &.pass {
    color: ${colors.success.var};
  }

  &.fail {
    color: ${colors.error.var};
  }
`;

const ScoreReason = styled.div`
  font-size: 12px;
  color: ${colors.textSecondary.var};
`;

const RawSections = styled.div`
  ${stack({ gap: 16 })}
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
`;

const RawLabel = styled.div`
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 4px;
  color: ${colors.textSecondary.var};
`;

const RawPre = styled.pre`
  ${monoFont}
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  background: ${colors.bg.var};
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
  max-height: 300px;
  overflow: auto;
`;

export function CaseDrawer() {
  const { selectedCaseDetail } = runStore.useSelectorRC((s) => ({
    selectedCaseDetail: s.selectedCaseDetail,
  }));
  const [activeTab, setActiveTab] = useState<Tab>('inputs');

  if (!selectedCaseDetail) {
    return <DrawerLoading>Loading...</DrawerLoading>;
  }

  const d = selectedCaseDetail;
  const tabs: Tab[] = ['inputs', 'output', 'scores', 'trace', 'raw'];
  if (d.error) tabs.push('error');

  return (
    <DrawerRoot>
      <DrawerHeader>
        <HeaderLeft>
          <strong>{d.caseId}</strong>
          <StatusBadge status={d.status} />
        </HeaderLeft>
        <CloseButton onClick={closeCase}>x</CloseButton>
      </DrawerHeader>

      <TabBar>
        {tabs.map((tab) => (
          <TabButton
            key={tab}
            onClick={() => setActiveTab(tab)}
            css={activeTab === tab ? activeTabStyle : inactiveTabStyle}
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
              <OutputPre>
                {JSON.stringify(d.output, null, 2)}
              </OutputPre>
            )}
          </div>
        ) : null}

        {activeTab === 'scores' ? (
          <ScoresList>
            {d.scores.map((s) => (
              <ScoreCard key={s.id}>
                <ScoreHeader>
                  <strong>{s.label ?? s.id}</strong>
                  <ScoreValue className={s.score >= 0.5 ? 'pass' : 'fail'}>
                    {s.score.toFixed(2)}
                  </ScoreValue>
                </ScoreHeader>
                {s.reason ? (
                  <ScoreReason>{s.reason}</ScoreReason>
                ) : null}
                {s.display?.map((block, i) => (
                  <DisplayBlockRenderer key={i} block={block} />
                ))}
              </ScoreCard>
            ))}
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
            {d.error.stack ? (
              <ErrorStack>{d.error.stack}</ErrorStack>
            ) : null}
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
