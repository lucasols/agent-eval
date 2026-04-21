import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, stack, transition } from '#src/style/helpers';
import { useResizableWidth } from '../hooks/useResizableWidth.ts';
import { evalsStore } from '../stores/evalsStore.ts';
import {
  setSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from '../stores/layoutStore.ts';
import {
  collapseAllFolders,
  expandAllFolders,
  selectionStore,
  selectFolder,
} from '../stores/selectionStore.ts';
import {
  buildEvalTree,
  collectCollapsiblePaths,
} from '../utils/buildEvalTree.ts';
import { EvalTree } from './EvalTree.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import { Tooltip } from './Tooltip.tsx';

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

const SectionHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 8 })}
  padding: 12px 16px 6px;
`;

const SectionLabel = styled.button<{ active: boolean }>`
  ${kicker}
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
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const { collapsedFolders, selection } = selectionStore.useSelectorRC((s) => ({
    collapsedFolders: s.collapsedFolders,
    selection: s.selection,
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

  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(buildEvalTree(evals)),
    [evals],
  );
  const allCollapsed =
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
          <SectionCounter>{evals.length}</SectionCounter>
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
