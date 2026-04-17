import { styled } from 'vindur';
import { RefreshCw } from 'lucide-react';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';
import { evalsStore, refreshDiscovery } from '../stores/evalsStore.ts';
import { EvalTree } from './EvalTree.tsx';
import { IconButton } from './IconButton.tsx';

const Root = styled.aside`
  ${stack()}
  width: 296px;
  flex-shrink: 0;
  border-right: 1px solid ${colors.border.var};
  background: linear-gradient(
    180deg,
    ${colors.bgElevated.var} 0%,
    ${colors.bg.var} 100%
  );
  overflow: hidden;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 1px;
    height: 60%;
    background: linear-gradient(
      180deg,
      ${colors.accent.alpha(0)} 0%,
      ${colors.accent.alpha(0.3)} 40%,
      ${colors.accent.alpha(0)} 100%
    );
  }
`;

const Masthead = styled.div`
  ${stack({ gap: 2 })}
  padding: 20px 20px 16px;
  border-bottom: 1px solid ${colors.border.var};
  position: relative;
`;

const MastheadTop = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
`;

const Brand = styled.div`
  ${inline({ gap: 10, align: 'center' })}
`;

const Mark = styled.div`
  width: 22px;
  height: 22px;
  background: ${colors.accent.var};
  color: ${colors.accentInk.var};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: -0.02em;
  box-shadow:
    2px 2px 0 ${colors.bg.var},
    2px 2px 0 1px ${colors.borderStrong.var};
`;

const Wordmark = styled.div`
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: ${colors.text.var};
`;

const Tagline = styled.div`
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: ${colors.textDim.var};
  margin-top: 6px;
  padding-left: 32px;
`;

const SectionHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  padding: 14px 20px 8px;
  border-bottom: 1px solid ${colors.border.alpha(0.5)};
`;

const SectionLabel = styled.div`
  ${inline({ gap: 8, align: 'center' })}
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: ${colors.textMuted.var};
`;

const SectionCounter = styled.span`
  color: ${colors.accent.var};
  font-weight: 700;
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
  const { loading, evals } = evalsStore.useSelectorRC((s) => ({
    loading: s.loading,
    evals: s.evals,
  }));

  return (
    <Root>
      <Masthead>
        <MastheadTop>
          <Brand>
            <Mark>◆</Mark>
            <Wordmark>Agentevals</Wordmark>
          </Brand>
        </MastheadTop>
        <Tagline>Local · Deterministic · Observable</Tagline>
      </Masthead>
      <SectionHeader>
        <SectionLabel>
          Evals <SectionCounter>[{String(evals.length).padStart(2, '0')}]</SectionCounter>
        </SectionLabel>
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
      </SectionHeader>
      <ScrollArea>
        <EvalTree />
      </ScrollArea>
    </Root>
  );
}
