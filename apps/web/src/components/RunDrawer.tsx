import { X } from 'lucide-react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import {
  inline,
  kicker,
  monoFont,
  stack,
  tabularNums,
} from '#src/style/helpers';
import { closeRun, runStore } from '../stores/runStore.ts';
import {
  formatCost,
  formatDuration,
  formatScore,
  formatTimestamp,
} from '../utils/formatters.ts';
import { getRunDisplayStatus } from '../utils/runStatus.ts';
import { IconButton } from './IconButton.tsx';
import { StatusBadge } from './StatusBadge.tsx';

const DrawerLoading = styled.div`
  width: 540px;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textMuted.var};
  font-size: 12px;
`;

const DrawerRoot = styled.div`
  ${stack()}
  width: 540px;
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

const HeaderKicker = styled.span`
  ${kicker}
  color: ${colors.textMuted.var};
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  min-width: 0;
`;

const RunTag = styled.span`
  ${monoFont};
  font-size: 9.5px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
  color: ${colors.accentInk.var};
  background: ${colors.accent.var};
`;

const RunTime = styled.span`
  font-size: 15px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;
  ${tabularNums};
`;

const Body = styled.div`
  flex: 1;
  overflow: auto;
  padding: 16px;
  ${stack({ gap: 18 })}
`;

const Section = styled.section`
  ${stack({ gap: 8 })}
`;

const SectionLabel = styled.div`
  ${kicker}
  color: ${colors.textMuted.var};
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
`;

const Stat = styled.div`
  ${stack({ gap: 6 })}
  padding: 12px 14px;
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
`;

const StatLabel = styled.span`
  ${kicker}
  color: ${colors.textMuted.var};
`;

const StatValue = styled.span<{
  accent: boolean;
  cost: boolean;
  error: boolean;
}>`
  ${tabularNums};
  font-size: 18px;
  font-weight: 500;
  color: ${colors.text.var};
  letter-spacing: -0.02em;

  &.accent {
    color: ${colors.accentDim.var};
  }
  &.cost {
    color: ${colors.cost.var};
  }
  &.error {
    color: ${colors.error.var};
  }
`;

const MetaList = styled.dl`
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 12px;
  margin: 0;
`;

const MetaKey = styled.dt`
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const MetaValue = styled.dd`
  margin: 0;
  ${monoFont};
  ${tabularNums};
  font-size: 11.5px;
  color: ${colors.text.var};
  word-break: break-all;
`;

const ErrorBlock = styled.pre`
  ${monoFont};
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${colors.error.var};
  background: ${colors.error.alpha(0.06)};
  border: 1px solid ${colors.error.alpha(0.3)};
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin: 0;
`;

function formatTarget(target: {
  mode: 'all' | 'evalIds' | 'caseIds';
  evalIds?: string[];
  caseIds?: string[];
}): string {
  if (target.mode === 'all') return 'all evals';
  if (target.mode === 'evalIds') {
    const ids = target.evalIds ?? [];
    return ids.length > 0 ? ids.join(', ') : 'evalIds';
  }
  const ids = target.caseIds ?? [];
  return ids.length > 0 ? ids.join(', ') : 'caseIds';
}

export function RunDrawer() {
  const { selectedRunDetail } = runStore.useSelectorRC((s) => ({
    selectedRunDetail: s.selectedRunDetail,
  }));

  if (!selectedRunDetail) {
    return <DrawerLoading>Loading run...</DrawerLoading>;
  }

  const { manifest, summary } = selectedRunDetail;
  const displayStatus = getRunDisplayStatus(manifest, summary);
  const failed = summary.failedCases + summary.errorCases;
  const showError =
    summary.status === 'error' &&
    summary.errorMessage !== null &&
    summary.errorMessage.length > 0;

  return (
    <DrawerRoot>
      <Header>
        <HeaderTop>
          <HeaderKicker>Run</HeaderKicker>
          <IconButton
            onClick={closeRun}
            aria-label="Close run drawer"
          >
            <X />
          </IconButton>
        </HeaderTop>
        <HeaderLeft>
          <RunTag>RUN</RunTag>
          <RunTime>{formatTimestamp(manifest.startedAt)}</RunTime>
          <StatusBadge status={displayStatus} />
        </HeaderLeft>
      </Header>

      <Body>
        <StatGrid>
          <Stat>
            <StatLabel>Cases</StatLabel>
            <StatValue
              accent={false}
              cost={false}
              error={false}
            >
              {String(summary.totalCases)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Passed</StatLabel>
            <StatValue
              accent={false}
              cost={false}
              error={false}
            >
              {String(summary.passedCases)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Failed</StatLabel>
            <StatValue
              accent={false}
              cost={false}
              error={failed > 0}
            >
              {String(failed)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Duration</StatLabel>
            <StatValue
              accent={false}
              cost={false}
              error={false}
            >
              {formatDuration(summary.totalDurationMs)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Cost</StatLabel>
            <StatValue
              accent={false}
              cost={true}
              error={false}
            >
              {formatCost(summary.cost.totalUsd)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Avg score</StatLabel>
            <StatValue
              accent={true}
              cost={false}
              error={false}
            >
              {formatScore(summary.averageScore)}
            </StatValue>
          </Stat>
        </StatGrid>

        {showError && summary.errorMessage !== null ? (
          <Section>
            <SectionLabel>Error</SectionLabel>
            <ErrorBlock>{summary.errorMessage}</ErrorBlock>
          </Section>
        ) : null}

        <Section>
          <SectionLabel>Metadata</SectionLabel>
          <MetaList>
            <MetaKey>Run id</MetaKey>
            <MetaValue>{manifest.id}</MetaValue>
            <MetaKey>Started</MetaKey>
            <MetaValue>{manifest.startedAt}</MetaValue>
            <MetaKey>Ended</MetaKey>
            <MetaValue>{manifest.endedAt ?? '\u2014'}</MetaValue>
            <MetaKey>Trials</MetaKey>
            <MetaValue>{String(manifest.trials)}</MetaValue>
            <MetaKey>Target</MetaKey>
            <MetaValue>{formatTarget(manifest.target)}</MetaValue>
          </MetaList>
        </Section>
      </Body>
    </DrawerRoot>
  );
}
