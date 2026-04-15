import { styled, css } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { inline } from '#src/style/helpers.ts';
import { evalsStore } from '../stores/evalsStore.ts';
import { runStore, startRun, cancelRun, setTrials } from '../stores/runStore.ts';

const ToolbarContainer = styled.div`
  padding: 8px 16px;
  border-bottom: 1px solid ${colors.border.var};
  ${inline({ gap: 8 })}
  background: ${colors.surface.var};
`;

const PrimaryButton = styled.button`
  padding: 6px 12px;
  background: ${colors.accent.var};
  color: ${colors.white.var};
  border: none;
  border-radius: var(--radius-sm);
  font-weight: 500;
  font-size: 13px;
`;

const SecondaryButton = styled.button`
  padding: 6px 12px;
  background: transparent;
  color: ${colors.text.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  font-size: 13px;
`;

const CancelButton = styled.button`
  padding: 6px 12px;
  background: transparent;
  color: ${colors.error.var};
  border: 1px solid ${colors.error.var};
  border-radius: var(--radius-sm);
  font-size: 13px;
`;

const Spacer = styled.div`
  flex: 1;
`;

const ToolbarLabel = styled.label`
  font-size: 12px;
  color: ${colors.textSecondary.var};
  ${inline({ gap: 4 })}
`;

const NumberInput = styled.input`
  width: 48px;
  background: ${colors.bg.var};
  color: ${colors.text.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 12px;
  text-align: center;
`;

const disabledOpacity = css`
  opacity: 0.5;
`;

export function RunToolbar() {
  const { selectedEvalIds } = evalsStore.useSelectorRC((s) => ({
    selectedEvalIds: s.selectedEvalIds,
  }));
  const { currentRun, trials } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
    trials: s.trials,
  }));

  const isRunning = currentRun?.manifest.status === 'running';

  function handleRunSelected() {
    const ids = [...selectedEvalIds];
    void startRun({ mode: 'evalIds', evalIds: ids });
  }

  function handleRunAll() {
    void startRun({ mode: 'all' });
  }

  return (
    <ToolbarContainer>
      <PrimaryButton
        onClick={handleRunSelected}
        disabled={isRunning || selectedEvalIds.size === 0}
        css={isRunning || selectedEvalIds.size === 0 ? disabledOpacity : undefined}
      >
        Run Selected
      </PrimaryButton>
      <SecondaryButton
        onClick={handleRunAll}
        disabled={isRunning}
        css={isRunning ? disabledOpacity : undefined}
      >
        Run All
      </SecondaryButton>
      {isRunning ? (
        <CancelButton onClick={() => void cancelRun()}>
          Cancel
        </CancelButton>
      ) : null}

      <Spacer />

      <ToolbarLabel>
        Trials:
        <NumberInput
          type="number"
          min={1}
          max={100}
          value={trials}
          onChange={(e) => setTrials(Number(e.target.value))}
        />
      </ToolbarLabel>
    </ToolbarContainer>
  );
}
