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
  ${inline({ gap: 10, align: 'center' })}
  height: 56px;
  padding: 0 24px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  position: sticky;
  top: 0;
  z-index: 1;
`;

const FolderName = styled.div`
  ${monoFont}
  font-size: 13px;
  font-weight: 500;
  color: ${colors.text.var};
`;

const Count = styled.div`
  ${monoFont}
  font-size: 11px;
  color: ${colors.textDim.var};
  margin-left: 4px;
`;

const IconWrap = styled.span`
  display: inline-flex;
  color: ${colors.textDim.var};

  & > svg {
    width: 14px;
    height: 14px;
  }
`;

const Stack = styled.div`
  ${stack({ gap: 16 })}
  padding: 16px 24px 32px;
`;

export function FolderView({ folderPath, evals }: FolderViewProps) {
  return (
    <Root>
      <Header>
        <IconWrap>
          <FolderIcon />
        </IconWrap>
        <FolderName>{folderPath || 'root'}</FolderName>
        <Count>
          {evals.length} {evals.length === 1 ? 'eval' : 'evals'}
        </Count>
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
