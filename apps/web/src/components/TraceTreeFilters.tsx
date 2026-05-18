import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { styled } from 'vindur';
import { Tooltip } from '#src/components/Tooltip';
import { colors } from '#src/style/colors';
import { inline, monoFont, transition } from '#src/style/helpers';

export type SpanKindFilterMode = 'all' | 'only' | 'hide';
export type FilteredSpanVisibility = 'hidden' | 'faded';

type TraceFilterToolbarProps = {
  filteredLabel: string;
  filteredSpanVisibility: FilteredSpanVisibility;
  onFilteredSpanVisibilityChange: (visibility: FilteredSpanVisibility) => void;
  onSpanKindFilterModeChange: (mode: SpanKindFilterMode) => void;
  onSpanKindToggle: (kind: string) => void;
  onSpanNameFilterPatternChange: (pattern: string) => void;
  onSpanNameFilterVisibleChange: (visible: boolean) => void;
  selectedSpanKinds: Set<string>;
  showFilterOptions: boolean;
  showSpanNameFilter: boolean;
  spanKindFilterMode: SpanKindFilterMode;
  spanKindOptions: string[];
  spanNameFilterPattern: string;
};

const TimelineToolbar = styled.div<{ hasFilterOptions: boolean }>`
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 24px;
  column-gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  flex-shrink: 0;

  &.hasFilterOptions {
    grid-template-rows: 24px auto;
    row-gap: 6px;
  }
`;

const TimelineCount = styled.span`
  ${monoFont};
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${colors.textDim.var};
  white-space: nowrap;
  grid-column: 1;
  grid-row: 1;
`;

const FilterControls = styled.div`
  ${inline({ justify: 'right', align: 'center', gap: 6 })}
  min-width: 0;
  grid-column: 2;
  grid-row: 1;
`;

const FilterOptionsRow = styled.div`
  ${inline({ justify: 'left', align: 'left', gap: 8 })}
  flex-wrap: wrap;
  min-width: 0;
  min-height: 24px;
  grid-column: 1 / -1;
  grid-row: 2;
`;

const SegmentedControl = styled.div`
  ${inline({ align: 'center' })}
  border: 1px solid ${colors.border.var};
  border-radius: 5px;
  overflow: hidden;
  background: ${colors.bg.var};
  flex-shrink: 0;
`;

const SegmentButton = styled.button<{ active: boolean }>`
  ${transition({ property: 'background, color' })}
  height: 24px;
  padding: 0 9px;
  border: none;
  border-right: 1px solid ${colors.border.var};
  background: transparent;
  color: ${colors.textDim.var};
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;

  &:last-child {
    border-right: none;
  }

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.surfaceActive.var};
    color: ${colors.text.var};
  }
`;

const NameFilterButton = styled.button<{ active: boolean }>`
  ${transition({ property: 'background, color, border-color' })}
  width: 26px;
  height: 24px;
  padding: 0;
  border: 1px solid ${colors.border.var};
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${colors.bg.var};
  color: ${colors.textDim.var};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    border-color: ${colors.borderStrong.var};
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &.active {
    border-color: ${colors.accent.alpha(0.45)};
    background: ${colors.accent.alpha(0.1)};
    color: ${colors.text.var};
  }

  & > svg {
    width: 13px;
    height: 13px;
  }
`;

const SpanNameFilter = styled.div`
  ${inline({ align: 'center' })}
  flex: 1 1 260px;
  max-width: 420px;
  min-width: 210px;
  height: 24px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  overflow: hidden;

  &:focus-within {
    border-color: ${colors.accent.alpha(0.55)};
  }
`;

const SpanNameFilterInput = styled.input`
  ${monoFont};
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 8px;
  border: none;
  outline: none;
  background: transparent;
  color: ${colors.text.var};
  font-size: 11px;

  &::placeholder {
    color: ${colors.textDim.var};
  }
`;

const ClearNameFilterButton = styled.button`
  ${transition({ property: 'background, color' })}
  width: 24px;
  height: 22px;
  padding: 0;
  border: none;
  border-left: 1px solid ${colors.border.var};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: ${colors.textDim.var};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 12px;
    height: 12px;
  }
`;

const KindFilterList = styled.div`
  ${inline({ align: 'center', gap: 4 })}
  justify-content: flex-start;
  flex: 1 1 280px;
  flex-wrap: wrap;
  min-width: 0;
`;

const KindFilterOption = styled.label<{ selected: boolean }>`
  ${inline({ align: 'center', gap: 5 })}
  height: 24px;
  padding: 0 8px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  color: ${colors.textMuted.var};
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;

  &:hover {
    border-color: ${colors.borderStrong.var};
    color: ${colors.text.var};
  }

  &.selected {
    border-color: ${colors.accent.alpha(0.45)};
    background: ${colors.accent.alpha(0.1)};
    color: ${colors.text.var};
  }

  & > input {
    width: 12px;
    height: 12px;
    margin: 0;
    accent-color: ${colors.accent.var};
  }
`;

const VisibilityToggleLabel = styled.label`
  ${inline({ align: 'center', gap: 6 })}
  flex-shrink: 0;
  height: 24px;
  padding: 0 8px;
  color: ${colors.textMuted.var};
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;

  &:hover {
    color: ${colors.text.var};
  }

  & > input {
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: ${colors.accent.var};
  }
`;

export function TraceFilterToolbar({
  filteredLabel,
  filteredSpanVisibility,
  onFilteredSpanVisibilityChange,
  onSpanKindFilterModeChange,
  onSpanKindToggle,
  onSpanNameFilterPatternChange,
  onSpanNameFilterVisibleChange,
  selectedSpanKinds,
  showFilterOptions,
  showSpanNameFilter,
  spanKindFilterMode,
  spanKindOptions,
  spanNameFilterPattern,
}: TraceFilterToolbarProps) {
  const spanNameFilterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showSpanNameFilter) return;
    spanNameFilterInputRef.current?.focus();
  }, [showSpanNameFilter]);

  return (
    <TimelineToolbar hasFilterOptions={showFilterOptions}>
      <TimelineCount>{filteredLabel}</TimelineCount>
      <FilterControls>
        <SegmentedControl>
          <SegmentButton
            type="button"
            active={spanKindFilterMode === 'all'}
            onClick={() => onSpanKindFilterModeChange('all')}
            aria-pressed={spanKindFilterMode === 'all'}
          >
            All
          </SegmentButton>
          <SegmentButton
            type="button"
            active={spanKindFilterMode === 'only'}
            onClick={() => onSpanKindFilterModeChange('only')}
            aria-pressed={spanKindFilterMode === 'only'}
          >
            Only
          </SegmentButton>
          <SegmentButton
            type="button"
            active={spanKindFilterMode === 'hide'}
            onClick={() => onSpanKindFilterModeChange('hide')}
            aria-pressed={spanKindFilterMode === 'hide'}
          >
            Hide
          </SegmentButton>
        </SegmentedControl>
        <Tooltip content="Filter by span name">
          <NameFilterButton
            type="button"
            active={showSpanNameFilter}
            onClick={() => onSpanNameFilterVisibleChange(true)}
            aria-label="Filter by span name"
            aria-pressed={showSpanNameFilter}
          >
            <Search />
          </NameFilterButton>
        </Tooltip>
      </FilterControls>
      {showFilterOptions ? (
        <FilterOptionsRow>
          {showSpanNameFilter ? (
            <SpanNameFilter>
              <SpanNameFilterInput
                ref={spanNameFilterInputRef}
                value={spanNameFilterPattern}
                onChange={(event) =>
                  onSpanNameFilterPatternChange(event.currentTarget.value)
                }
                placeholder="POST v3/tabs/*/ok"
                aria-label="Span name wildcard"
              />
              <Tooltip content="Clear span name filter">
                <ClearNameFilterButton
                  type="button"
                  onClick={() => {
                    onSpanNameFilterPatternChange('');
                    onSpanNameFilterVisibleChange(false);
                  }}
                  aria-label="Clear span name filter"
                >
                  <X />
                </ClearNameFilterButton>
              </Tooltip>
            </SpanNameFilter>
          ) : null}
          {spanKindFilterMode !== 'all' ? (
            <>
              <VisibilityToggleLabel>
                <input
                  type="checkbox"
                  checked={filteredSpanVisibility === 'faded'}
                  onChange={(event) => {
                    onFilteredSpanVisibilityChange(
                      event.currentTarget.checked ? 'faded' : 'hidden',
                    );
                  }}
                />
                Fade filtered
              </VisibilityToggleLabel>
              <KindFilterList>
                {spanKindOptions.map((kind) => (
                  <KindFilterOption
                    key={kind}
                    selected={selectedSpanKinds.has(kind)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSpanKinds.has(kind)}
                      onChange={() => onSpanKindToggle(kind)}
                    />
                    {kind}
                  </KindFilterOption>
                ))}
              </KindFilterList>
            </>
          ) : null}
        </FilterOptionsRow>
      ) : null}
    </TimelineToolbar>
  );
}
