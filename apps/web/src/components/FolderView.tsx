import type { EvalSummary } from '@agent-evals/shared';
import { Folder as FolderIcon } from 'lucide-react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, stack } from '#src/style/helpers';
import { EmptyState } from './EmptyState.tsx';
import { EvalCard } from './EvalCard.tsx';

type FolderViewProps = { folderPath: string; evals: EvalSummary[] };

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

const Eyebrow = styled.div`
  ${kicker}
  ${inline({ gap: 8, align: 'center' })}
  color: ${colors.textMuted.var};
`;

const EyebrowIcon = styled.span`
  display: inline-flex;
  color: ${colors.accent.var};

  & > svg {
    width: 12px;
    height: 12px;
  }
`;

const TitleRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 14px;
`;

const FolderName = styled.div`
  font-size: 20px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.02em;
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
  return (
    <Root>
      <Header>
        <TitleRow>
          <FolderName>{folderPath || '/'}</FolderName>
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
