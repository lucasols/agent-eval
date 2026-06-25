import type { ColumnDef } from '@agent-evals/shared';
import { useActionFn } from '@ls-stack/react-utils/useActionFn';
import { Check, Star, X } from 'lucide-react';
import { styled } from 'vindur';
import { Tooltip } from '#src/components/Tooltip';
import { updateManualScore } from '#src/stores/runStore';
import { colors } from '#src/style/colors';
import { inline, monoFont, tabularNums } from '#src/style/helpers';
import {
  formatPassFail,
  formatScore,
  getMaxStars,
  starsToValue,
  valueToStars,
} from '#src/utils/formatters';

const EM_DASH = '—';

const Dim = styled.span`
  color: ${colors.textDim.var};
`;

const ScoreBar = styled.span`
  display: inline-block;
  width: 40px;
  height: 3px;
  border-radius: 4px;
  background: ${colors.surface.var};
  position: relative;
  overflow: hidden;
  margin-right: 8px;
  vertical-align: middle;
`;

const ScoreBarFill = styled.span<{
  pass: boolean;
  partial: boolean;
  fail: boolean;
}>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  background: ${colors.textDim.var};

  &.pass {
    background: ${colors.success.var};
  }
  &.partial {
    background: ${colors.warning.var};
  }
  &.fail {
    background: ${colors.error.var};
  }
`;

const ScoreText = styled.span`
  ${monoFont};
  ${tabularNums};
  font-size: 12px;
  color: ${colors.text.var};
  font-weight: 500;
`;

const ScoreCellWrap = styled.span`
  ${inline({ gap: 0, align: 'center' })}
  display: inline-flex;
`;

const PassFailPill = styled.span<{ pass: boolean; fail: boolean }>`
  ${inline({ gap: 5, align: 'center' })}
  display: inline-flex;
  justify-content: center;
  min-width: 54px;
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};
  font-size: 11px;
  font-weight: 600;

  &.pass {
    color: ${colors.success.var};
    background: ${colors.success.alpha(0.1)};
  }
  &.fail {
    color: ${colors.error.var};
    background: ${colors.error.alpha(0.1)};
  }
`;

const StarsWrap = styled.span`
  ${inline({ gap: 1, align: 'center' })}
  display: inline-flex;
  color: ${colors.textDim.var};

  & > svg {
    width: 13px;
    height: 13px;
  }

  & > .filled {
    color: ${colors.warning.var};
    fill: currentColor;
  }
`;

const ManualControls = styled.div`
  ${inline({ gap: 4, align: 'center', justify: 'right' })}
`;

const ManualButton = styled.button<{
  selectedPass: boolean;
  selectedFail: boolean;
}>`
  ${inline({ gap: 4, align: 'center' })}
  justify-content: center;
  height: 24px;
  min-width: 28px;
  padding: 0 7px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  color: ${colors.textMuted.var};
  font-size: 11px;
  font-weight: 600;

  & > svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    border-color: ${colors.accent.alpha(0.5)};
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &:disabled {
    opacity: 0.6;
  }

  &.selectedPass {
    color: ${colors.success.var};
    border-color: ${colors.success.alpha(0.5)};
    background: ${colors.success.alpha(0.1)};
  }

  &.selectedFail {
    color: ${colors.error.var};
    border-color: ${colors.error.alpha(0.5)};
    background: ${colors.error.alpha(0.1)};
  }
`;

const StarButton = styled.button<{ selected: boolean }>`
  ${inline({ align: 'center', justify: 'center' })}
  width: 20px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: ${colors.textDim.var};

  & > svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled),
  &.selected {
    color: ${colors.warning.var};
  }

  &.selected > svg {
    fill: currentColor;
  }

  &:disabled {
    opacity: 0.6;
  }
`;

export function ScoreCell({
  score,
  passThreshold,
  column,
  isAverage = false,
}: {
  score: number | null;
  passThreshold: number | undefined;
  column: ColumnDef;
  isAverage?: boolean;
}) {
  if (score === null) return <Dim>{EM_DASH}</Dim>;
  if (column.format === 'passFail') {
    const pass =
      passThreshold === undefined ? score >= 0.5 : score >= passThreshold;
    return (
      <PassFailPill
        pass={pass}
        fail={!pass}
      >
        {formatPassFail(score)}
      </PassFailPill>
    );
  }
  if (column.format === 'stars') {
    return (
      <StarDisplay
        value={score}
        maxStars={column.maxStars}
      />
    );
  }
  const tone: 'pass' | 'partial' | 'fail' =
    passThreshold !== undefined
      ? score >= passThreshold
        ? 'pass'
        : 'fail'
      : score >= 0.7
        ? 'pass'
        : score >= 0.4
          ? 'partial'
          : 'fail';
  const bar = (
    <ScoreCellWrap>
      <ScoreBar>
        <ScoreBarFill
          pass={tone === 'pass'}
          partial={tone === 'partial'}
          fail={tone === 'fail'}
          style={{ width: `${score * 100}%` }}
        />
      </ScoreBar>
      <ScoreText>
        {isAverage ? '~' : ''}
        {formatScore(score)}
      </ScoreText>
    </ScoreCellWrap>
  );
  if (passThreshold === undefined) return bar;
  return (
    <Tooltip content={`Pass threshold: ${formatScore(passThreshold)}`}>
      {bar}
    </Tooltip>
  );
}

function StarDisplay({
  value,
  maxStars,
}: {
  value: number;
  maxStars: number | undefined;
}) {
  const max = getMaxStars(maxStars);
  const stars = valueToStars(value, max);
  return (
    <Tooltip content={`${String(stars ?? 0)}/${String(max)}`}>
      <StarsWrap>
        {Array.from({ length: max }, (_, index) => (
          <Star
            key={index}
            className={stars !== null && index < stars ? 'filled' : undefined}
          />
        ))}
      </StarsWrap>
    </Tooltip>
  );
}

export function ManualScoreCell({
  runId,
  caseId,
  column,
  value,
}: {
  runId: string;
  caseId: string;
  column: ColumnDef;
  value: number | null;
}) {
  return (
    <ManualScoreControls
      runId={runId}
      caseId={caseId}
      column={column}
      value={value}
    />
  );
}

export function ManualScoreControls({
  runId,
  caseId,
  column,
  value,
}: {
  runId: string;
  caseId: string;
  column: ColumnDef;
  value: number | null;
}) {
  const updateAction = useActionFn(async (nextValue: number) => {
    await updateManualScore({
      runId,
      caseId,
      scoreKey: column.key,
      value: nextValue,
    });
  });

  if (column.format === 'stars') {
    const max = getMaxStars(column.maxStars);
    const stars = valueToStars(value, max) ?? 0;
    return (
      <ManualControls>
        {Array.from({ length: max }, (_, index) => {
          const star = index + 1;
          return (
            <StarButton
              key={star}
              type="button"
              selected={star <= stars}
              disabled={updateAction.isInProgress}
              aria-label={`Set ${String(star)} of ${String(max)} stars`}
              onClick={(event) => {
                event.stopPropagation();
                void updateAction.call(starsToValue(star, max));
              }}
            >
              <Star />
            </StarButton>
          );
        })}
      </ManualControls>
    );
  }

  const selectedPass = value !== null && value >= 0.5;
  const selectedFail = value !== null && value < 0.5;
  return (
    <ManualControls>
      <ManualButton
        type="button"
        selectedFail={selectedFail}
        selectedPass={false}
        disabled={updateAction.isInProgress}
        aria-label={`Fail ${column.label}`}
        onClick={(event) => {
          event.stopPropagation();
          void updateAction.call(0);
        }}
      >
        <X />
        Fail
      </ManualButton>
      <ManualButton
        type="button"
        selectedPass={selectedPass}
        selectedFail={false}
        disabled={updateAction.isInProgress}
        aria-label={`Pass ${column.label}`}
        onClick={(event) => {
          event.stopPropagation();
          void updateAction.call(1);
        }}
      >
        <Check />
        Pass
      </ManualButton>
    </ManualControls>
  );
}
