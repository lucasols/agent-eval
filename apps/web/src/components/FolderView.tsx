import { styled } from 'vindur';
import { Folder as FolderIcon } from 'lucide-react';
import type { EvalSummary } from '@agent-evals/shared';
import { colors } from '#src/style/colors';
import { inline, monoFont, stack } from '#src/style/helpers';
import { EvalCard } from './EvalCard.tsx';
import { EmptyState } from './EmptyState.tsx';

type FolderViewProps = {
  folderPath: string;
  evals: EvalSummary[];
};

const Root = styled.div`
  height: 100%;
  overflow: auto;
`;

const Header = styled.div`
  ${stack({ gap: 4 })}
  padding: 24px 32px 20px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.alpha(0.5)};
  position: sticky;
  top: 0;
  z-index: 1;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(
      90deg,
      ${colors.accent.var} 0%,
      ${colors.accent.var} 64px,
      transparent 64px,
      transparent 100%
    );
  }
`;

const Eyebrow = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: ${colors.accent.var};
`;

const EyebrowIcon = styled.span`
  display: inline-flex;

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
  ${monoFont}
  font-size: 22px;
  font-weight: 800;
  color: ${colors.text.var};
  letter-spacing: -0.02em;
`;

const Count = styled.div`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
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
        <Eyebrow>
          <EyebrowIcon>
            <FolderIcon />
          </EyebrowIcon>
          Folder
        </Eyebrow>
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
            <EvalCard key={ev.id} evalSummary={ev} mode="stacked" />
          ))}
        </Stack>
      )}
    </Root>
  );
}
