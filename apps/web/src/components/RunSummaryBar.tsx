import { styled, css } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { inline } from '#src/style/helpers.ts';
import { runStore } from '../stores/runStore.ts';
import { StatusBadge } from './StatusBadge.tsx';
import { CostBadge } from './CostBadge.tsx';

const SummaryContainer = styled.div`
  padding: 8px 16px;
  border-bottom: 1px solid ${colors.border.var};
  ${inline({ gap: 16 })}
  background: ${colors.bg.var};
  font-size: 13px;
`;

const FailedCount = styled.strong``;

const failedHighlight = css`
  color: ${colors.error.var};
`;

export function RunSummaryBar() {
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));

  if (!currentRun) return null;

  const { summary } = currentRun;

  return (
    <SummaryContainer>
      <StatusBadge status={summary.status} />
      <span>
        <strong>{String(summary.passedCases)}</strong> pass
      </span>
      <span>
        <FailedCount css={summary.failedCases > 0 ? failedHighlight : undefined}>
          {String(summary.failedCases)}
        </FailedCount>{' '}
        fail
      </span>
      {summary.averageScore !== null ? (
        <span>
          avg score: <strong>{summary.averageScore.toFixed(2)}</strong>
        </span>
      ) : null}
      {summary.totalDurationMs !== null ? (
        <span>
          {(summary.totalDurationMs / 1000).toFixed(1)}s
        </span>
      ) : null}
      <CostBadge
        billedCost={summary.cost.totalUsd}
        uncachedCost={summary.cost.uncachedUsd}
        savings={summary.cost.savingsUsd}
      />
    </SummaryContainer>
  );
}
