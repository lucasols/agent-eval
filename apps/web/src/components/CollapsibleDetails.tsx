import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, stack, transition } from '#src/style/helpers';

const Root = styled.div`
  ${stack({ align: 'left', gap: 6 })}
  min-width: 0;
`;

const Toggle = styled.button`
  ${inline({ align: 'center', gap: 4 })}
  ${transition({ property: 'background, border-color, color' })}
  height: 24px;
  padding: 0 8px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: transparent;
  color: ${colors.textMuted.var};
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;

  &:hover {
    background: ${colors.surface.var};
    border-color: ${colors.borderStrong.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
`;

const Content = styled.div`
  ${stack({ gap: 8 })}
  width: 100%;
  min-width: 0;
`;

export function CollapsibleDetails({
  children,
  showLabel = 'Show details',
  hideLabel = 'Hide details',
}: {
  children: ReactNode;
  showLabel?: string;
  hideLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Root>
      <Toggle
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((current) => !current);
        }}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
        {expanded ? hideLabel : showLabel}
      </Toggle>
      {expanded ? <Content>{children}</Content> : null}
    </Root>
  );
}
