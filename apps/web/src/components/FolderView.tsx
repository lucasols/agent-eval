import type { EvalSummary } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { kicker, stack } from '#src/style/helpers';
import { selectFolder } from '../stores/selectionStore.ts';
import { EmptyState } from './EmptyState.tsx';
import { EvalCard } from './EvalCard.tsx';
import { PathBreadcrumb } from './PathBreadcrumb.tsx';

type FolderViewProps = {
  folderPath: string;
  evals: EvalSummary[];
};

const Root = styled.div`
  height: 100%;
  overflow: auto;
`;

const Header = styled.div`
  ${stack({ gap: 6 })}
  padding: 22px 32px 18px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bg.var};
  position: sticky;
  top: 0;
  z-index: 1;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
`;

const Count = styled.div`
  ${kicker}
  color: ${colors.textDim.var};
`;

const Stack = styled.div`
  ${stack({ gap: 20 })}
  padding: 24px 32px 40px;
`;

export function FolderView({ folderPath, evals }: FolderViewProps) {
  const displaySegments = folderPath
    .split('/')
    .filter((segment) => segment.length > 0);
  const currentLabel = displaySegments.at(-1) ?? '/';
  const parentSegments = displaySegments.slice(0, -1).map((label, index) => ({
    label,
    path: displaySegments.slice(0, index + 1).join('/'),
  }));

  return (
    <Root>
      <Header>
        <TitleRow>
          <PathBreadcrumb
            segments={parentSegments}
            currentLabel={currentLabel}
            onSelect={selectFolder}
          />
          <Count>
            {evals.length} {evals.length === 1 ? 'eval' : 'evals'}
          </Count>
        </TitleRow>
      </Header>
      {evals.length === 0 ? (
        <EmptyState
          title="No evals here"
          description="This folder doesn't contain any evals."
        />
      ) : (
        <Stack>
          {evals.map((ev) => (
            <EvalCard
              key={ev.id}
              evalSummary={ev}
              mode="stacked"
            />
          ))}
        </Stack>
      )}
    </Root>
  );
}
