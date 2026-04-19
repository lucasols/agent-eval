import { useEffect, useRef, useState, type ReactNode } from 'react';
import { styled } from 'vindur';
import { ChevronDown } from 'lucide-react';
import { colors } from '#src/style/colors';
import { inline, stack, transition } from '#src/style/helpers';

/** Single selectable action inside a `SplitButton` menu. */
export type SplitButtonMenuItem = {
  id: string;
  label: string;
  description?: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
};

/** Separator row rendered between groups of menu items. */
export type SplitButtonMenuSeparator = { kind: 'separator' };

/** Entry accepted by the `menu` prop: either an action or a separator. */
export type SplitButtonMenuEntry =
  | SplitButtonMenuItem
  | SplitButtonMenuSeparator;

type SplitButtonProps = {
  label: ReactNode;
  leftIcon?: ReactNode;
  disabled?: boolean;
  onPrimaryClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  menu: SplitButtonMenuEntry[];
  'aria-label'?: string;
};

/**
 * Button composed of a primary action plus a chevron-triggered menu of
 * secondary actions.
 *
 * Used on `EvalCard` to expose cache mode controls (run normally, no cache,
 * refresh, clear) alongside the default Run action.
 */
export function SplitButton({
  label,
  leftIcon,
  disabled,
  onPrimaryClick,
  menu,
  'aria-label': ariaLabel,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClickAway(event: MouseEvent) {
      if (
        rootRef.current
        && event.target instanceof Node
        && !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <Root ref={rootRef}>
      <PrimaryRow>
        <Primary
          type="button"
          onClick={onPrimaryClick}
          disabled={disabled}
          aria-label={ariaLabel}
        >
          {leftIcon}
          <span>{label}</span>
        </Primary>
        <Chevron
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Show more actions"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
          isOpen={open}
        >
          <ChevronDown />
        </Chevron>
      </PrimaryRow>

      {open ?
        <Menu
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          {menu.map((entry, index) =>
            'kind' in entry ?
              <Separator key={`sep-${String(index)}`} />
            : <MenuItem
                key={entry.id}
                role="menuitem"
                danger={entry.tone === 'danger'}
                onClick={() => {
                  setOpen(false);
                  entry.onSelect();
                }}
              >
                <ItemLabel>{entry.label}</ItemLabel>
                {entry.description ?
                  <ItemDescription>{entry.description}</ItemDescription>
                : null}
              </MenuItem>,
          )}
        </Menu>
      : null}
    </Root>
  );
}

const Root = styled.div`
  position: relative;
  display: inline-flex;
`;

const PrimaryRow = styled.div`
  ${inline({ gap: 0 })}
`;

const Primary = styled.button`
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
  background: ${colors.accent.var};
  color: ${colors.accentInk.var};
  box-shadow:
    0 0 0 1px ${colors.accentDim.var},
    0 6px 16px -8px ${colors.accent.alpha(0.55)};

  & > svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  &:hover:not(:disabled) {
    background: ${colors.accentHover.var};
  }
  &:active:not(:disabled) {
    background: ${colors.accentDim.var};
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
`;

const Chevron = styled.button<{ isOpen: boolean }>`
  ${transition({ property: 'background, border-color, color' })}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  width: 26px;
  margin-left: 1px;
  border-radius: 0;
  border: 1px solid transparent;
  background: ${colors.accent.var};
  color: ${colors.accentInk.var};
  box-shadow: 0 0 0 1px ${colors.accentDim.var};

  & > svg {
    width: 13px;
    height: 13px;
    transition: transform 0.18s ease;
  }

  &.isOpen > svg {
    transform: rotate(180deg);
  }

  &:hover:not(:disabled) {
    background: ${colors.accentHover.var};
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
`;

const Menu = styled.div`
  ${stack({ gap: 0 })}
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.borderStrong.var};
  box-shadow: 0 14px 30px -12px ${colors.accent.alpha(0.35)};
  z-index: 40;
  padding: 6px 0;
`;

const MenuItem = styled.button<{ danger: boolean }>`
  ${stack({ gap: 2 })}
  ${transition({ property: 'background, color' })}
  text-align: left;
  background: transparent;
  border: 0;
  padding: 8px 14px;
  color: ${colors.text.var};
  cursor: pointer;

  &:hover {
    background: ${colors.surfaceHover.var};
  }

  &.danger {
    color: ${colors.error.var};
  }
  &.danger:hover {
    background: ${colors.error.alpha(0.1)};
  }
`;

const ItemLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
`;

const ItemDescription = styled.div`
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const Separator = styled.div`
  height: 1px;
  background: ${colors.border.var};
  margin: 4px 0;
`;
