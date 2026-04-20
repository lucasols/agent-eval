import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, stack } from '#src/style/helpers';
import { evalsStore } from '../stores/evalsStore.ts';
import { EvalTree } from './EvalTree.tsx';

const Root = styled.aside`
  ${stack()}
  width: 248px;
  flex-shrink: 0;
  border-right: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
  position: relative;
`;

const Masthead = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  padding: 14px 16px;
  border-bottom: 1px solid ${colors.border.var};
`;

const Mark = styled.div`
  width: 26px;
  height: 26px;
  background: linear-gradient(
    135deg,
    ${colors.accent.var},
    ${colors.accentDim.var}
  );
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: ${colors.accentInk.var};
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: -0.02em;
  box-shadow: 0 0 20px ${colors.accent.alpha(0.2)};
`;

const BrandText = styled.div`
  ${stack({ gap: 1 })}
  flex: 1;
  min-width: 0;
`;

const Wordmark = styled.div`
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: ${colors.text.var};
`;

const BrandSub = styled.div`
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  color: ${colors.textMuted.var};
  font-variant-numeric: tabular-nums;
`;

const SectionHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 8 })}
  padding: 12px 16px 6px;
`;

const SectionLabel = styled.span`
  ${kicker}
  color: ${colors.textMuted.var};
`;

const SectionCounter = styled.span`
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  color: ${colors.textDim.var};
  font-variant-numeric: tabular-nums;
`;

const ScrollArea = styled.div`
  flex: 1;
  overflow: auto;
  padding-bottom: 10px;
`;

export function Sidebar() {
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));

  return (
    <Root>
      <Masthead>
        <Mark>ae</Mark>
        <BrandText>
          <Wordmark>agent evals</Wordmark>
          <BrandSub>workspace · main</BrandSub>
        </BrandText>
      </Masthead>
      <SectionHeader>
        <SectionLabel>Evals</SectionLabel>
        <SectionCounter>{evals.length}</SectionCounter>
      </SectionHeader>
      <ScrollArea>
        <EvalTree />
      </ScrollArea>
    </Root>
  );
}
