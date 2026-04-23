import { getEvalTitle } from '@agent-evals/shared';
import { ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { css, styled } from 'vindur';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  monoFont,
  stack,
  transition,
} from '#src/style/helpers';
import { evalsStore } from '../stores/evalsStore.ts';
import { runStore } from '../stores/runStore.ts';
import {
  expandFolder,
  isFolderExpanded,
  selectionStore,
  selectEval,
  selectFolder,
  toggleFolder,
  type Selection,
} from '../stores/selectionStore.ts';
import {
  buildEvalTree,
  collectNodeEvals,
  deriveCombinedStatus,
  filterEvalsByStatuses,
  formatStatusBreakdown,
  getEvalSummaryDisplayStatus,
  getStatusBreakdown,
  type TreeFile,
  type TreeFolder,
  type TreeLeaf,
  type TreeNode,
} from '../utils/buildEvalTree.ts';
import { getFreshnessTooltip } from '../utils/freshness.ts';
import { StatusDot } from './StatusBadge.tsx';
import { Tooltip } from './Tooltip.tsx';

const Root = styled.div`
  padding: 2px 0 10px;
`;

const Empty = styled.div`
  padding: 20px;
  ${stack({ gap: 10, align: 'left' })}
`;

const EmptyTitle = styled.div`
  color: ${colors.textMuted.var};
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
`;

const EmptyBody = styled.div`
  color: ${colors.textMuted.var};
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
`;

const CommandHint = styled.code`
  ${monoFont};
  display: block;
  width: 100%;
  overflow: auto;
  color: ${colors.text.var};
  background: ${colors.surface.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  padding: 10px 12px;
`;

const rowShell = css`
  ${inline({ gap: 8, align: 'center' })}
  ${transition({ property: 'background, color' })}
  position: relative;
  width: calc(100% - 16px);
  margin: 1px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  text-align: left;
  color: ${colors.textMuted.var};
  font-size: 12.5px;
  line-height: 20px;
  min-height: 30px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 10px;
  overflow: hidden;

  &.depth0 {
    padding-left: 10px;
  }
  &.depth1 {
    padding-left: 24px;
  }
  &.depth2 {
    padding-left: 38px;
  }
  &.depth3 {
    padding-left: 52px;
  }

  &.active {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &.active::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: ${colors.accent.var};
    border-radius: 2px;
  }
`;

const RowBase = styled.button<{
  active: boolean;
  depth0: boolean;
  depth1: boolean;
  depth2: boolean;
  depth3: boolean;
}>`
  ${rowShell};
  cursor: pointer;

  &:not(.active):hover {
    background: ${colors.bg.var};
    color: ${colors.text.var};
  }
`;

const ChevronButton = styled.button<{ open: boolean }>`
  ${transition({ property: 'transform, background, color' })}
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0;
  color: ${colors.textDim.var};
  opacity: 0.8;
  flex-shrink: 0;
  cursor: pointer;

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
    opacity: 1;
  }

  & > svg {
    ${transition({ property: 'transform' })}
    width: 12px;
    height: 12px;
  }

  &.open > svg {
    transform: rotate(90deg);
  }
`;

const GroupLabel = styled.span`
  ${ellipsis};
  flex: 1;
  font-weight: 600;
  font-size: 12.5px;
  color: ${colors.text.var};
`;

const GroupLabelPrefix = styled.span`
  color: ${colors.textDim.var};
  font-weight: 400;
`;

const LeafLabel = styled.span`
  ${ellipsis};
  flex: 1;
  font-weight: 500;
  font-size: 12.5px;
`;

const LeafFileName = styled.span`
  color: ${colors.textDim.var};
  font-weight: 400;
`;

const LeafSeparator = styled.span`
  color: ${colors.textDim.var};
  font-weight: 400;
  margin: 0 4px;
`;

const StatusDotWrap = styled.span`
  ${inline({ gap: 6, align: 'center' })}
  flex-shrink: 0;
`;

const RowCounter = styled.span`
  ${monoFont};
  font-size: 10px;
  color: ${colors.textDim.var};
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;

export function EvalTree() {
  const { evals, hasLoaded, error } = evalsStore.useSelectorRC((s) => ({
    evals: s.evals,
    hasLoaded: s.hasLoaded,
    error: s.error,
  }));
  const { selection, collapsedFolders, statusFilters } =
    selectionStore.useSelectorRC((s) => ({
      selection: s.selection,
      collapsedFolders: s.collapsedFolders,
      statusFilters: s.statusFilters,
    }));
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));

  const isEvalRunning = (evalId: string): boolean =>
    currentRun?.manifest.status === 'running' &&
    targetIncludesEval(currentRun.manifest.target, evalId);

  useEffect(() => {
    if (selection.kind !== 'eval') return;
    const ev = evals.find((e) => e.id === selection.id);
    if (!ev) return;
    expandFolder(ev.filePath);
    const segments = ev.filePath.split('/').filter((p) => p.length > 0);
    let current = '';
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      if (!segment) continue;
      current = current ? `${current}/${segment}` : segment;
      expandFolder(current);
    }
  }, [selection, evals]);

  if (!hasLoaded) {
    return (
      <Empty>
        <EmptyTitle>Loading evals</EmptyTitle>
        <EmptyBody>Waiting for the sidebar tree to load.</EmptyBody>
      </Empty>
    );
  }

  if (error && evals.length === 0) {
    return (
      <Empty>
        <EmptyTitle>Could not load evals</EmptyTitle>
        <EmptyBody>{error}</EmptyBody>
        <CommandHint>agent-evals app</CommandHint>
      </Empty>
    );
  }

  if (evals.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No evals discovered</EmptyTitle>
        <EmptyBody>
          The web app is up, but the backend did not discover any `*.eval.ts`
          files.
          {'\n'}
          {'\n'}
          Start the app from the workspace that contains your evals so the tree
          can populate.
        </EmptyBody>
        <CommandHint>agent-evals app</CommandHint>
      </Empty>
    );
  }

  const visibleEvals = filterEvalsByStatuses(
    evals,
    statusFilters,
    isEvalRunning,
  );

  if (visibleEvals.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No evals match</EmptyTitle>
        <EmptyBody>The active status filters hide every eval.</EmptyBody>
      </Empty>
    );
  }

  const tree = buildEvalTree(visibleEvals);

  return (
    <Root>
      {tree.map((node) => (
        <NodeView
          key={node.path}
          node={node}
          depth={0}
          selection={selection}
          collapsedFolders={collapsedFolders}
          showFilenamePrefix
          isEvalRunning={isEvalRunning}
        />
      ))}
    </Root>
  );
}

type NodeViewProps = {
  node: TreeNode;
  depth: number;
  selection: Selection;
  collapsedFolders: Set<string>;
  showFilenamePrefix: boolean;
  isEvalRunning: (evalId: string) => boolean;
};

function NodeView({
  node,
  depth,
  selection,
  collapsedFolders,
  showFilenamePrefix,
  isEvalRunning,
}: NodeViewProps) {
  if (node.kind === 'folder') {
    return (
      <FolderRow
        folder={node}
        depth={depth}
        selection={selection}
        collapsedFolders={collapsedFolders}
        isEvalRunning={isEvalRunning}
      />
    );
  }
  if (node.kind === 'file') {
    return (
      <FileRow
        file={node}
        depth={depth}
        selection={selection}
        collapsedFolders={collapsedFolders}
        isEvalRunning={isEvalRunning}
      />
    );
  }
  return (
    <LeafRow
      leaf={node}
      depth={depth}
      selection={selection}
      showFilenamePrefix={showFilenamePrefix}
      isEvalRunning={isEvalRunning}
    />
  );
}

function FolderRow({
  folder,
  depth,
  selection,
  collapsedFolders,
  isEvalRunning,
}: {
  folder: TreeFolder;
  depth: number;
  selection: Selection;
  collapsedFolders: Set<string>;
  isEvalRunning: (evalId: string) => boolean;
}) {
  const isOpen = isFolderExpanded(collapsedFolders, folder.path);
  const isActive =
    selection.kind === 'folder' && selection.path === folder.path;
  const folderEvals = collectNodeEvals(folder);
  const combinedStatus = deriveCombinedStatus(folderEvals, isEvalRunning);
  const statusTooltip = formatStatusBreakdown(
    getStatusBreakdown(folderEvals, isEvalRunning),
  );

  function handleRowClick() {
    selectFolder(folder.path);
  }

  function handleChevronClick(event: React.MouseEvent) {
    event.stopPropagation();
    toggleFolder(folder.path);
  }

  return (
    <>
      <RowBase
        type="button"
        onClick={handleRowClick}
        active={isActive}
        depth0={depth === 0}
        depth1={depth === 1}
        depth2={depth === 2}
        depth3={depth >= 3}
      >
        <ChevronButton
          type="button"
          onClick={handleChevronClick}
          aria-label={isOpen ? 'Collapse folder' : 'Expand folder'}
          open={isOpen}
        >
          <ChevronRight />
        </ChevronButton>
        <GroupLabel>
          <GroupLabelPrefix>/</GroupLabelPrefix>
          {folder.name}
        </GroupLabel>
        <Tooltip content={statusTooltip}>
          <StatusDotWrap>
            <StatusDot status={combinedStatus} />
            <RowCounter>{folder.evalCount}</RowCounter>
          </StatusDotWrap>
        </Tooltip>
      </RowBase>
      {isOpen
        ? folder.children.map((child) => (
            <NodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selection={selection}
              collapsedFolders={collapsedFolders}
              showFilenamePrefix
              isEvalRunning={isEvalRunning}
            />
          ))
        : null}
    </>
  );
}

function FileRow({
  file,
  depth,
  selection,
  collapsedFolders,
  isEvalRunning,
}: {
  file: TreeFile;
  depth: number;
  selection: Selection;
  collapsedFolders: Set<string>;
  isEvalRunning: (evalId: string) => boolean;
}) {
  const isOpen = isFolderExpanded(collapsedFolders, file.path);
  const isActive = selection.kind === 'folder' && selection.path === file.path;
  const combinedStatus = deriveCombinedStatus(file.evals, isEvalRunning);
  const statusTooltip = formatStatusBreakdown(
    getStatusBreakdown(file.evals, isEvalRunning),
  );

  function handleRowClick() {
    selectFolder(file.path);
  }

  function handleChevronClick(event: React.MouseEvent) {
    event.stopPropagation();
    toggleFolder(file.path);
  }

  return (
    <>
      <RowBase
        type="button"
        onClick={handleRowClick}
        active={isActive}
        depth0={depth === 0}
        depth1={depth === 1}
        depth2={depth === 2}
        depth3={depth >= 3}
      >
        <ChevronButton
          type="button"
          onClick={handleChevronClick}
          aria-label={isOpen ? 'Collapse file' : 'Expand file'}
          open={isOpen}
        >
          <ChevronRight />
        </ChevronButton>
        <GroupLabel>{file.name}</GroupLabel>
        <Tooltip content={statusTooltip}>
          <StatusDotWrap>
            <StatusDot status={combinedStatus} />
            <RowCounter>{file.evals.length}</RowCounter>
          </StatusDotWrap>
        </Tooltip>
      </RowBase>
      {isOpen
        ? file.evals.map((ev) => (
            <LeafRow
              key={`${file.path}#${ev.id}`}
              leaf={{
                kind: 'leaf',
                path: `${ev.filePath}#${ev.id}`,
                filePath: ev.filePath,
                fileName: file.name,
                evalSummary: ev,
              }}
              depth={depth + 1}
              selection={selection}
              showFilenamePrefix={false}
              isEvalRunning={isEvalRunning}
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
  showFilenamePrefix,
  isEvalRunning,
}: {
  leaf: TreeLeaf;
  depth: number;
  selection: Selection;
  showFilenamePrefix: boolean;
  isEvalRunning: (evalId: string) => boolean;
}) {
  const ev = leaf.evalSummary;
  const isActive = selection.kind === 'eval' && selection.id === ev.id;

  const displayStatus = getEvalSummaryDisplayStatus(ev, isEvalRunning);
  const title = getEvalTitle(ev);
  const rowTooltip =
    ev.stale || ev.outdated ? getFreshnessTooltip(ev) : undefined;

  return (
    <RowBase
      type="button"
      onClick={() => selectEval(ev.id)}
      title={rowTooltip ?? undefined}
      active={isActive}
      depth0={depth === 0}
      depth1={depth === 1}
      depth2={depth === 2}
      depth3={depth >= 3}
    >
      <StatusDot status={displayStatus} />
      <LeafLabel>
        {showFilenamePrefix ? (
          <>
            <LeafFileName>{leaf.fileName}</LeafFileName>
            <LeafSeparator>/</LeafSeparator>
          </>
        ) : null}
        {title}
      </LeafLabel>
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
