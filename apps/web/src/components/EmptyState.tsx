import { type ReactNode } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { stack } from '#src/style/helpers';

const Root = styled.div`
  ${stack({ align: 'center', justify: 'center', gap: 12 })}
  flex: 1;
  height: 100%;
  text-align: center;
  padding: 48px;
`;

const IconSlot = styled.div`
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};
  margin-bottom: 4px;

  & > svg {
    width: 22px;
    height: 22px;
  }
`;

const Title = styled.div`
  color: ${colors.text.var};
  font-size: 14px;
  font-weight: 500;
`;

const Body = styled.div`
  color: ${colors.textMuted.var};
  font-size: 13px;
  max-width: 320px;
  line-height: 1.5;
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
      <Title>{title}</Title>
      {description ? <Body>{description}</Body> : null}
      {action}
    </Root>
  );
}
