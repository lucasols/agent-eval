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
  ${transition({ property: 'background, color, border-color' })}
  width: 26px;
  height: 26px;
  border-radius: 0;
  border: 1px solid transparent;
  background: transparent;
  color: ${colors.textMuted.var};
  flex-shrink: 0;

  &.md {
    width: 30px;
    height: 30px;
  }

  &:hover:not(:disabled) {
    background: ${colors.surfaceHover.var};
    color: ${colors.accent.var};
    border-color: ${colors.borderStrong.var};
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
