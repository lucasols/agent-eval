import { styled } from 'vindur';
import { ChevronRight, FileCode, Folder, FolderOpen } from 'lucide-react';
import { colors } from '#src/style/colors';
import { ellipsis, inline, monoFont, transition } from '#src/style/helpers';
import {
  selectionStore,
  selectEval,
  selectFolder,
  toggleFolder,
  type Selection,
} from '../stores/selectionStore.ts';
import {
  buildEvalTree,
  type TreeFolder,
  type TreeLeaf,
  type TreeNode,
} from '../utils/buildEvalTree.ts';
import { evalsStore } from '../stores/evalsStore.ts';
import { runStore } from '../stores/runStore.ts';
import { StatusDot } from './StatusBadge.tsx';

const Root = styled.div`
  padding: 6px 0 16px;
`;

const Empty = styled.div`
  padding: 20px;
  color: ${colors.textDim.var};
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  text-align: center;
`;

const RowBase = styled.button<{
  active: boolean;
  depth0: boolean;
  depth1: boolean;
  depth2: boolean;
  depth3: boolean;
}>`
  ${inline({ gap: 8, align: 'center' })}
  ${transition({ property: 'background, color, border-color' })}
  position: relative;
  width: 100%;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  color: ${colors.textMuted.var};
  font-size: 12px;
  min-height: 28px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 14px;
  overflow: hidden;

  &.depth0 {
    padding-left: 14px;
  }
  &.depth1 {
    padding-left: 28px;
  }
  &.depth2 {
    padding-left: 42px;
  }
  &.depth3 {
    padding-left: 56px;
  }

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &.active {
    background: ${colors.accent.alpha(0.18)};
    color: ${colors.text.var};
    border-left-color: ${colors.accent.var};
  }

  &.active::before {
    content: '';
    position: absolute;
    left: -2px;
    top: 50%;
    transform: translateY(-50%);
    width: 2px;
    height: 14px;
    background: ${colors.accentDim.var};
  }

  & > svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    color: ${colors.textDim.var};
  }

  &.active > svg {
    color: ${colors.accentDim.var};
  }
`;

const ChevronIcon = styled.span<{ open: boolean }>`
  ${transition({ property: 'transform' })}
  display: inline-flex;
  width: 10px;
  height: 10px;
  align-items: center;
  justify-content: center;
  color: ${colors.textDim.var};

  &.open {
    transform: rotate(90deg);
  }

  & > svg {
    width: 10px;
    height: 10px;
  }
`;

const RowLabel = styled.span`
  ${ellipsis}
  flex: 1;
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.01em;
`;

const FolderLabel = styled.span`
  ${ellipsis}
  flex: 1;
  font-weight: 700;
  font-size: 10.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
`;

const FilenameHint = styled.span`
  ${monoFont}
  ${ellipsis}
  font-size: 10px;
  color: ${colors.textDim.var};
  font-weight: 400;
  flex: 0 1 auto;
  max-width: 38%;
  opacity: 0.65;
  white-space: nowrap;
`;

const StaleTag = styled.span`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${colors.warning.var};
  padding: 1px 5px;
  border: 1px solid ${colors.warning.alpha(0.4)};
  background: ${colors.warning.alpha(0.08)};
  flex-shrink: 0;
`;

function getFilename(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

export function EvalTree() {
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const { selection, expandedFolders } = selectionStore.useSelectorRC((s) => ({
    selection: s.selection,
    expandedFolders: s.expandedFolders,
  }));

  if (evals.length === 0) {
    return <Empty>No evals discovered</Empty>;
  }

  const tree = buildEvalTree(evals);

  return (
    <Root>
      {tree.map((node) => (
        <NodeView
          key={node.path}
          node={node}
          depth={0}
          selection={selection}
          expandedFolders={expandedFolders}
        />
      ))}
    </Root>
  );
}

type NodeViewProps = {
  node: TreeNode;
  depth: number;
  selection: Selection;
  expandedFolders: Set<string>;
};

function NodeView({ node, depth, selection, expandedFolders }: NodeViewProps) {
  if (node.kind === 'folder') {
    return (
      <FolderRow
        folder={node}
        depth={depth}
        selection={selection}
        expandedFolders={expandedFolders}
      />
    );
  }
  return <LeafRow leaf={node} depth={depth} selection={selection} />;
}

function FolderRow({
  folder,
  depth,
  selection,
  expandedFolders,
}: {
  folder: TreeFolder;
  depth: number;
  selection: Selection;
  expandedFolders: Set<string>;
}) {
  const isOpen = expandedFolders.has(folder.path);
  const isActive = selection.kind === 'folder' && selection.path === folder.path;

  function handleClick() {
    toggleFolder(folder.path);
    selectFolder(folder.path);
  }

  return (
    <>
      <RowBase
        type="button"
        onClick={handleClick}
        active={isActive}
        depth0={depth === 0}
        depth1={depth === 1}
        depth2={depth === 2}
        depth3={depth >= 3}
      >
        <ChevronIcon open={isOpen}>
          <ChevronRight />
        </ChevronIcon>
        {isOpen ? <FolderOpen /> : <Folder />}
        <FolderLabel>{folder.name}</FolderLabel>
      </RowBase>
      {isOpen
        ? folder.children.map((child) => (
            <NodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selection={selection}
              expandedFolders={expandedFolders}
            />
          ))
        : null}
    </>
  );
}

function LeafRow({
  leaf,
  depth,
  selection,
}: {
  leaf: TreeLeaf;
  depth: number;
  selection: Selection;
}) {
  const ev = leaf.evalSummary;
  const isActive = selection.kind === 'eval' && selection.id === ev.id;
  const filename = getFilename(ev.filePath);

  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));
  const isRunning =
    currentRun?.manifest.status === 'running' &&
    targetIncludesEval(currentRun.manifest.target, ev.id);
  const displayStatus = isRunning ? 'running' : ev.lastRunStatus;

  return (
    <RowBase
      type="button"
      onClick={() => selectEval(ev.id)}
      active={isActive}
      depth0={depth === 0}
      depth1={depth === 1}
      depth2={depth === 2}
      depth3={depth >= 3}
    >
      <FileCode />
      <RowLabel>{ev.title ?? ev.id}</RowLabel>
      {ev.stale ? <StaleTag>stale</StaleTag> : null}
      {displayStatus ? <StatusDot status={displayStatus} /> : null}
      <FilenameHint title={ev.filePath}>{filename}</FilenameHint>
    </RowBase>
  );
}

function targetIncludesEval(
  target: { mode: string; evalIds?: string[] },
  evalId: string,
): boolean {
  if (target.mode === 'all') return true;
  if (target.mode === 'evalIds') {
    return target.evalIds?.includes(evalId) ?? false;
  }
  return false;
}
