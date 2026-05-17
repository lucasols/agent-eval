import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react';
import { Check, Filter, Search, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { styled } from 'vindur';
import { formatEvalTagLabel } from '#src/components/TagChips';
import { colors } from '#src/style/colors';
import { inline, stack, transition } from '#src/style/helpers';

const Root = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  flex-wrap: wrap;
  padding: 10px 12px 0;
`;

const Trigger = styled.button<{ active: boolean }>`
  ${inline({ gap: 5, align: 'center' })}
  ${transition({ property: 'background, border-color, color' })}
  appearance: none;
  border: 1px solid ${colors.border.var};
  border-radius: 999px;
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  padding: 4px 10px 4px 8px;
  font-size: 10px;
  line-height: 1;
  font-weight: 500;
  text-transform: uppercase;
  cursor: pointer;

  & > svg {
    width: 10px;
    height: 10px;
  }

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.accent.alpha(0.12)};
    border-color: ${colors.accent.alpha(0.32)};
    color: ${colors.accentDim.var};
  }
`;

const TriggerCount = styled.span`
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
`;

const ActiveChip = styled.button`
  ${inline({ gap: 4, align: 'center' })}
  ${transition({ property: 'background, border-color, color' })}
  appearance: none;
  border: 1px solid ${colors.accent.alpha(0.32)};
  border-radius: 999px;
  background: ${colors.accent.alpha(0.1)};
  color: ${colors.accentDim.var};
  padding: 3px 6px 3px 8px;
  font-size: 10px;
  line-height: 1;
  font-weight: 500;
  cursor: pointer;
  max-width: 100%;
  min-width: 0;

  & > svg {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  &:hover {
    background: ${colors.accent.alpha(0.16)};
    color: ${colors.text.var};
  }

  &:hover > svg {
    opacity: 1;
  }
`;

const ActiveChipLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  max-width: 120px;
`;

const ClearAllButton = styled.button`
  ${transition({ property: 'background, color' })}
  appearance: none;
  border: none;
  background: transparent;
  color: ${colors.textDim.var};
  padding: 4px 6px;
  font-size: 10px;
  line-height: 1;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: var(--radius-sm);

  &:hover {
    color: ${colors.text.var};
    background: ${colors.surface.var};
  }
`;

const PopoverLayer = styled.div`
  z-index: 60;
`;

const Popover = styled.div`
  ${stack({ gap: 0 })}
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  box-shadow: 0 14px 30px -12px ${colors.black.alpha(0.18)};
  min-width: 240px;
  max-width: 320px;
  overflow: hidden;
`;

const PopoverHeader = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  padding: 8px 10px;
  border-bottom: 1px solid ${colors.border.var};
  color: ${colors.textMuted.var};

  & > svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
`;

const SearchInput = styled.input`
  flex: 1;
  appearance: none;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: ${colors.text.var};
  padding: 2px 0;
  min-width: 0;

  &::placeholder {
    color: ${colors.textDim.var};
  }
`;

const TagList = styled.div`
  ${stack({ gap: 0 })}
  max-height: 280px;
  overflow: auto;
  padding: 4px 0;
`;

const TagRow = styled.button<{ selected: boolean }>`
  ${inline({ gap: 8, align: 'center', justify: 'space-between' })}
  ${transition({ property: 'background, color' })}
  appearance: none;
  background: transparent;
  border: none;
  padding: 6px 12px;
  text-align: left;
  cursor: pointer;
  color: ${colors.text.var};
  min-height: 28px;

  &:hover {
    background: ${colors.surfaceHover.var};
  }

  &.selected {
    color: ${colors.accentDim.var};
  }
`;

const TagRowMain = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  min-width: 0;
  flex: 1;
`;

const TagCheckbox = styled.span<{ selected: boolean }>`
  ${transition({ property: 'background, border-color, color' })}
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  border: 1.5px solid ${colors.borderStrong.var};
  background: ${colors.bg.var};
  color: ${colors.white.var};
  flex-shrink: 0;

  & > svg {
    width: 10px;
    height: 10px;
    opacity: 0;
  }

  &.selected {
    background: ${colors.accent.var};
    border-color: ${colors.accent.var};
  }

  &.selected > svg {
    opacity: 1;
  }
`;

const TagRowLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  min-width: 0;
  flex: 1;
`;

const TagRowCount = styled.span`
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  color: ${colors.textDim.var};
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

const PopoverFooter = styled.div`
  ${inline({ justify: 'space-between', align: 'center' })}
  padding: 6px 10px;
  border-top: 1px solid ${colors.border.var};
  color: ${colors.textMuted.var};
  font-size: 11px;
`;

const FooterButton = styled.button`
  ${transition({ property: 'color' })}
  appearance: none;
  background: transparent;
  border: none;
  padding: 2px 4px;
  font-size: 11px;
  color: ${colors.textMuted.var};
  cursor: pointer;

  &:hover:not(:disabled) {
    color: ${colors.text.var};
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const EmptyMessage = styled.div`
  padding: 14px 12px;
  color: ${colors.textMuted.var};
  font-size: 12px;
  text-align: center;
`;

export type TagFilterEntry = { tag: string; count: number };

type TagFilterProps = {
  availableTags: TagFilterEntry[];
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearAll: () => void;
};

/**
 * Renders the eval tag filter as a chip-styled trigger plus removable chips
 * for currently active selections. Opens a searchable popover so workspaces
 * with many tags stay compact instead of flooding the sidebar with inline
 * options.
 */
export function TagFilter({
  availableTags,
  selectedTags,
  onToggleTag,
  onClearAll,
}: TagFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery('');
    },
    placement: 'bottom-start',
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(220, availableHeight - 12)}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context, { outsidePress: true });
  const role = useRole(context, { role: 'dialog' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  const referenceProps = getReferenceProps();
  const floatingProps = getFloatingProps();

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 120,
    initial: { opacity: 0, transform: 'scale(0.97)' },
    common: { transformOrigin: 'top left' },
  });

  // Preserve the incoming order (already sorted by count desc, then name in
  // getTagBreakdown). Selection state must NOT influence ordering, otherwise
  // toggling a tag makes rows jump around under the cursor.
  const visibleTags = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0) return availableTags;
    return availableTags.filter(
      (entry) =>
        entry.tag.toLowerCase().includes(trimmed) ||
        formatEvalTagLabel(entry.tag).includes(trimmed),
    );
  }, [availableTags, query]);

  const selectedCount = selectedTags.size;
  const activeSelectedTags = useMemo(() => {
    const set = new Set(selectedTags);
    const knownInOrder = availableTags
      .filter((entry) => set.has(entry.tag))
      .map((entry) => entry.tag);
    for (const tag of set) {
      if (!knownInOrder.includes(tag)) knownInOrder.push(tag);
    }
    return knownInOrder;
  }, [availableTags, selectedTags]);

  if (availableTags.length === 0 && selectedCount === 0) return null;

  return (
    <Root aria-label="Eval tag filters">
      <Trigger
        ref={refs.setReference}
        type="button"
        active={selectedCount > 0}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...referenceProps}
      >
        <Filter aria-hidden="true" />
        Tags
        {selectedCount > 0 ? (
          <TriggerCount>{selectedCount}</TriggerCount>
        ) : null}
      </Trigger>
      {activeSelectedTags.map((tag) => (
        <ActiveChip
          key={tag}
          type="button"
          title={`Remove tag filter: ${tag}`}
          aria-label={`Remove tag filter ${tag}`}
          onClick={() => onToggleTag(tag)}
        >
          <ActiveChipLabel>{formatEvalTagLabel(tag)}</ActiveChipLabel>
          <X aria-hidden="true" />
        </ActiveChip>
      ))}
      {selectedCount > 1 ? (
        <ClearAllButton
          type="button"
          onClick={onClearAll}
        >
          Clear
        </ClearAllButton>
      ) : null}
      {isMounted ? (
        <FloatingPortal>
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={searchInputRef}
          >
            <PopoverLayer
              ref={refs.setFloating}
              style={floatingStyles}
              {...floatingProps}
            >
              <Popover style={transitionStyles}>
                <PopoverHeader>
                  <Search aria-hidden="true" />
                  <SearchInput
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    placeholder="Search tags"
                    aria-label="Search tags"
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                </PopoverHeader>
                {visibleTags.length === 0 ? (
                  <EmptyMessage>
                    {availableTags.length === 0
                      ? 'No tags discovered in this workspace.'
                      : `No tags match "${query.trim()}".`}
                  </EmptyMessage>
                ) : (
                  <TagList role="listbox">
                    {visibleTags.map(({ tag, count }) => {
                      const isSelected = selectedTags.has(tag);
                      return (
                        <TagRow
                          key={tag}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          selected={isSelected}
                          onClick={() => onToggleTag(tag)}
                        >
                          <TagRowMain>
                            <TagCheckbox selected={isSelected}>
                              <Check aria-hidden="true" />
                            </TagCheckbox>
                            <TagRowLabel title={tag}>
                              {formatEvalTagLabel(tag)}
                            </TagRowLabel>
                          </TagRowMain>
                          <TagRowCount>{count}</TagRowCount>
                        </TagRow>
                      );
                    })}
                  </TagList>
                )}
                <PopoverFooter>
                  <span>
                    {selectedCount} of {availableTags.length} selected
                  </span>
                  <FooterButton
                    type="button"
                    onClick={onClearAll}
                    disabled={selectedCount === 0}
                  >
                    Clear
                  </FooterButton>
                </PopoverFooter>
              </Popover>
            </PopoverLayer>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </Root>
  );
}
