import type { EvalDisplayStatus } from '@agent-evals/shared';
import { ChevronsDownUp, ChevronsUpDown, Search, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { styled } from 'vindur';
import { EvalTree } from '#src/components/EvalTree';
import { LoadingIcon } from '#src/components/LoadingState';
import { ResizeHandle } from '#src/components/ResizeHandle';
import { TagFilter } from '#src/components/TagFilter';
import { Tooltip } from '#src/components/Tooltip';
import { useResizableWidth } from '#src/hooks/useResizableWidth';
import { evalSummariesStore } from '#src/stores/evalsStore';
import {
  setSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from '#src/stores/layoutStore';
import { runStore } from '#src/stores/runStore';
import {
  clearEvalTagFilters,
  collapseAllFolders,
  EVAL_STATUS_FILTER_OPTIONS,
  expandAllFolders,
  selectionStore,
  selectFolder,
  setSearchQuery,
  toggleEvalStatusFilter,
  toggleEvalTagFilter,
} from '#src/stores/selectionStore';
import { colors } from '#src/style/colors';
import { inline, kicker, stack, transition } from '#src/style/helpers';
import { getActiveEvalStatus } from '#src/utils/activeEvalStatus';
import {
  buildEvalTree,
  collectCollapsiblePaths,
  filterEvalsBySearchQuery,
  filterEvalsByStatuses,
  filterEvalsByTags,
  getStatusBreakdown,
  getTagBreakdown,
} from '#src/utils/buildEvalTree';

const Root = styled.aside`
  ${stack()}
  flex-shrink: 0;
  border-right: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
  position: relative;
`;

const Masthead = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  padding: 14px 16px;
  border-bottom: 1px solid ${colors.border.var};
`;

const Mark = styled.div`
  width: 26px;
  height: 26px;
  background: linear-gradient(
    135deg,
    ${colors.accent.var},
    ${colors.accentDim.var}
  );
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: ${colors.accentInk.var};
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: -0.02em;
  box-shadow: 0 0 20px ${colors.accent.alpha(0.2)};
`;

const BrandText = styled.div`
  ${stack({ gap: 1 })}
  flex: 1;
  min-width: 0;
`;

const Wordmark = styled.div`
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: ${colors.text.var};
`;

const BrandSub = styled.div`
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  color: ${colors.textMuted.var};
  font-variant-numeric: tabular-nums;
`;

const SearchWrap = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  ${transition({ property: 'background, border-color' })}
  margin: 10px 12px 0;
  padding: 0 8px;
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  color: ${colors.textMuted.var};

  &:focus-within {
    border-color: ${colors.accent.var};
    background: ${colors.bg.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
`;

const SearchInput = styled.input`
  flex: 1;
  appearance: none;
  background: transparent;
  border: none;
  outline: none;
  padding: 6px 0;
  font-size: 12.5px;
  color: ${colors.text.var};
  min-width: 0;

  &::placeholder {
    color: ${colors.textDim.var};
  }
`;

const SearchClearButton = styled.button`
  ${inline({ align: 'center', justify: 'center' })}
  ${transition({ property: 'background, color' })}
  width: 18px;
  height: 18px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0;
  color: ${colors.textDim.var};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 12px;
    height: 12px;
  }
`;

const SectionHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 8 })}
  padding: 12px 16px 6px;
`;

const StatusFilters = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  flex-wrap: wrap;
  padding: 10px 12px 0;
`;

type StatusTone =
  | 'running'
  | 'pass'
  | 'fail'
  | 'stale'
  | 'outdated'
  | 'unscored'
  | 'cancelled'
  | 'pending';

const StatusFilterChip = styled.button<{
  active: boolean;
  running: boolean;
  pass: boolean;
  fail: boolean;
  stale: boolean;
  outdated: boolean;
  unscored: boolean;
  cancelled: boolean;
  pending: boolean;
}>`
  ${inline({ gap: 5, align: 'center' })}
  ${transition({ property: 'background, border-color, color' })}
  appearance: none;
  border: 1px solid ${colors.border.var};
  border-radius: 999px;
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  padding: 4px 8px;
  font-size: 10px;
  line-height: 1;
  font-weight: 500;
  text-transform: uppercase;
  cursor: pointer;

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.text.var};
    border-color: ${colors.text.var};
    color: ${colors.bg.var};
  }

  &.pass:not(.active) {
    color: ${colors.success.var};
    background: ${colors.success.alpha(0.08)};
    border-color: ${colors.success.alpha(0.18)};
  }
  &.fail:not(.active) {
    color: ${colors.error.var};
    background: ${colors.error.alpha(0.08)};
    border-color: ${colors.error.alpha(0.18)};
  }
  &.running:not(.active) {
    color: ${colors.accentDim.var};
    background: ${colors.accent.alpha(0.1)};
    border-color: ${colors.accent.alpha(0.22)};
  }
  &.cancelled:not(.active) {
    color: ${colors.warning.var};
    background: ${colors.warning.alpha(0.08)};
    border-color: ${colors.warning.alpha(0.18)};
  }
  &.stale:not(.active) {
    background: ${colors.surfaceActive.var};
  }
  &.outdated:not(.active) {
    color: ${colors.warning.var};
    background: ${colors.warning.alpha(0.1)};
    border-color: ${colors.warning.alpha(0.22)};
  }
  &.unscored:not(.active) {
    color: ${colors.unscored.var};
    background: ${colors.unscored.alpha(0.09)};
    border-color: ${colors.unscored.alpha(0.2)};
  }
  &.pending:not(.active) {
    color: ${colors.textMuted.var};
    background: ${colors.surface.var};
    border-color: ${colors.border.var};
  }
`;

const StatusFilterValue = styled.span`
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
`;

const SectionLabel = styled.button<{ active: boolean }>`
  ${kicker};
  ${transition({ property: 'color' })}
  appearance: none;
  background: transparent;
  border: none;
  padding: 0;
  color: ${colors.textMuted.var};
  cursor: pointer;

  &:hover,
  &.active {
    color: ${colors.text.var};
  }
`;

const SectionActions = styled.div`
  ${inline({ gap: 4, align: 'center' })}
`;

const SectionCounter = styled.span`
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  color: ${colors.textDim.var};
  font-variant-numeric: tabular-nums;
`;

const IconButton = styled.button`
  ${inline({ align: 'center', justify: 'center' })}
  ${transition({ property: 'background, color' })}
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0;
  color: ${colors.textDim.var};
  cursor: pointer;

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  & > svg {
    width: 14px;
    height: 14px;
  }
`;

const ScrollArea = styled.div`
  flex: 1;
  overflow: auto;
  padding-bottom: 10px;
`;

export function Sidebar() {
  const evalsResult = evalSummariesStore.useDocument();
  const evals = evalsResult.data ?? [];
  const evalsAreLoading = evalsResult.isLoading && evals.length === 0;
  const {
    collapsedFolders,
    selection,
    statusFilters,
    tagFilters,
    searchQuery,
  } = selectionStore.useSelectorRC((s) => ({
    collapsedFolders: s.collapsedFolders,
    selection: s.selection,
    statusFilters: s.statusFilters,
    tagFilters: s.tagFilters,
    searchQuery: s.searchQuery,
  }));
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));
  const { width, dragging, rootRef, handlePointerDown, handleDoubleClick } =
    useResizableWidth({
      storageKey: SIDEBAR_WIDTH_STORAGE_KEY,
      minWidth: SIDEBAR_MIN_WIDTH,
      maxWidth: SIDEBAR_MAX_WIDTH,
      defaultWidth: SIDEBAR_DEFAULT_WIDTH,
      edge: 'right',
    });

  useEffect(() => {
    setSidebarWidth(width);
  }, [width]);

  const getEvalActiveStatusForKey = (evalKey: string) =>
    getActiveEvalStatus(currentRun, evalKey);
  const statusFilteredEvals = filterEvalsByStatuses(
    evals,
    statusFilters,
    getEvalActiveStatusForKey,
  );
  const tagFilteredEvals = filterEvalsByTags(statusFilteredEvals, tagFilters);
  const filteredEvals = filterEvalsBySearchQuery(tagFilteredEvals, searchQuery);
  const hasActiveSearch = searchQuery.trim().length > 0;
  const statusBreakdown = getStatusBreakdown(evals, getEvalActiveStatusForKey);
  const statusFilterItems = EVAL_STATUS_FILTER_OPTIONS.map((status) => ({
    status,
    count: statusBreakdown[status],
    active: statusFilters.has(status),
    tone: getStatusTone(status),
  })).filter(({ count, active }) => !evalsAreLoading && (count > 0 || active));
  const tagBreakdown = useMemo(() => getTagBreakdown(evals), [evals]);
  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(buildEvalTree(filteredEvals)),
    [filteredEvals],
  );
  const allCollapsed =
    !hasActiveSearch &&
    collapsiblePaths.length > 0 &&
    collapsiblePaths.every((p) => collapsedFolders.has(p));
  const isRootFolderSelected =
    selection.kind === 'none' ||
    (selection.kind === 'folder' && selection.path.length === 0);

  return (
    <Root
      ref={rootRef}
      style={{ width: `${width}px` }}
    >
      <Masthead>
        <Mark>ae</Mark>
        <BrandText>
          <Wordmark>agent evals</Wordmark>
          <BrandSub>workspace · main</BrandSub>
        </BrandText>
      </Masthead>
      <SearchWrap>
        <Search aria-hidden="true" />
        <SearchInput
          type="search"
          value={searchQuery}
          placeholder="Search evals"
          aria-label="Search evals"
          onChange={(event) => {
            setSearchQuery(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && searchQuery.length > 0) {
              event.preventDefault();
              setSearchQuery('');
            }
          }}
        />
        {hasActiveSearch ? (
          <SearchClearButton
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setSearchQuery('');
            }}
          >
            <X />
          </SearchClearButton>
        ) : null}
      </SearchWrap>
      {statusFilterItems.length > 0 ? (
        <StatusFilters aria-label="Eval status filters">
          {statusFilterItems.map(({ status, count, active, tone }) => (
            <StatusFilterChip
              key={status}
              type="button"
              aria-pressed={active}
              active={active}
              pass={tone === 'pass'}
              fail={tone === 'fail'}
              running={tone === 'running'}
              cancelled={tone === 'cancelled'}
              stale={tone === 'stale'}
              outdated={tone === 'outdated'}
              unscored={tone === 'unscored'}
              pending={tone === 'pending'}
              onClick={() => {
                toggleEvalStatusFilter(status);
              }}
            >
              <StatusFilterValue>{count}</StatusFilterValue>
              {status}
            </StatusFilterChip>
          ))}
        </StatusFilters>
      ) : null}
      {!evalsAreLoading ? (
        <TagFilter
          availableTags={tagBreakdown}
          selectedTags={tagFilters}
          onToggleTag={toggleEvalTagFilter}
          onClearAll={clearEvalTagFilters}
        />
      ) : null}
      <SectionHeader>
        <SectionLabel
          type="button"
          active={isRootFolderSelected}
          onClick={() => {
            selectFolder('');
          }}
        >
          Evals
        </SectionLabel>
        <SectionActions>
          <Tooltip content={allCollapsed ? 'Expand all' : 'Collapse all'}>
            <IconButton
              type="button"
              onClick={() => {
                if (allCollapsed) expandAllFolders();
                else collapseAllFolders(collapsiblePaths);
              }}
              disabled={collapsiblePaths.length === 0}
              aria-label={
                allCollapsed ? 'Expand all folders' : 'Collapse all folders'
              }
            >
              {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </IconButton>
          </Tooltip>
          <SectionCounter>
            {evalsAreLoading ? (
              <LoadingIcon size="small" />
            ) : statusFilters.size > 0 ||
              tagFilters.size > 0 ||
              hasActiveSearch ? (
              `${filteredEvals.length}/${evals.length}`
            ) : (
              evals.length
            )}
          </SectionCounter>
        </SectionActions>
      </SectionHeader>
      <ScrollArea>
        <EvalTree />
      </ScrollArea>
      <ResizeHandle
        dragging={dragging}
        edge="right"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      />
    </Root>
  );
}

function getStatusTone(status: EvalDisplayStatus): StatusTone {
  if (status === 'running') return 'running';
  if (status === 'pass') return 'pass';
  if (status === 'fail' || status === 'error') return 'fail';
  if (status === 'stale') return 'stale';
  if (status === 'outdated') return 'outdated';
  if (status === 'unscored') return 'unscored';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}
