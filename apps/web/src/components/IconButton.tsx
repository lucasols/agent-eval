import { styled } from 'vindur';
import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { colors } from '#src/style/colors';
import { centerContent, transition } from '#src/style/helpers';

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  size?: 'sm' | 'md';
};

const Root = styled.button<{ md: boolean }>`
  ${centerContent}
  ${transition({ property: 'background, color' })}
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: ${colors.textMuted.var};
  flex-shrink: 0;

  &.md {
    width: 28px;
    height: 28px;
  }

  &:hover:not(:disabled) {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  & > svg {
    width: 14px;
    height: 14px;
  }

  &.md > svg {
    width: 16px;
    height: 16px;
  }
`;

export function IconButton({ children, size = 'sm', ...rest }: IconButtonProps) {
  return (
    <Root type="button" {...rest} md={size === 'md'}>
      {children}
    </Root>
  );
}
