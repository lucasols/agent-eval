import { useMemo, useState } from 'react';
import { styled } from 'vindur';
import { ChevronDown, MoreHorizontal, Play } from 'lucide-react';
import type { EvalSummary } from '@agent-evals/shared';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  monoFont,
  stack,
  tabularNums,
  transition,
} from '#src/style/helpers';
import { Button } from './Button.tsx';
import { IconButton } from './IconButton.tsx';
import { EvalRunsChart } from './EvalRunsChart.tsx';
import { EvalRunsTable } from './EvalRunsTable.tsx';
import { historyStore, getRunsForEval } from '../stores/historyStore.ts';
import { runStore, startRun } from '../stores/runStore.ts';
import {
  formatCost,
  formatDuration,
  formatScore,
} from '../utils/formatters.ts';

type EvalCardProps = {
  evalSummary: EvalSummary;
  mode: 'single' | 'stacked';
};

const Card = styled.section<{ stacked: boolean; single: boolean }>`
  ${stack({ gap: 0 })}
  background: ${colors.bg.var};

  &.stacked {
    border: 1px solid ${colors.border.var};
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  &.single {
    height: 100%;
    overflow: hidden;
  }
`;

const Header = styled.header<{ collapsible: boolean; sticky: boolean }>`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  padding: 14px 18px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};

  &.sticky {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  &.collapsible {
    cursor: pointer;
  }
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  min-width: 0;
  flex: 1;
`;

const TitleBlock = styled.div`
  ${stack({ gap: 2 })}
  min-width: 0;
`;

const TitleRow = styled.div`
  ${inline({ gap: 8, align: 'center' })}
  min-width: 0;
`;

const Title = styled.h2<{ large: boolean }>`
  ${ellipsis}
  font-size: 14px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;

  &.large {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }
`;

const StaleBadge = styled.span`
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 3px;
  color: ${colors.warning.var};
  background: ${colors.warning.alpha(0.1)};
  border: 1px solid ${colors.warning.alpha(0.3)};
`;

const FilePath = styled.div`
  ${monoFont}
  ${ellipsis}
  font-size: 11.5px;
  color: ${colors.textDim.var};
`;

const HeaderRight = styled.div`
  ${inline({ gap: 6, align: 'center' })}
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
  ${stack({ gap: 16 })}
  padding: 18px;

  &.scroll {
    flex: 1;
    overflow: auto;
  }
`;

const StatsBar = styled.div`
  ${inline({ gap: 24, align: 'center' })}
  flex-wrap: wrap;
`;

const Stat = styled.div`
  ${stack({ gap: 2 })}
`;

const StatLabel = styled.div`
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${colors.textDim.var};
`;

const StatValue = styled.div<{ accent: boolean; mono: boolean }>`
  font-size: 14px;
  font-weight: 500;
  color: ${colors.text.var};

  &.mono {
    ${monoFont}
    ${tabularNums}
  }

  &.accent {
    color: ${colors.accent.var};
  }
`;

const SectionLabel = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${colors.textDim.var};
  margin-bottom: -4px;
`;

const SectionContent = styled.div`
  margin-top: 8px;
`;

const SectionMeta = styled.span`
  ${monoFont}
  font-size: 11px;
  color: ${colors.textDim.var};
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
`;

export function EvalCard({ evalSummary, mode }: EvalCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isStacked = mode === 'stacked';
  const isSingle = mode === 'single';

  const { runs } = historyStore.useSelectorRC((s) => ({ runs: s.runs }));
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));

  const { runRows, chartData, latestSummary } = useMemo(() => {
    const evalRuns = getRunsForEval(runs, evalSummary.id);
    const liveRun =
      currentRun &&
      runTargetsEvalLocal(currentRun.manifest.target, evalSummary.id)
        ? currentRun
        : null;

    const merged = evalRuns.filter(
      (r) => r.manifest.id !== liveRun?.manifest.id,
    );
    if (liveRun) {
      merged.unshift(liveRun);
    }

    const rows = merged.map((r) => ({
      manifest: r.manifest,
      summary: r.summary,
      cases: r.cases.filter((c) => c.evalId === evalSummary.id),
    }));

    const points = [...evalRuns]
      .reverse()
      .filter(
        (r) =>
          r.manifest.status === 'completed' && r.summary.averageScore !== null,
      )
      .map((r, idx) => ({
        index: idx + 1,
        startedAt: r.manifest.startedAt,
        score: r.summary.averageScore ?? 0,
        cost: r.summary.cost.totalUsd,
      }));

    return {
      runRows: rows,
      chartData: points,
      latestSummary: rows[0]?.summary ?? null,
    };
  }, [runs, currentRun, evalSummary.id]);

  const isRunning =
    currentRun?.manifest.status === 'running' &&
    runTargetsEvalLocal(currentRun.manifest.target, evalSummary.id);

  function handleRun(e: React.MouseEvent) {
    e.stopPropagation();
    void startRun({ mode: 'evalIds', evalIds: [evalSummary.id] });
  }

  const showBody = !isStacked || !collapsed;

  function onHeaderClick() {
    if (!isStacked) return;
    setCollapsed((v) => !v);
  }

  return (
    <Card stacked={isStacked} single={isSingle}>
      <Header
        collapsible={isStacked}
        sticky={isSingle}
        onClick={onHeaderClick}
      >
        <HeaderLeft>
          {isStacked ? (
            <Chevron open={!collapsed}>
              <ChevronDown />
            </Chevron>
          ) : null}
          <TitleBlock>
            <TitleRow>
              <Title large={isSingle}>
                {evalSummary.title ?? evalSummary.id}
              </Title>
              {evalSummary.stale ? <StaleBadge>stale</StaleBadge> : null}
            </TitleRow>
            <FilePath title={evalSummary.filePath}>
              {evalSummary.filePath}
            </FilePath>
          </TitleBlock>
        </HeaderLeft>
        <HeaderRight onClick={(e) => e.stopPropagation()}>
          <Button
            variant="primary"
            onClick={handleRun}
            disabled={isRunning}
            leftIcon={<Play />}
          >
            {isRunning ? 'Running' : 'Run'}
          </Button>
          <IconButton aria-label="More">
            <MoreHorizontal />
          </IconButton>
        </HeaderRight>
      </Header>

      {showBody ? (
        <Body scroll={isSingle}>
          <StatsBar>
            <Stat>
              <StatLabel>Cases</StatLabel>
              <StatValue mono={true} accent={false}>
                {evalSummary.caseCount ?? '\u2014'}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Avg score</StatLabel>
              <StatValue mono={true} accent={true}>
                {formatScore(latestSummary?.averageScore ?? null)}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Pass / Fail</StatLabel>
              <StatValue mono={true} accent={false}>
                {latestSummary
                  ? `${latestSummary.passedCases}/${latestSummary.failedCases + latestSummary.errorCases}`
                  : '\u2014'}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Duration</StatLabel>
              <StatValue mono={true} accent={false}>
                {formatDuration(latestSummary?.totalDurationMs ?? null)}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Cost</StatLabel>
              <StatValue mono={true} accent={false}>
                {formatCost(latestSummary?.cost.totalUsd ?? null)}
              </StatValue>
            </Stat>
          </StatsBar>

          <div>
            <SectionLabel>
              Score history
              <SectionMeta>
                {chartData.length > 0 ? `${chartData.length} runs` : ''}
              </SectionMeta>
            </SectionLabel>
            <SectionContent>
              <EvalRunsChart data={chartData} />
            </SectionContent>
          </div>

          <div>
            <SectionLabel>
              Runs
              <SectionMeta>
                {runRows.length > 0
                  ? `${runRows.length} ${runRows.length === 1 ? 'run' : 'runs'}`
                  : ''}
              </SectionMeta>
            </SectionLabel>
            <SectionContent>
              <EvalRunsTable
                runs={runRows}
                columnDefs={evalSummary.columnDefs}
              />
            </SectionContent>
          </div>
        </Body>
      ) : null}
    </Card>
  );
}

function runTargetsEvalLocal(
  target: { mode: string; evalIds?: string[] },
  evalId: string,
): boolean {
  if (target.mode === 'all') return true;
  if (target.mode === 'evalIds') {
    return target.evalIds?.includes(evalId) ?? false;
  }
  return false;
}
