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
  ${inline({ align: 'center', gap: 8 })}
  ${transition({ property: 'background, border-color, color, box-shadow' })}
  display: inline-flex;
  height: 28px;
  padding: 0 14px;
  border-radius: 0;
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  text-transform: uppercase;
  letter-spacing: 0.14em;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  & > svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  &.primary {
    background: ${colors.accent.var};
    color: ${colors.accentInk.var};
    box-shadow: 0 0 0 1px ${colors.accentDim.var},
      0 6px 16px -8px ${colors.accent.alpha(0.55)};
  }
  &.primary:hover:not(:disabled) {
    background: ${colors.accentHover.var};
    box-shadow: 0 0 0 1px ${colors.accentDim.var},
      0 8px 20px -6px ${colors.accent.alpha(0.7)};
  }
  &.primary:active:not(:disabled) {
    background: ${colors.accentDim.var};
  }

  &.secondary {
    background: transparent;
    color: ${colors.text.var};
    border-color: ${colors.borderStrong.var};
  }
  &.secondary:hover:not(:disabled) {
    background: ${colors.surfaceHover.var};
    border-color: ${colors.accent.alpha(0.4)};
    color: ${colors.accent.var};
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
