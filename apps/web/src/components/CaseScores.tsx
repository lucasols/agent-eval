import type { CellValue, ColumnDef } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatNumericCellValue, formatScore } from '#src/utils/formatters';

const ScoresList = styled.div`
  ${stack({ gap: 12 })}
`;

const ScoreRow = styled.div`
  ${stack({ gap: 8 })}
  padding: 12px 14px;
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
`;

const ScoreRowHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const ScoreRowLabel = styled.div`
  font-size: 12.5px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.005em;
`;

const ScoreRowDescription = styled.p`
  margin: -2px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: ${colors.textMuted.var};
`;

const ScoreRowValue = styled.span`
  ${monoFont};
  font-size: 13px;
  font-weight: 500;
  color: ${colors.text.var};
`;

const ScoreBar = styled.div`
  position: relative;
  height: 6px;
  border-radius: 4px;
  background: ${colors.surface.var};
  overflow: hidden;
`;

const ScoreBarFill = styled.div<{ pass: boolean; fail: boolean }>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  background: ${colors.textDim.var};

  &.pass {
    background: ${colors.success.var};
  }
  &.fail {
    background: ${colors.error.var};
  }
`;

const ScoreRowMeta = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const ScoreStatusTag = styled.span<{ pass: boolean; fail: boolean }>`
  ${kicker};
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  letter-spacing: 0.04em;
  line-height: 1.2;

  &.pass {
    background: ${colors.success.alpha(0.12)};
    color: ${colors.success.var};
  }
  &.fail {
    background: ${colors.error.alpha(0.12)};
    color: ${colors.error.var};
  }
`;

export function CaseScores({
  scoreColumns,
  columns,
}: {
  scoreColumns: ColumnDef[];
  columns: Record<string, CellValue>;
}) {
  return (
    <ScoresList>
      {scoreColumns.map((c) => {
        const raw = columns[c.key];
        const value =
          typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
        const threshold = c.passThreshold;
        const pass =
          value !== null && threshold !== undefined && value >= threshold;
        const fail =
          value !== null && threshold !== undefined && value < threshold;
        const fillWidth =
          value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
        return (
          <ScoreRow key={c.key}>
            <ScoreRowHeader>
              <ScoreRowLabel>{c.label}</ScoreRowLabel>
              <ScoreRowValue>
                {value === null ? '\u2014' : formatNumericCellValue(c, value)}
              </ScoreRowValue>
            </ScoreRowHeader>
            {c.description !== undefined ? (
              <ScoreRowDescription>{c.description}</ScoreRowDescription>
            ) : null}
            {value !== null ? (
              <ScoreBar>
                <ScoreBarFill
                  pass={pass}
                  fail={fail}
                  style={{ width: `${fillWidth}%` }}
                />
              </ScoreBar>
            ) : null}
            <ScoreRowMeta>
              {threshold !== undefined ? (
                <ScoreStatusTag
                  pass={pass}
                  fail={fail}
                >
                  {value === null ? 'NO VALUE' : pass ? 'PASS' : 'FAIL'}
                </ScoreStatusTag>
              ) : (
                <ScoreStatusTag
                  pass={false}
                  fail={false}
                >
                  INFO
                </ScoreStatusTag>
              )}
              {threshold !== undefined ? (
                <span>threshold {formatScore(threshold)}</span>
              ) : (
                <span>informational</span>
              )}
            </ScoreRowMeta>
          </ScoreRow>
        );
      })}
    </ScoresList>
  );
}
