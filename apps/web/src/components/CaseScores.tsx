import type { CellValue, ColumnDef, ScoreOverride } from '@agent-evals/shared';
import { useActionFn } from '@ls-stack/react-utils/useActionFn';
import { PencilLine, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { styled } from 'vindur';
import { ScoreOverrideEditor } from '#src/components/ScoreOverrideEditor';
import { setScoreOverride } from '#src/stores/runStore';
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

const ScoreRowActions = styled.div`
  ${inline({ gap: 4, align: 'center' })}
  margin-left: auto;
`;

const ScoreActionButton = styled.button`
  ${inline({ gap: 4, align: 'center' })}
  height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: ${colors.textMuted.var};
  font-size: 11.5px;
  font-weight: 500;

  & > svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &:disabled {
    opacity: 0.6;
  }
`;

const OverrideNote = styled.div`
  ${stack({ gap: 2 })}
  padding: 6px 10px;
  border-left: 2px solid ${colors.warning.var};
  background: ${colors.warning.alpha(0.08)};
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  line-height: 1.4;
  color: ${colors.textMuted.var};
`;

const OverrideReason = styled.span`
  color: ${colors.text.var};
`;

const ScoreStatusTag = styled.span<{
  pass: boolean;
  fail: boolean;
  overridden?: boolean;
}>`
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
  &.overridden {
    background: ${colors.warning.alpha(0.14)};
    color: ${colors.warning.var};
  }
`;

export function CaseScores({
  scoreColumns,
  columns,
  scoreOverrides,
  runId,
  caseId,
}: {
  scoreColumns: ColumnDef[];
  columns: Record<string, CellValue>;
  scoreOverrides: Record<string, ScoreOverride> | undefined;
  /** Persisted run/case identity; `null` disables overriding. */
  runId: string | null;
  caseId: string | null;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const revertAction = useActionFn(async (scoreKey: string) => {
    if (runId === null || caseId === null) return;
    await setScoreOverride({
      runId,
      caseId,
      scoreKey,
      value: null,
      reason: undefined,
    });
  });

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
        const override = scoreOverrides?.[c.key];
        const canOverride =
          runId !== null && caseId !== null && c.isManualScore !== true;
        const isEditing = canOverride && editingKey === c.key;
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
            {override !== undefined ? (
              <OverrideNote>
                <span>
                  Manually overridden. Computed value:{' '}
                  {override.originalValue === null
                    ? '\u2014'
                    : formatNumericCellValue(c, override.originalValue)}
                </span>
                {override.reason !== undefined ? (
                  <OverrideReason>{override.reason}</OverrideReason>
                ) : null}
              </OverrideNote>
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
              {override !== undefined ? (
                <ScoreStatusTag
                  pass={false}
                  fail={false}
                  overridden
                >
                  OVERRIDDEN
                </ScoreStatusTag>
              ) : null}
              {threshold !== undefined ? (
                <span>threshold {formatScore(threshold)}</span>
              ) : (
                <span>informational</span>
              )}
              {canOverride && !isEditing ? (
                <ScoreRowActions>
                  {override !== undefined ? (
                    <ScoreActionButton
                      type="button"
                      disabled={revertAction.isInProgress}
                      onClick={() => void revertAction.call(c.key)}
                    >
                      <RotateCcw />
                      Revert
                    </ScoreActionButton>
                  ) : null}
                  <ScoreActionButton
                    type="button"
                    onClick={() => setEditingKey(c.key)}
                  >
                    <PencilLine />
                    {override !== undefined ? 'Edit override' : 'Override'}
                  </ScoreActionButton>
                </ScoreRowActions>
              ) : null}
            </ScoreRowMeta>
            {isEditing ? (
              <ScoreOverrideEditor
                runId={runId}
                caseId={caseId}
                column={c}
                currentValue={value}
                override={override}
                onClose={() => setEditingKey(null)}
              />
            ) : null}
          </ScoreRow>
        );
      })}
    </ScoresList>
  );
}
