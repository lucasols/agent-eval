import { type ReactNode } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { stack } from '#src/style/helpers';

const Root = styled.div`
  ${stack({ align: 'center', justify: 'center', gap: 16 })}
  flex: 1;
  height: 100%;
  text-align: center;
  padding: 48px;
  position: relative;
`;

const IconSlot = styled.div`
  width: 64px;
  height: 64px;
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.borderStrong.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.accent.var};
  margin-bottom: 4px;
  position: relative;
  box-shadow:
    4px 4px 0 ${colors.bg.var},
    4px 4px 0 1px ${colors.borderStrong.var};

  & > svg {
    width: 26px;
    height: 26px;
  }
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: ${colors.accent.var};
`;

const Title = styled.div`
  color: ${colors.text.var};
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
`;

const Body = styled.div`
  color: ${colors.textMuted.var};
  font-size: 12.5px;
  max-width: 360px;
  line-height: 1.6;
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
      <Eyebrow>◆ Agentevals</Eyebrow>
      <Title>{title}</Title>
      {description ? <Body>{description}</Body> : null}
      {action}
    </Root>
  );
}
