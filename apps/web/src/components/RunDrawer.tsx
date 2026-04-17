import { styled } from 'vindur';
import { X } from 'lucide-react';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack, tabularNums } from '#src/style/helpers';
import { closeRun, runStore } from '../stores/runStore.ts';
import { StatusBadge } from './StatusBadge.tsx';
import { IconButton } from './IconButton.tsx';
import {
  formatCost,
  formatDuration,
  formatScore,
  formatTimestamp,
} from '../utils/formatters.ts';

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
  ${inline({ gap: 10, align: 'center' })}
  min-width: 0;
`;

const RunTag = styled.span`
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: ${colors.accentInk.var};
  padding: 4px 9px;
  background: ${colors.accent.var};
`;

const RunTime = styled.span`
  font-size: 12.5px;
  font-weight: 500;
  color: ${colors.text.var};
  ${tabularNums}
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
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${colors.textDim.var};
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
`;

const Stat = styled.div`
  ${stack({ gap: 4 })}
  padding: 10px 12px;
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
`;

const StatLabel = styled.span`
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${colors.textDim.var};
`;

const StatValue = styled.span<{ accent: boolean; cost: boolean; error: boolean }>`
  ${monoFont}
  ${tabularNums}
  font-size: 14px;
  font-weight: 500;
  color: ${colors.text.var};

  &.accent {
    color: ${colors.accent.var};
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
  font-size: 11.5px;
  color: ${colors.textDim.var};
`;

const MetaValue = styled.dd`
  margin: 0;
  ${monoFont}
  ${tabularNums}
  font-size: 11.5px;
  color: ${colors.text.var};
  word-break: break-all;
`;

const ErrorBlock = styled.pre`
  ${monoFont}
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${colors.error.var};
  background: ${colors.error.alpha(0.08)};
  border: 1px solid ${colors.error.alpha(0.4)};
  border-radius: var(--radius-sm);
  padding: 12px;
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
  const failed = summary.failedCases + summary.errorCases;
  const showError =
    summary.status === 'error' &&
    summary.errorMessage !== null &&
    summary.errorMessage.length > 0;

  return (
    <DrawerRoot>
      <Header>
        <HeaderLeft>
          <RunTag>Run</RunTag>
          <RunTime>{formatTimestamp(manifest.startedAt)}</RunTime>
          <StatusBadge status={manifest.status} />
        </HeaderLeft>
        <IconButton onClick={closeRun} aria-label="Close run drawer">
          <X />
        </IconButton>
      </Header>

      <Body>
        <StatGrid>
          <Stat>
            <StatLabel>Cases</StatLabel>
            <StatValue accent={false} cost={false} error={false}>
              {String(summary.totalCases)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Passed</StatLabel>
            <StatValue accent={false} cost={false} error={false}>
              {String(summary.passedCases)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Failed</StatLabel>
            <StatValue accent={false} cost={false} error={failed > 0}>
              {String(failed)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Duration</StatLabel>
            <StatValue accent={false} cost={false} error={false}>
              {formatDuration(summary.totalDurationMs)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Cost</StatLabel>
            <StatValue accent={false} cost={true} error={false}>
              {formatCost(summary.cost.totalUsd)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Avg score</StatLabel>
            <StatValue accent={true} cost={false} error={false}>
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
