import type { CellValue, ColumnDef } from '@agent-evals/shared';
import { styled } from 'vindur';
import { ManualScoreControls } from '#src/components/ScoreCell';
import { caseDetailStore, runDetailStore } from '#src/stores/runStore';
import { colors } from '#src/style/colors';
import { inline, kicker, stack } from '#src/style/helpers';

const ManualScoringPanelRoot = styled.div<{ compact: boolean }>`
  ${stack({ gap: 10 })}
  width: 100%;
  padding: 12px 16px;
  border-top: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  flex-shrink: 0;

  &.compact {
    padding: 10px 12px;
    border: 1px solid ${colors.borderStrong.var};
    border-radius: var(--radius-md);
    background: ${colors.bg.var};
    box-shadow: 0 12px 36px -24px ${colors.black.alpha(0.45)};
  }
`;

const ManualScoringHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const ManualScoringTitle = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const ManualScoringCount = styled.span`
  font-size: 11px;
  color: ${colors.textDim.var};
`;

const ManualScoringList = styled.div`
  ${stack({ gap: 8 })}
`;

const ManualScoringRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
`;

const ManualScoringMeta = styled.div`
  ${stack({ gap: 2 })}
  min-width: 0;
`;

const ManualScoringLabel = styled.span`
  font-size: 12.5px;
  font-weight: 600;
  color: ${colors.text.var};
`;

const ManualScoringDescription = styled.span`
  font-size: 11.5px;
  line-height: 1.35;
  color: ${colors.textMuted.var};
`;

export function PendingManualScoringPanel({
  runId,
  caseId,
  scoreColumns,
  columns,
  compact = false,
}: {
  runId: string;
  caseId: string;
  scoreColumns: ColumnDef[];
  columns: Record<string, CellValue>;
  compact?: boolean;
}) {
  const caseDetailResult = caseDetailStore.useItem({ runId, caseId });
  const runDetailResult = runDetailStore.useItem({ runId });
  const runCase = runDetailResult.data?.cases.find(
    (row) => (row.caseKey ?? row.caseId) === caseId,
  );
  const currentColumns =
    caseDetailResult.data?.columns ?? runCase?.columns ?? columns;
  const pendingManualScores = scoreColumns
    .filter((column) => column.isManualScore === true)
    .map((column) => ({
      column,
      value: getManualScoreValue(currentColumns[column.key]),
    }))
    .filter((entry) => entry.value === null);

  if (pendingManualScores.length === 0) return null;

  return (
    <ManualScoringPanelRoot compact={compact}>
      <ManualScoringHeader>
        <ManualScoringTitle>Manual scoring</ManualScoringTitle>
        <ManualScoringCount>
          {String(pendingManualScores.length)} pending
        </ManualScoringCount>
      </ManualScoringHeader>
      <ManualScoringList>
        {pendingManualScores.map(({ column, value }) => (
          <ManualScoringRow key={column.key}>
            <ManualScoringMeta>
              <ManualScoringLabel>{column.label}</ManualScoringLabel>
              {column.description !== undefined ? (
                <ManualScoringDescription>
                  {column.description}
                </ManualScoringDescription>
              ) : null}
            </ManualScoringMeta>
            <ManualScoreControls
              runId={runId}
              caseId={caseId}
              column={column}
              value={value}
            />
          </ManualScoringRow>
        ))}
      </ManualScoringList>
    </ManualScoringPanelRoot>
  );
}

function getManualScoreValue(value: CellValue | undefined): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}
