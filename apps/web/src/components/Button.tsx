import { styled } from 'vindur';
import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { colors } from '#src/style/colors';
import { inline, transition } from '#src/style/helpers';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
};

const Root = styled.button<{
  primary: boolean;
  secondary: boolean;
  ghost: boolean;
  danger: boolean;
}>`
  ${inline({ align: 'center', gap: 6 })}
  ${transition({ property: 'background, border-color, color' })}
  display: inline-flex;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  letter-spacing: 0.01em;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  &.primary {
    background: ${colors.accent.var};
    color: ${colors.accentInk.var};
  }
  &.primary:hover:not(:disabled) {
    background: ${colors.accentHover.var};
  }
  &.primary:active:not(:disabled) {
    background: ${colors.accentDim.var};
  }

  &.secondary {
    background: ${colors.surface.var};
    color: ${colors.text.var};
    border-color: ${colors.border.var};
  }
  &.secondary:hover:not(:disabled) {
    background: ${colors.surfaceHover.var};
    border-color: ${colors.borderStrong.var};
  }

  &.ghost {
    background: transparent;
    color: ${colors.textMuted.var};
  }
  &.ghost:hover:not(:disabled) {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &.danger {
    background: transparent;
    color: ${colors.error.var};
    border-color: ${colors.error.alpha(0.4)};
  }
  &.danger:hover:not(:disabled) {
    background: ${colors.error.alpha(0.1)};
    border-color: ${colors.error.var};
  }
`;

export function Button({
  variant = 'secondary',
  leftIcon,
  rightIcon,
  children,
  ...rest
}: ButtonProps) {
  return (
    <Root
      type="button"
      {...rest}
      primary={variant === 'primary'}
      secondary={variant === 'secondary'}
      ghost={variant === 'ghost'}
      danger={variant === 'danger'}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </Root>
  );
}
