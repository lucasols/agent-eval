import { styled, css } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { inline, stack, ellipsis } from '#src/style/helpers.ts';
import { evalsStore, toggleEvalSelection, refreshDiscovery } from '../stores/evalsStore.ts';

const Sidebar = styled.aside`
  ${stack()}
  width: 260px;
  border-right: 1px solid ${colors.border.var};
  background: ${colors.surface.var};
  overflow: hidden;
`;

const Header = styled.div`
  ${inline({ justify: 'space-between' })}
  padding: 12px 16px;
  border-bottom: 1px solid ${colors.border.var};
`;

const HeaderTitle = styled.span`
  font-weight: 600;
  font-size: 13px;
`;

const RefreshButton = styled.button`
  background: none;
  border: none;
  color: ${colors.accent.var};
  font-size: 12px;
`;

const ListArea = styled.div`
  flex: 1;
  overflow: auto;
  padding: 8px 0;
`;

const EmptyMessage = styled.div`
  padding: 16px;
  color: ${colors.textMuted.var};
  font-size: 13px;
`;

const selectedStyle = css`
  background: ${colors.surfaceHover.var};
`;

const EvalButton = styled.button`
  ${inline({ gap: 8 })}
  width: 100%;
  padding: 8px 16px;
  background: transparent;
  border: none;
  color: ${colors.text.var};
  text-align: left;
  font-size: 13px;
`;

const Checkbox = styled.input`
  pointer-events: none;
`;

const EvalInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const EvalTitle = styled.div`
  font-weight: 500;
  ${ellipsis}
`;

const EvalPath = styled.div`
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const StaleLabel = styled.span`
  font-size: 10px;
  color: ${colors.warning.var};
`;

const Dot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
`;

const dotPass = css`
  background: ${colors.success.var};
`;

const dotFail = css`
  background: ${colors.error.var};
`;

const dotRunning = css`
  background: ${colors.accent.var};
`;

const dotDefault = css`
  background: ${colors.textMuted.var};
`;

export function SidebarEvalList() {
  const { evals, loading, selectedEvalIds } = evalsStore.useState();

  return (
    <Sidebar>
      <Header>
        <HeaderTitle>Eval Suites</HeaderTitle>
        <RefreshButton
          onClick={() => void refreshDiscovery()}
          disabled={loading}
        >
          {loading ? '...' : 'Refresh'}
        </RefreshButton>
      </Header>
      <ListArea>
        {evals.length === 0 && !loading ? (
          <EmptyMessage>No eval files found</EmptyMessage>
        ) : null}
        {evals.map((ev) => {
          const selected = selectedEvalIds.has(ev.id);
          return (
            <EvalButton
              key={ev.id}
              onClick={() => toggleEvalSelection(ev.id)}
              cx={{ [selectedStyle]: selected }}
            >
              <Checkbox
                type="checkbox"
                checked={selected}
                readOnly
              />
              <EvalInfo>
                <EvalTitle>{ev.title ?? ev.id}</EvalTitle>
                <EvalPath>{ev.filePath}</EvalPath>
              </EvalInfo>
              {ev.stale ? <StaleLabel>stale</StaleLabel> : null}
              {ev.lastRunStatus ? (
                <StatusDot status={ev.lastRunStatus} />
              ) : null}
            </EvalButton>
          );
        })}
      </ListArea>
    </Sidebar>
  );
}

function StatusDot({ status }: { status: string }) {
  const dotColor =
    status === 'pass' ? dotPass
    : status === 'fail' || status === 'error' ? dotFail
    : status === 'running' ? dotRunning
    : dotDefault;

  return <Dot css={dotColor} />;
}
