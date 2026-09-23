import type { ColumnDef, ScoreOverride } from '@agent-evals/shared';
import { useActionFn } from '@ls-stack/react-utils/useActionFn';
import { useState } from 'react';
import { css, styled } from 'vindur';
import { Button } from '#src/components/Button';
import { ScoreValuePicker } from '#src/components/ScoreCell';
import { setScoreOverride } from '#src/stores/runStore';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack, transition } from '#src/style/helpers';

const EditorRoot = styled.div`
  ${stack({ gap: 10 })}
  padding: 10px 12px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.bgElevated.var};
`;

const EditorRow = styled.label`
  ${inline({ gap: 10, align: 'center' })}
  font-size: 11.5px;
  color: ${colors.textMuted.var};
`;

const EditorRowLabel = styled.span`
  width: 72px;
  flex-shrink: 0;
`;

const inputStyles = css`
  padding: 6px 9px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: 6px;
  background: ${colors.bg.var};
  font-size: 12.5px;
  color: ${colors.text.var};
  font-family: inherit;
  ${transition({ property: 'border-color, box-shadow' })}

  &:focus {
    outline: none;
    border-color: ${colors.accent.var};
    box-shadow: 0 0 0 3px ${colors.accent.alpha(0.18)};
  }
`;

const ValueInput = styled.input`
  ${inputStyles};
  ${monoFont};
  width: 96px;
`;

const ReasonInput = styled.input`
  ${inputStyles};
  flex: 1;
  min-width: 0;
`;

const EditorActions = styled.div`
  ${inline({ gap: 8, justify: 'right', align: 'center' })}
`;

const ValidationMessage = styled.span`
  margin-right: auto;
  font-size: 11.5px;
  color: ${colors.error.var};
`;

/**
 * Inline form for overriding a computed score on one persisted case. Pass/fail
 * and star scores use the same picker as manual scores; other formats take a
 * normalized `0..1` number.
 */
export function ScoreOverrideEditor({
  runId,
  caseId,
  column,
  currentValue,
  override,
  onClose,
}: {
  runId: string;
  caseId: string;
  column: ColumnDef;
  currentValue: number | null;
  override: ScoreOverride | undefined;
  onClose: () => void;
}) {
  const usesPicker = column.format === 'passFail' || column.format === 'stars';
  const [draftValue, setDraftValue] = useState(
    currentValue === null ? '' : String(currentValue),
  );
  const [reason, setReason] = useState(override?.reason ?? '');
  const parsedValue = parseScoreValue(draftValue);

  const saveAction = useActionFn(async (value: number) => {
    await setScoreOverride({
      runId,
      caseId,
      scoreKey: column.key,
      value,
      reason: reason.trim() === '' ? undefined : reason.trim(),
    });
    onClose();
  });

  return (
    <EditorRoot
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <EditorRow>
        <EditorRowLabel>Score</EditorRowLabel>
        {usesPicker ? (
          <ScoreValuePicker
            column={column}
            value={parsedValue}
            disabled={saveAction.isInProgress}
            onChange={(value) => setDraftValue(String(value))}
          />
        ) : (
          <ValueInput
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={draftValue}
            placeholder="0 – 1"
            aria-label={`Override value for ${column.label}`}
            autoFocus
            onChange={(event) => setDraftValue(event.target.value)}
          />
        )}
      </EditorRow>
      <EditorRow>
        <EditorRowLabel>Reason</EditorRowLabel>
        <ReasonInput
          type="text"
          value={reason}
          placeholder="Why the computed score is invalid (optional)"
          aria-label={`Override reason for ${column.label}`}
          autoFocus={usesPicker}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && parsedValue !== null) {
              void saveAction.call(parsedValue);
            }
          }}
        />
      </EditorRow>
      <EditorActions>
        {draftValue !== '' && parsedValue === null ? (
          <ValidationMessage>Enter a value between 0 and 1</ValidationMessage>
        ) : null}
        <Button
          variant="ghost"
          type="button"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="button"
          disabled={parsedValue === null || saveAction.isInProgress}
          onClick={() => {
            if (parsedValue !== null) void saveAction.call(parsedValue);
          }}
        >
          Save override
        </Button>
      </EditorActions>
    </EditorRoot>
  );
}

function parseScoreValue(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}
