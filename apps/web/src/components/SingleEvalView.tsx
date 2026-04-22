import type { EvalSummary } from '@ls-stack/agent-eval';
import { styled } from 'vindur';
import { EvalCard } from './EvalCard.tsx';

const Root = styled.div`
  height: 100%;
  overflow: hidden;
  background: transparent;
`;

type SingleEvalViewProps = { evalSummary: EvalSummary };

export function SingleEvalView({ evalSummary }: SingleEvalViewProps) {
  return (
    <Root>
      <EvalCard
        evalSummary={evalSummary}
        mode="single"
      />
    </Root>
  );
}
