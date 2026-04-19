import { useMemo, useState } from 'react';
import { styled } from 'vindur';
import { ChevronDown, Play } from 'lucide-react';
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
import { EvalRunsChart } from './EvalRunsChart.tsx';
import { EvalRunsTable } from './EvalRunsTable.tsx';
import { SplitButton, type SplitButtonMenuEntry } from './SplitButton.tsx';
import { historyStore, getRunsForEval } from '../stores/historyStore.ts';
import { clearCacheForEval, runStore, startRun } from '../stores/runStore.ts';
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
  background: transparent;

  &.stacked {
    border: 1px solid ${colors.border.var};
    overflow: hidden;
    background: ${colors.bgElevated.alpha(0.6)};
  }

  &.single {
    height: 100%;
    overflow: hidden;
  }
`;

const Header = styled.header<{ collapsible: boolean; sticky: boolean }>`
  ${stack({ gap: 0 })}
  padding: 28px 32px 22px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.alpha(0.5)};
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(
      90deg,
      ${colors.accent.var} 0%,
      ${colors.accent.var} 80px,
      transparent 80px,
      transparent 100%
    );
  }

  &.sticky {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  &.collapsible {
    cursor: pointer;
    padding: 18px 24px;
  }
`;

const HeaderTopRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  width: 100%;
`;

const Meta = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: ${colors.textDim.var};
  margin-bottom: 10px;
`;

const MetaDivider = styled.span`
  width: 18px;
  height: 1px;
  background: ${colors.borderStrong.var};
`;

const MetaAccent = styled.span`
  color: ${colors.accent.var};
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  min-width: 0;
  flex: 1;
`;

const TitleBlock = styled.div`
  ${stack({ gap: 6 })}
  min-width: 0;
`;

const TitleRow = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  min-width: 0;
`;

const Title = styled.h2<{ large: boolean }>`
  ${ellipsis}
  font-size: 16px;
  font-weight: 700;
  color: ${colors.text.var};
  letter-spacing: -0.01em;

  &.large {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.05;
  }
`;

const StaleBadge = styled.span`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  padding: 3px 7px;
  color: ${colors.warning.var};
  background: ${colors.warning.alpha(0.1)};
  border: 1px solid ${colors.warning.alpha(0.3)};
`;

const FilePath = styled.div`
  ${monoFont}
  ${ellipsis}
  font-size: 11px;
  color: ${colors.textDim.var};
  padding-left: 0;
  letter-spacing: 0;
`;

const FilePathPrefix = styled.span`
  color: ${colors.accent.alpha(0.6)};
  margin-right: 6px;
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
  ${stack({ gap: 0 })}

  &.scroll {
    flex: 1;
    overflow: auto;
  }
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  border-bottom: 1px solid ${colors.border.var};
`;

const Stat = styled.div`
  ${stack({ gap: 6 })}
  padding: 18px 22px;
  border-right: 1px solid ${colors.border.alpha(0.6)};
  position: relative;

  &:last-child {
    border-right: none;
  }
`;

const StatLabel = styled.div`
  font-size: 9.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: ${colors.textDim.var};
`;

const StatValue = styled.div<{ accent: boolean; cost: boolean }>`
  ${monoFont}
  ${tabularNums}
  font-size: 22px;
  font-weight: 700;
  color: ${colors.text.var};
  letter-spacing: -0.02em;
  line-height: 1;

  &.accent {
    color: ${colors.accent.var};
  }
  &.cost {
    color: ${colors.cost.var};
  }
`;

const Section = styled.div`
  ${stack({ gap: 0 })}
  padding: 18px 32px 24px;
  border-bottom: 1px solid ${colors.border.alpha(0.5)};

  &:last-child {
    border-bottom: none;
  }
`;

const SectionLabel = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: ${colors.textMuted.var};
  margin-bottom: 14px;

  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: ${colors.border.var};
    margin-left: 12px;
  }
`;

const SectionMeta = styled.span`
  ${monoFont}
  font-size: 10px;
  color: ${colors.accent.var};
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  order: 3;
  margin-left: 12px;
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
      (
        currentRun
        && runTargetsEvalLocal(currentRun.manifest.target, evalSummary.id)
      ) ?
        currentRun
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
    currentRun?.manifest.status === 'running'
    && runTargetsEvalLocal(currentRun.manifest.target, evalSummary.id);
  const hasScoreHistory = chartData.length > 1;

  function handleRun(e: React.MouseEvent) {
    e.stopPropagation();
    void startRun({ mode: 'evalIds', evalIds: [evalSummary.id] });
  }

  const cacheMenu: SplitButtonMenuEntry[] = [
    {
      id: 'run-default',
      label: 'Run (use cache)',
      description: 'Read on hit, write on miss.',
      onSelect: () => {
        void startRun(
          { mode: 'evalIds', evalIds: [evalSummary.id] },
          { cacheMode: 'use' },
        );
      },
    },
    {
      id: 'run-no-cache',
      label: 'Run without cache',
      description: 'Skip reads and writes for this run.',
      onSelect: () => {
        void startRun(
          { mode: 'evalIds', evalIds: [evalSummary.id] },
          { cacheMode: 'bypass' },
        );
      },
    },
    {
      id: 'run-refresh',
      label: 'Refresh cache',
      description: 'Force re-execution and overwrite entries.',
      onSelect: () => {
        void startRun(
          { mode: 'evalIds', evalIds: [evalSummary.id] },
          { cacheMode: 'refresh' },
        );
      },
    },
    { kind: 'separator' },
    {
      id: 'clear-cache',
      label: 'Clear cache for this eval',
      description: 'Remove every cached span entry tied to this eval id.',
      tone: 'danger',
      onSelect: () => {
        void clearCacheForEval(evalSummary.id);
      },
    },
  ];

  const showBody = !isStacked || !collapsed;

  function onHeaderClick() {
    if (!isStacked) return;
    setCollapsed((v) => !v);
  }

  const pathSegments = evalSummary.filePath.split('/');
  const filename =
    pathSegments[pathSegments.length - 1] ?? evalSummary.filePath;

  return (
    <Card
      stacked={isStacked}
      single={isSingle}
    >
      <Header
        collapsible={isStacked}
        sticky={isSingle}
        onClick={onHeaderClick}
      >
        {isSingle ?
          <Meta>
            <MetaAccent>Eval</MetaAccent>
            <MetaDivider />
            {evalSummary.caseCount !== null ?
              <>
                <span>
                  {evalSummary.caseCount}{' '}
                  {evalSummary.caseCount === 1 ? 'case' : 'cases'}
                </span>
                <MetaDivider />
              </>
            : null}
            <span>{filename}</span>
          </Meta>
        : null}
        <HeaderTopRow>
          <HeaderLeft>
            {isStacked ?
              <Chevron open={!collapsed}>
                <ChevronDown />
              </Chevron>
            : null}
            <TitleBlock>
              <TitleRow>
                <Title large={isSingle}>
                  {evalSummary.title ?? evalSummary.id}
                </Title>
                {evalSummary.stale ?
                  <StaleBadge>stale</StaleBadge>
                : null}
              </TitleRow>
              <FilePath title={evalSummary.filePath}>
                <FilePathPrefix>›</FilePathPrefix>
                {evalSummary.filePath}
              </FilePath>
            </TitleBlock>
          </HeaderLeft>
          <HeaderRight onClick={(e) => e.stopPropagation()}>
            <SplitButton
              label={isRunning ? 'Running' : 'Run'}
              leftIcon={<Play />}
              onPrimaryClick={handleRun}
              disabled={isRunning}
              menu={cacheMenu}
              aria-label="Run"
            />
          </HeaderRight>
        </HeaderTopRow>
      </Header>

      {showBody ?
        <Body scroll={isSingle}>
          <StatsGrid>
            <Stat>
              <StatLabel>Cases</StatLabel>
              <StatValue
                accent={false}
                cost={false}
              >
                {evalSummary.caseCount ?? '\u2014'}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Avg score</StatLabel>
              <StatValue
                accent={true}
                cost={false}
              >
                {formatScore(latestSummary?.averageScore ?? null)}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Pass / Fail</StatLabel>
              <StatValue
                accent={false}
                cost={false}
              >
                {latestSummary ?
                  `${latestSummary.passedCases}/${latestSummary.failedCases + latestSummary.errorCases}`
                : '\u2014'}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Duration</StatLabel>
              <StatValue
                accent={false}
                cost={false}
              >
                {formatDuration(latestSummary?.totalDurationMs ?? null)}
              </StatValue>
            </Stat>
            <Stat>
              <StatLabel>Cost</StatLabel>
              <StatValue
                accent={false}
                cost={true}
              >
                {formatCost(latestSummary?.cost.totalUsd ?? null)}
              </StatValue>
            </Stat>
          </StatsGrid>

          {hasScoreHistory ?
            <Section>
              <SectionLabel>
                Score history
                <SectionMeta>
                  {chartData.length} {chartData.length === 1 ? 'run' : 'runs'}
                </SectionMeta>
              </SectionLabel>
              <EvalRunsChart data={chartData} />
            </Section>
          : null}

          <Section>
            <SectionLabel>
              Runs
              <SectionMeta>
                {runRows.length > 0 ?
                  `${runRows.length} ${runRows.length === 1 ? 'run' : 'runs'}`
                : 'no runs'}
              </SectionMeta>
            </SectionLabel>
            <EvalRunsTable
              runs={runRows}
              columnDefs={evalSummary.columnDefs}
            />
          </Section>
        </Body>
      : null}
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
