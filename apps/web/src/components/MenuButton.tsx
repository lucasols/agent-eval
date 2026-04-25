import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { centerContent, stack, transition } from '#src/style/helpers';
import {
  type SplitButtonMenuEntry,
  type SplitButtonMenuItem,
} from './SplitButton.tsx';

type MenuButtonProps = {
  menu: SplitButtonMenuEntry[];
  disabled?: boolean;
  'aria-label'?: string;
};

const Root = styled.div`
  position: relative;
  display: inline-flex;
`;

const Trigger = styled.button`
  ${centerContent};
  ${transition({ property: 'background, color, border-color' })}
  appearance: none;
  padding: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
  background: ${colors.bg.var};
  color: ${colors.textMuted.var};
  line-height: 0;
  box-shadow: 0 1px 2px ${colors.black.alpha(0.08)};

  &:hover:not(:disabled) {
    background: ${colors.surface.var};
    color: ${colors.text.var};
    border-color: ${colors.borderStrong.var};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  & > svg {
    width: 16px;
    height: 16px;
  }
`;

const Menu = styled.div`
  ${stack({ gap: 0 })}
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 210px;
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.borderStrong.var};
  box-shadow: 0 14px 30px -12px ${colors.accent.alpha(0.25)};
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

function isMenuItem(entry: SplitButtonMenuEntry): entry is SplitButtonMenuItem {
  return !('kind' in entry);
}

export function MenuButton({
  menu,
  disabled,
  'aria-label': ariaLabel,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClickAway(event: MouseEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
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
      <Trigger
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel ?? 'More actions'}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal />
      </Trigger>

      {open ? (
        <Menu
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          {menu.map((entry, index) =>
            isMenuItem(entry) ? (
              <MenuItem
                key={entry.id}
                role="menuitem"
                danger={entry.tone === 'danger'}
                onClick={() => {
                  setOpen(false);
                  entry.onSelect();
                }}
              >
                <ItemLabel>{entry.label}</ItemLabel>
                {entry.description ? (
                  <ItemDescription>{entry.description}</ItemDescription>
                ) : null}
              </MenuItem>
            ) : (
              <Separator key={`sep-${String(index)}`} />
            ),
          )}
        </Menu>
      ) : null}
    </Root>
  );
}
