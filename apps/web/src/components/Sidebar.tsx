import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, stack, transition } from '#src/style/helpers';
import { evalsStore } from '../stores/evalsStore.ts';
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
import { Tooltip } from './Tooltip.tsx';

const MIN_WIDTH = 200;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 248;
const STORAGE_KEY = 'agent-evals.sidebar-width';

const Root = styled.aside`
  ${stack()}
  flex-shrink: 0;
  border-right: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
  position: relative;
`;

const ResizeHandle = styled.div<{ dragging: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  right: -3px;
  width: 7px;
  cursor: col-resize;
  z-index: 5;
  user-select: none;
  touch-action: none;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
    transition: background 0.15s ease;
  }

  &:hover::after,
  &.dragging::after {
    background: ${colors.accent.var};
  }
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

function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_WIDTH;
  const parsed = Number.parseFloat(raw);
  return clampWidth(parsed);
}

export function Sidebar() {
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const { collapsedFolders, selection } = selectionStore.useSelectorRC((s) => ({
    collapsedFolders: s.collapsedFolders,
    selection: s.selection,
  }));
  const [width, setWidth] = useState<number>(() => readStoredWidth());
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = root.getBoundingClientRect().width;
    setDragging(true);

    function onMove(e: PointerEvent) {
      const next = clampWidth(startWidth + (e.clientX - startX));
      setWidth(next);
    }

    function onUp() {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setWidth(DEFAULT_WIDTH);
  }, []);

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
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      />
    </Root>
  );
}
