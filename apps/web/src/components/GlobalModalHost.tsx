import {
  Braces,
  ChevronsDownUp,
  ChevronsUpDown,
  Hash,
  KeyRound,
  Layers,
  Search,
  X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import {
  keyFilterSyntaxTooltip,
  resolveSearchResult,
  type SearchMode,
} from '#src/components/JsonViewer.search';
import { TextViewModal } from '#src/components/TextViewModal';
import { Tooltip } from '#src/components/Tooltip';
import {
  closeGlobalModal,
  modalStore,
  type JsonFullscreenGlobalModal,
  type JsonViewerCollapsed,
} from '#src/stores/modalStore';
import { colors } from '#src/style/colors';
import { centerContent, inline, transition } from '#src/style/helpers';

const FullscreenOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
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

  & > div {
    height: 100%;
  }

  & > div > div {
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

const EmptySearchResult = styled.div`
  padding: 14px;
  color: ${colors.textMuted.var};
  font-size: 13px;
`;

export function GlobalModalHost() {
  const { modals } = modalStore.useSelectorRC((state) => ({
    modals: state.modals,
  }));

  return (
    <>
      {modals.map((modal) => {
        if (modal.kind === 'textView') {
          return (
            <TextViewModal
              key={modal.id}
              isOpen
              title={modal.title}
              subtitle={modal.subtitle}
              text={modal.text}
              initialMode={modal.initialMode}
              onClose={() => closeGlobalModal(modal.id)}
            />
          );
        }

        return (
          <JsonFullscreenModal
            key={modal.id}
            modal={modal}
          />
        );
      })}
    </>
  );
}

function JsonFullscreenModal({ modal }: { modal: JsonFullscreenGlobalModal }) {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [searchMode, setSearchMode] = useState<SearchMode>('text');
  const [showOriginalIndexes, setShowOriginalIndexes] = useState(false);
  const [showDataTypes, setShowDataTypes] = useState(false);
  const [viewerCollapsed, setViewerCollapsed] = useState<JsonViewerCollapsed>(
    modal.collapsed,
  );
  const [lastExpandLevel, setLastExpandLevel] = useState(2);
  const [viewerRevision, setViewerRevision] = useState(0);
  const searchResult = useMemo(
    () =>
      resolveSearchResult(
        modal.value,
        deferredSearchQuery,
        searchMode,
        showOriginalIndexes,
      ),
    [deferredSearchQuery, modal.value, searchMode, showOriginalIndexes],
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeGlobalModal(modal.id);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [modal.id]);

  function updateViewerCollapsed(nextCollapsed: JsonViewerCollapsed) {
    setViewerCollapsed(nextCollapsed);
    setViewerRevision((current) => current + 1);
  }

  function handleExpandToLevel() {
    const rawLevel = globalThis.prompt(
      'Expand JSON up to which level?',
      String(lastExpandLevel),
    );
    if (rawLevel === null) return;

    const parsed = Number.parseInt(rawLevel, 10);
    if (Number.isNaN(parsed)) return;

    const nextLevel = Math.max(0, Math.min(parsed, 20));
    setLastExpandLevel(nextLevel);
    updateViewerCollapsed(nextLevel);
  }

  const viewerIsCollapsedAll = viewerCollapsed === true;

  return (
    <FullscreenOverlay
      role="dialog"
      aria-modal="true"
      aria-label="JSON viewer"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeGlobalModal(modal.id);
      }}
    >
      <FullscreenDialog onClick={(event) => event.stopPropagation()}>
        <FullscreenHeader>
          <FullscreenTitleRow>
            <FullscreenTitle>JSON</FullscreenTitle>
          </FullscreenTitleRow>
          <FullscreenCloseButton
            type="button"
            aria-label="Close fullscreen JSON viewer"
            onClick={() => closeGlobalModal(modal.id)}
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
              content={
                viewerIsCollapsedAll
                  ? 'Expand all JSON nodes'
                  : 'Collapse all JSON nodes'
              }
              placement="bottom-end"
            >
              <SearchModeButton
                type="button"
                active={viewerIsCollapsedAll}
                aria-label={
                  viewerIsCollapsedAll
                    ? 'Expand all JSON nodes'
                    : 'Collapse all JSON nodes'
                }
                aria-pressed={viewerIsCollapsedAll}
                onClick={() =>
                  updateViewerCollapsed(viewerIsCollapsedAll ? false : true)
                }
              >
                {viewerIsCollapsedAll ? <ChevronsUpDown /> : <ChevronsDownUp />}
              </SearchModeButton>
            </Tooltip>
            <Tooltip
              content="Expand JSON up to a level"
              placement="bottom-end"
            >
              <SearchModeButton
                type="button"
                active={typeof viewerCollapsed === 'number'}
                aria-label="Expand JSON up to a level"
                aria-pressed={typeof viewerCollapsed === 'number'}
                onClick={handleExpandToLevel}
              >
                <Layers />
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
            <Tooltip
              content="Show JSON value data types"
              placement="bottom-end"
            >
              <SearchModeButton
                type="button"
                active={showDataTypes}
                aria-label="Show JSON value data types"
                aria-pressed={showDataTypes}
                onClick={() => setShowDataTypes((current) => !current)}
              >
                <Braces />
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
              key={viewerRevision}
              value={searchResult.value}
              collapsed={viewerCollapsed}
              collapseStringsAfterLength={modal.collapseStringsAfterLength}
              enableClipboard={modal.enableClipboard}
              fullscreen={false}
              displayDataTypes={showDataTypes}
            />
          )}
        </FullscreenBody>
      </FullscreenDialog>
    </FullscreenOverlay>
  );
}
