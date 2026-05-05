import { filterObjectOrArrayKeys } from '@ls-stack/utils/filterObjectOrArrayKeys';
import JsonView, { type JsonViewProps } from '@uiw/react-json-view';
import { Hash, KeyRound, Maximize2, Search, X } from 'lucide-react';
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resultify } from 't-result';
import { styled } from 'vindur';
import { IconButton } from '#src/components/IconButton';
import { Tooltip } from '#src/components/Tooltip';
import { colors } from '#src/style/colors';
import {
  centerContent,
  inline,
  monoFont,
  transition,
} from '#src/style/helpers';

const ViewerWrapper = styled.div`
  position: relative;
  min-width: 0;
`;

const ViewerCard = styled.div<{
  compact?: boolean;
  isDetailHeight?: boolean;
  isRawHeight?: boolean;
  expanded?: boolean;
}>`
  ${monoFont};
  font-size: 12px;
  line-height: 1.6;
  color: ${colors.text.var};
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  padding: 12px 14px;
  overflow: auto;
  min-width: 0;
  --w-rjv-font-family: inherit;
  --w-rjv-color: ${colors.text.var};
  --w-rjv-background-color: transparent;
  --w-rjv-line-color: ${colors.border.var};
  --w-rjv-arrow-color: ${colors.textDim.var};
  --w-rjv-info-color: ${colors.textDim.var};
  --w-rjv-update-color: ${colors.accent.alpha(0.16)};
  --w-rjv-copied-color: ${colors.textDim.var};
  --w-rjv-copied-success-color: ${colors.success.var};
  --w-rjv-key-number: ${colors.accent.var};
  --w-rjv-key-string: ${colors.accentDim.var};
  --w-rjv-curlybraces-color: ${colors.textMuted.var};
  --w-rjv-colon-color: ${colors.textMuted.var};
  --w-rjv-brackets-color: ${colors.textMuted.var};
  --w-rjv-ellipsis-color: ${colors.warning.var};
  --w-rjv-quotes-color: ${colors.accentDim.var};
  --w-rjv-quotes-string-color: ${colors.warning.var};
  --w-rjv-type-string-color: ${colors.warning.var};
  --w-rjv-type-int-color: ${colors.accent.var};
  --w-rjv-type-float-color: ${colors.accent.var};
  --w-rjv-type-bigint-color: ${colors.accent.var};
  --w-rjv-type-boolean-color: ${colors.error.var};
  --w-rjv-type-date-color: ${colors.cost.var};
  --w-rjv-type-url-color: ${colors.accentDim.var};
  --w-rjv-type-null-color: ${colors.textDim.var};
  --w-rjv-type-nan-color: ${colors.cost.var};
  --w-rjv-type-undefined-color: ${colors.textDim.var};

  &.compact {
    font-size: 11px;
    padding: 10px 12px;
  }

  &.isDetailHeight {
    max-height: 200px;
  }

  &.isRawHeight {
    max-height: 320px;
  }

  &.expanded {
    max-height: none;
  }

  & .w-rjv {
    ${monoFont};
    color: ${colors.text.var};
    font-size: inherit !important;
    line-height: inherit !important;
    background: transparent;
  }

  & .w-rjv-object-size,
  & .w-rjv-object-extra {
    color: ${colors.textDim.var};
  }
`;

const ViewerActions = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bgElevated.alpha(0.94)};
  box-shadow: 0 4px 14px -10px ${colors.black.alpha(0.35)};

  & button {
    width: 22px;
    height: 22px;
  }

  & svg {
    width: 12px;
    height: 12px;
  }
`;

const ToggleButton = styled.button`
  ${inline({ align: 'center', gap: 4 })}
  ${transition({
    duration: 'fast',
    property: 'background, color, border-color',
  })}
  position: absolute;
  bottom: 6px;
  right: 6px;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 500;
  color: ${colors.textMuted.var};
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  padding: 3px 7px;
  cursor: pointer;

  &:hover {
    color: ${colors.text.var};
    background: ${colors.surfaceHover.var};
    border-color: ${colors.borderStrong.var};
  }
`;

const FullscreenOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 85;
  background: ${colors.black.alpha(0.5)};
  padding: 16px;
`;

const FullscreenDialog = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100%;
  height: 100%;
  background: ${colors.bg.var};
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  box-shadow: 0 30px 80px -30px ${colors.black.alpha(0.45)};
  overflow: hidden;
`;

const FullscreenHeader = styled.header`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px 12px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
`;

const FullscreenTitleRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  min-width: 0;
`;

const FullscreenTitle = styled.h2`
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: ${colors.text.var};
`;

const SearchBar = styled.div`
  ${inline({ align: 'center', gap: 8 })}
  grid-column: 1 / -1;
`;

const SearchInputWrap = styled.label`
  ${inline({ align: 'center', gap: 7 })}
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  color: ${colors.textDim.var};
  ${transition({ property: 'border-color, box-shadow' })}

  &:focus-within {
    border-color: ${colors.accent.var};
    box-shadow: 0 0 0 3px ${colors.accent.alpha(0.18)};
  }

  & svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
`;

const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: ${colors.text.var};
  font: inherit;
  font-size: 12px;
`;

const SearchModeButton = styled.button<{ active: boolean }>`
  ${centerContent};
  width: 32px;
  height: 32px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: var(--radius-md);
  background: ${colors.bg.var};
  color: ${colors.textMuted.var};
  cursor: pointer;
  ${transition({ property: 'background, border-color, color, box-shadow' })}

  &.active {
    background: ${colors.accent.alpha(0.14)};
    border-color: ${colors.accent.alpha(0.7)};
    color: ${colors.accentDim.var};
  }

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }

  & svg {
    width: 14px;
    height: 14px;
  }
`;

const SearchMessage = styled.div`
  grid-column: 1 / -1;
  margin-top: -2px;
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const FullscreenBody = styled.div`
  min-height: 0;
  padding: 12px;
  overflow: hidden;

  ${ViewerWrapper} {
    height: 100%;
  }

  ${ViewerCard} {
    height: 100%;
    max-height: none;
  }
`;

const FullscreenCloseButton = styled.button`
  ${centerContent};
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: ${colors.textMuted.var};
  cursor: pointer;
  ${transition({ property: 'background, color' })}

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }
`;

type JsonViewerProps = {
  value: unknown;
  compact?: boolean;
  maxHeight?: 'detail' | 'raw';
  collapsed?: JsonViewProps<object>['collapsed'];
  collapseStringsAfterLength?: number;
  enableClipboard?: boolean;
  fullscreen?: boolean;
};

const PrimitiveValue = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
`;

const EmptySearchResult = styled.div`
  padding: 14px;
  color: ${colors.textMuted.var};
  font-size: 13px;
`;

function formatPrimitiveValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[Function]';
  return '[Object]';
}

type SearchMode = 'text' | 'keys';

type SearchResult = {
  value: unknown;
  isEmpty: boolean;
  message: string | undefined;
};

type TextSearchMatch = { matched: true; value: unknown } | { matched: false };

type IndexedTextSearchMatch = {
  index: number;
  match: Extract<TextSearchMatch, { matched: true }>;
};

const keyFilterSyntaxTooltip = `Key filter syntax:
Separate patterns with commas or new lines.

Root key: prop
Any depth: **prop
Exact path: prop.nested
Second level: *.prop

Arrays:
prop[0]
prop[*].nested
prop[0-2]
prop[4-*]

Groups:
prop.(id|name|status)
(users|admins)[*].name

Array value filters:
users[%name="John"]
users[%name*="oh"]
users[i%name="john"]
users[%age=30 && %role="admin"]`;

const keyPatternSeparatorRegexp = /[\n,]/;
const originalIndexKey = '__original_index';
const noTextSearchMatch: TextSearchMatch = { matched: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKeyFilterable(
  value: unknown,
): value is Record<string, unknown> | Record<string, unknown>[] {
  return isRecord(value) || (Array.isArray(value) && value.every(isRecord));
}

function splitKeyFilterPatterns(query: string): string[] {
  return query
    .split(keyPatternSeparatorRegexp)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isIndexedTextSearchMatch(value: {
  index: number;
  match: TextSearchMatch;
}): value is IndexedTextSearchMatch {
  return value.match.matched;
}

function addOriginalIndex(value: unknown, index: number): unknown {
  if (isRecord(value)) return { [originalIndexKey]: index, ...value };
  return { [originalIndexKey]: index, value };
}

function maybeAddOriginalIndex(
  value: unknown,
  index: number,
  showOriginalIndexes: boolean,
): unknown {
  return showOriginalIndexes ? addOriginalIndex(value, index) : value;
}

function compactFilteredArrays(
  value: unknown,
  showOriginalIndexes: boolean,
): unknown {
  if (Array.isArray(value)) {
    const retainedItems: Array<{ index: number; value: unknown }> = [];

    for (const [index, child] of value.entries()) {
      const compactedChild = compactFilteredArrays(child, showOriginalIndexes);
      if (isEmptyRecord(compactedChild)) continue;
      retainedItems.push({ index, value: compactedChild });
    }

    const arrayWasFiltered = retainedItems.length !== value.length;
    return retainedItems.map((item) =>
      arrayWasFiltered
        ? maybeAddOriginalIndex(item.value, item.index, showOriginalIndexes)
        : item.value,
    );
  }

  if (isRecord(value)) {
    const compactedObject: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(value)) {
      const compactedChild = compactFilteredArrays(child, showOriginalIndexes);
      if (isEmptyRecord(compactedChild)) continue;
      compactedObject[key] = compactedChild;
    }

    return compactedObject;
  }

  return value;
}

function filterTextSearch(
  value: unknown,
  query: string,
  showOriginalIndexes: boolean,
): TextSearchMatch {
  const normalizedQuery = query.toLowerCase();

  function filterValue(current: unknown, path: string[]): TextSearchMatch {
    if (Array.isArray(current)) {
      const matches = current
        .map((child, index) => ({
          index,
          match: filterValue(child, [...path, `[${index}]`]),
        }))
        .filter(isIndexedTextSearchMatch);

      const arrayWasFiltered = matches.length !== current.length;
      const matchedValues = matches.map((child) =>
        arrayWasFiltered
          ? maybeAddOriginalIndex(
              child.match.value,
              child.index,
              showOriginalIndexes,
            )
          : child.match.value,
      );

      return matches.length > 0
        ? { matched: true, value: matchedValues }
        : noTextSearchMatch;
    }

    if (isRecord(current)) {
      const filteredObject: Record<string, unknown> = {};

      for (const [key, child] of Object.entries(current)) {
        const childPath = [...path, key];
        const keyMatches =
          key.toLowerCase().includes(normalizedQuery) ||
          childPath.join('.').toLowerCase().includes(normalizedQuery);

        if (keyMatches) {
          filteredObject[key] = child;
          continue;
        }

        const filteredChild = filterValue(child, childPath);
        if (filteredChild.matched) filteredObject[key] = filteredChild.value;
      }

      return Object.keys(filteredObject).length > 0
        ? { matched: true, value: filteredObject }
        : noTextSearchMatch;
    }

    return formatPrimitiveValue(current).toLowerCase().includes(normalizedQuery)
      ? { matched: true, value: current }
      : noTextSearchMatch;
  }

  return filterValue(value, []);
}

function resolveSearchResult(
  value: unknown,
  query: string,
  mode: SearchMode,
  showOriginalIndexes: boolean,
): SearchResult {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { value, isEmpty: false, message: undefined };
  }

  if (mode === 'text') {
    const filtered = filterTextSearch(value, trimmedQuery, showOriginalIndexes);
    return !filtered.matched
      ? { value: undefined, isEmpty: true, message: undefined }
      : { value: filtered.value, isEmpty: false, message: undefined };
  }

  if (!isKeyFilterable(value)) {
    return {
      value: undefined,
      isEmpty: true,
      message: 'Key filters support objects and arrays of objects.',
    };
  }

  const patterns = splitKeyFilterPatterns(trimmedQuery);
  const filterResult = resultify((): unknown =>
    filterObjectOrArrayKeys(value, {
      filterKeys: patterns,
      rejectEmptyObjectsInArray: false,
      sortKeys: false,
    }),
  );

  if (filterResult.error) {
    return {
      value: undefined,
      isEmpty: true,
      message: filterResult.error.message,
    };
  }

  const filteredValue = compactFilteredArrays(
    filterResult.value,
    showOriginalIndexes,
  );
  const isEmpty =
    (Array.isArray(filteredValue) && filteredValue.length === 0) ||
    (isRecord(filteredValue) && Object.keys(filteredValue).length === 0);

  return { value: filteredValue, isEmpty, message: undefined };
}

function JsonContent({
  value,
  collapsed,
  collapseStringsAfterLength,
  enableClipboard,
}: {
  value: unknown;
  collapsed: JsonViewProps<object>['collapsed'];
  collapseStringsAfterLength: number;
  enableClipboard: boolean;
}) {
  if (typeof value === 'object' && value !== null) {
    return (
      <JsonView
        value={value}
        collapsed={collapsed}
        displayDataTypes={false}
        shortenTextAfterLength={collapseStringsAfterLength}
        enableClipboard={enableClipboard}
      />
    );
  }

  return <PrimitiveValue>{formatPrimitiveValue(value)}</PrimitiveValue>;
}

function JsonFullscreenModal({
  value,
  collapsed,
  collapseStringsAfterLength,
  enableClipboard,
  onClose,
}: {
  value: unknown;
  collapsed: JsonViewProps<object>['collapsed'];
  collapseStringsAfterLength: number;
  enableClipboard: boolean;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [searchMode, setSearchMode] = useState<SearchMode>('text');
  const [showOriginalIndexes, setShowOriginalIndexes] = useState(false);
  const searchResult = useMemo(
    () =>
      resolveSearchResult(
        value,
        deferredSearchQuery,
        searchMode,
        showOriginalIndexes,
      ),
    [deferredSearchQuery, searchMode, showOriginalIndexes, value],
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <FullscreenOverlay
      role="dialog"
      aria-modal="true"
      aria-label="JSON viewer"
      onClick={onClose}
    >
      <FullscreenDialog onClick={(event) => event.stopPropagation()}>
        <FullscreenHeader>
          <FullscreenTitleRow>
            <FullscreenTitle>JSON</FullscreenTitle>
          </FullscreenTitleRow>
          <FullscreenCloseButton
            type="button"
            aria-label="Close fullscreen JSON viewer"
            onClick={onClose}
          >
            <X size={16} />
          </FullscreenCloseButton>
          <SearchBar>
            <SearchInputWrap>
              <Search />
              <SearchInput
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={
                  searchMode === 'keys'
                    ? 'Filter keys with patterns'
                    : 'Search keys and values'
                }
                aria-label={
                  searchMode === 'keys'
                    ? 'Filter JSON keys'
                    : 'Search JSON keys and values'
                }
              />
            </SearchInputWrap>
            <Tooltip
              content={keyFilterSyntaxTooltip}
              placement="bottom-end"
            >
              <SearchModeButton
                type="button"
                active={searchMode === 'keys'}
                aria-label="Filter keys only"
                aria-pressed={searchMode === 'keys'}
                onClick={() =>
                  setSearchMode((current) =>
                    current === 'keys' ? 'text' : 'keys',
                  )
                }
              >
                <KeyRound />
              </SearchModeButton>
            </Tooltip>
            <Tooltip
              content="Show original array indexes in filtered results"
              placement="bottom-end"
            >
              <SearchModeButton
                type="button"
                active={showOriginalIndexes}
                aria-label="Show original array indexes"
                aria-pressed={showOriginalIndexes}
                onClick={() => setShowOriginalIndexes((current) => !current)}
              >
                <Hash />
              </SearchModeButton>
            </Tooltip>
          </SearchBar>
          {searchResult.message ? (
            <SearchMessage>{searchResult.message}</SearchMessage>
          ) : null}
        </FullscreenHeader>
        <FullscreenBody>
          {searchResult.isEmpty ? (
            <EmptySearchResult>No matches</EmptySearchResult>
          ) : (
            <JsonViewer
              value={searchResult.value}
              collapsed={collapsed}
              collapseStringsAfterLength={collapseStringsAfterLength}
              enableClipboard={enableClipboard}
              fullscreen={false}
            />
          )}
        </FullscreenBody>
      </FullscreenDialog>
    </FullscreenOverlay>
  );
}

/**
 * Renders a JSON value with syntax highlighting. When `maxHeight` is set and
 * the content overflows, a toggle button lets the user expand the viewer to
 * its natural height and collapse it back.
 */
export function JsonViewer({
  value,
  compact = false,
  maxHeight,
  collapsed = false,
  collapseStringsAfterLength = 120,
  enableClipboard = true,
  fullscreen = true,
}: JsonViewerProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    if (!maxHeight || expanded) return;
    const element = cardRef.current;
    if (!element) return;

    const measure = () => {
      setOverflowing(element.scrollHeight - element.clientHeight > 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [maxHeight, expanded, value]);

  useEffect(() => {
    if (!maxHeight) setExpanded(false);
  }, [maxHeight]);

  const showToggle = maxHeight !== undefined && (overflowing || expanded);

  return (
    <ViewerWrapper>
      {fullscreen ? (
        <ViewerActions>
          <Tooltip content="View fullscreen">
            <IconButton
              aria-label="View JSON fullscreen"
              onClick={() => setFullscreenOpen(true)}
            >
              <Maximize2 />
            </IconButton>
          </Tooltip>
        </ViewerActions>
      ) : null}
      <ViewerCard
        ref={cardRef}
        compact={compact}
        isDetailHeight={maxHeight === 'detail'}
        isRawHeight={maxHeight === 'raw'}
        expanded={expanded}
      >
        <JsonContent
          value={value}
          collapsed={collapsed}
          collapseStringsAfterLength={collapseStringsAfterLength}
          enableClipboard={enableClipboard}
        />
      </ViewerCard>
      {showToggle ? (
        <ToggleButton
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </ToggleButton>
      ) : null}
      {fullscreenOpen ? (
        <JsonFullscreenModal
          value={value}
          collapsed={collapsed}
          collapseStringsAfterLength={collapseStringsAfterLength}
          enableClipboard={enableClipboard}
          onClose={() => setFullscreenOpen(false)}
        />
      ) : null}
    </ViewerWrapper>
  );
}
