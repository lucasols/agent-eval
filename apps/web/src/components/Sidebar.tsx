import { styled } from 'vindur';
import { RefreshCw } from 'lucide-react';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';
import { evalsStore, refreshDiscovery } from '../stores/evalsStore.ts';
import { EvalTree } from './EvalTree.tsx';
import { IconButton } from './IconButton.tsx';

const Root = styled.aside`
  ${stack()}
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
`;

const Header = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  height: 44px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid ${colors.border.var};
`;

const Title = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;
`;

const Spinner = styled.span`
  display: inline-flex;
  animation: spin 0.8s linear infinite;

  & > svg {
    width: 14px;
    height: 14px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const ScrollArea = styled.div`
  flex: 1;
  overflow: auto;
`;

export function Sidebar() {
  const { loading } = evalsStore.useSelectorRC((s) => ({ loading: s.loading }));

  return (
    <Root>
      <Header>
        <Title>Evals</Title>
        <IconButton
          onClick={() => void refreshDiscovery()}
          disabled={loading}
          aria-label="Refresh evals"
        >
          {loading ? (
            <Spinner>
              <RefreshCw />
            </Spinner>
          ) : (
            <RefreshCw />
          )}
        </IconButton>
      </Header>
      <ScrollArea>
        <EvalTree />
      </ScrollArea>
    </Root>
  );
}
