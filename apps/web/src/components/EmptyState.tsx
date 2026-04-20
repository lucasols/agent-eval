import { type ReactNode } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { kicker, stack } from '#src/style/helpers';

const Root = styled.div`
  ${stack({ align: 'center', justify: 'center', gap: 14 })}
  flex: 1;
  height: 100%;
  text-align: center;
  padding: 48px;
`;

const IconSlot = styled.div`
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.border.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.accent.var};
  margin-bottom: 4px;

  & > svg {
    width: 24px;
    height: 24px;
  }
`;

const Eyebrow = styled.div`
  ${kicker}
  color: ${colors.textMuted.var};
`;

const Title = styled.div`
  color: ${colors.text.var};
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
`;

const Body = styled.div`
  color: ${colors.textMuted.var};
  font-size: 12.5px;
  max-width: 360px;
  line-height: 1.55;
`;

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Root>
      {icon ? <IconSlot>{icon}</IconSlot> : null}
      <Eyebrow>Agent evals</Eyebrow>
      <Title>{title}</Title>
      {description ? <Body>{description}</Body> : null}
      {action}
    </Root>
  );
}
