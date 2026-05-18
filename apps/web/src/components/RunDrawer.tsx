import {
  deriveScopedSummaryFromCases,
  deriveStatusFromCaseRows,
  type CaseRow,
} from '@agent-evals/shared';
import { useActionFn } from '@ls-stack/react-utils/useActionFn';
import { Copy, SquareStop, X } from 'lucide-react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import {
  ErrorDetails,
  type ErrorDetailItem,
} from '#src/components/ErrorDetails';
import { IconButton } from '#src/components/IconButton';
import { LoadingLine } from '#src/components/LoadingState';
import { MenuButton } from '#src/components/MenuButton';
import { ResizeHandle } from '#src/components/ResizeHandle';
import type { SplitButtonMenuEntry } from '#src/components/SplitButton';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
import { useResizableWidth } from '#src/hooks/useResizableWidth';
import { useWindowWidth } from '#src/hooks/useWindowWidth';
import { deleteCacheEntriesForRunAndPrevious } from '#src/stores/cacheStore';
import { evalSummariesStore } from '#src/stores/evalsStore';
import { layoutStore } from '#src/stores/layoutStore';
import {
  closeRun,
  cancelRun,
  deleteRun,
  promoteRun,
  runDetailStore,
  runStore,
  selectCase,
} from '#src/stores/runStore';
import { selectionStore } from '#src/stores/selectionStore';
import {
  DEFAULT_WORKSPACE_CONFIG,
  workspaceConfigStore,
} from '#src/stores/workspaceConfigStore';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  kicker,
  monoFont,
  stack,
  tabularNums,
  transition,
} from '#src/style/helpers';
import { copyTextToClipboard } from '#src/utils/clipboard';
import { getEvalIdsForFolderPath, scopeRunCases } from '#src/utils/evalRuns';
import { formatDuration, formatTimestamp } from '#src/utils/formatters';
import {
  formatRunFolderDisplayPath,
  formatRunFolderPath,
} from '#src/utils/runPaths';

function getActiveScopedRunStatus(caseRows: CaseRow[]): 'running' | 'enqueued' {
  if (caseRows.some((caseRow) => caseRow.status === 'running')) {
    return 'running';
  }
  if (
    caseRows.length === 0 ||
    caseRows.some((caseRow) => caseRow.status === 'pending')
  ) {
    return 'enqueued';
  }
  return 'running';
}

function getCaseDisplayStatus(status: CaseRow['status']): string {
  if (status === 'pending') return 'enqueued';
  return status;
}

const DrawerLoading = styled.div`
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.textMuted.var};
  font-size: 12px;
  flex-shrink: 0;
`;

const DrawerError = styled(DrawerLoading)`
  color: ${colors.error.var};
  padding: 20px;
  text-align: center;
`;

const DrawerRoot = styled.div`
  ${stack()}
  position: relative;
  flex-shrink: 0;
  border-left: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  overflow: hidden;
`;

const Header = styled.div`
  ${stack({ gap: 10 })}
  padding: 14px 18px 12px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  flex-shrink: 0;
`;

const HeaderTop = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const HeaderActions = styled.div`
  ${inline({ align: 'center', gap: 6 })}
`;

const HeaderKicker = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const HeaderLeft = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  min-width: 0;
`;

const RunTag = styled.span`
  ${monoFont};
  font-size: 9.5px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
  color: ${colors.accentInk.var};
  background: ${colors.accent.var};
`;

const TemporaryTag = styled.span`
  ${kicker};
  font-size: 9.5px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
  color: ${colors.warning.var};
  background: ${colors.warning.alpha(0.1)};
`;

const RunTime = styled.span`
  font-size: 15px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;
  ${tabularNums};
`;

const Body = styled.div`
  flex: 1;
  overflow: auto;
  padding: 16px;
  ${stack({ gap: 18 })}
`;

const Section = styled.section`
  ${stack({ gap: 8 })}
`;

const SectionLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
`;

const Stat = styled.div`
  ${stack({ gap: 6 })}
  padding: 12px 14px;
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
`;

const StatLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const StatValue = styled.span<{ accent: boolean; error: boolean }>`
  ${tabularNums};
  font-size: 18px;
  font-weight: 500;
  color: ${colors.text.var};
  letter-spacing: -0.02em;

  &.accent {
    color: ${colors.accentDim.var};
  }
  &.error {
    color: ${colors.error.var};
  }
`;

const MetaList = styled.dl`
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 12px;
  margin: 0;
`;

const MetaKey = styled.dt`
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const MetaValue = styled.dd`
  margin: 0;
  ${monoFont};
  ${tabularNums};
  font-size: 11.5px;
  color: ${colors.text.var};
  word-break: break-all;
`;

const CopyableMetaValue = styled.dd`
  ${inline({ align: 'center', gap: 6 })}
  margin: 0;
  min-width: 0;
`;

const MetaPath = styled.span`
  ${monoFont};
  ${tabularNums};
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: ${colors.text.var};
  word-break: break-all;
`;

const CaseList = styled.div`
  ${stack({ gap: 0 })}
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: hidden;
  background: ${colors.bg.var};
`;

const CaseItem = styled.button`
  ${transition({ property: 'background' })}
  ${inline({ gap: 10, align: 'center' })}
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-top: 1px solid ${colors.border.var};
  cursor: pointer;
  text-align: left;

  &:first-child {
    border-top: none;
  }

  &:hover {
    background: ${colors.surface.var};
  }
`;

const CaseMain = styled.div`
  ${stack({ gap: 2 })}
  flex: 1;
  min-width: 0;
`;

const CaseId = styled.div`
  ${ellipsis};
  ${monoFont};
  font-size: 12px;
  color: ${colors.text.var};
`;

const CaseSubline = styled.div`
  ${ellipsis};
  ${monoFont};
  font-size: 10.5px;
  color: ${colors.textMuted.var};
`;

const CaseMetrics = styled.div`
  ${inline({ gap: 10, align: 'center' })}
  flex-shrink: 0;
`;

const CaseMetric = styled.span`
  ${monoFont};
  ${tabularNums};
  font-size: 11px;
  color: ${colors.textMuted.var};
  min-width: 44px;
  text-align: right;
`;

const EmptyCases = styled.div`
  padding: 18px 14px;
  text-align: center;
  font-size: 11.5px;
  color: ${colors.textMuted.var};
  border: 1px dashed ${colors.border.var};
  border-radius: var(--radius-md);
`;

function formatCaseDuration(caseRow: CaseRow): string {
  if (caseRow.durationMs === null || caseRow.durationMs <= 0) return '—';
  return formatDuration(caseRow.durationMs);
}

function formatTarget(target: {
  mode: 'all' | 'evalIds' | 'caseIds';
  evalIds?: string[];
  evalKeys?: string[];
  files?: string[];
  caseIds?: string[];
}): string {
  if (target.mode === 'all') return 'all evals';
  if (target.mode === 'evalIds') {
    const ids = target.files ?? target.evalIds ?? target.evalKeys ?? [];
    return ids.length > 0 ? ids.join(', ') : 'evalIds';
  }
  const ids = target.caseIds ?? [];
  return ids.length > 0 ? ids.join(', ') : 'caseIds';
}

type ParsedRunErrorLine = { evalId: string; message: string };

type ParsedRunErrorBlock = ParsedRunErrorLine & { stack: string | undefined };

function parseRunErrorLine(line: string): ParsedRunErrorLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[')) return null;
  const closeIndex = trimmed.indexOf('] ');
  if (closeIndex <= 1) return null;
  const evalId = trimmed.slice(1, closeIndex);
  const message = trimmed.slice(closeIndex + 2).trim();
  if (message.length === 0) return null;
  return { evalId, message };
}

function parseRunErrorBlocks(
  errorMessage: string,
): ParsedRunErrorBlock[] | null {
  const lines = errorMessage.split('\n');
  const blocks: ParsedRunErrorBlock[] = [];
  let currentBlock: {
    evalId: string;
    message: string;
    detailLines: string[];
  } | null = null;

  for (const line of lines) {
    const parsedLine = parseRunErrorLine(line);
    if (parsedLine !== null) {
      if (currentBlock !== null) {
        blocks.push({
          evalId: currentBlock.evalId,
          message: currentBlock.message,
          stack:
            currentBlock.detailLines.length > 0
              ? currentBlock.detailLines.join('\n').trim()
              : undefined,
        });
      }
      currentBlock = { ...parsedLine, detailLines: [] };
      continue;
    }

    if (line.trim().length === 0) continue;
    if (currentBlock === null) return null;
    currentBlock.detailLines.push(line);
  }

  if (currentBlock !== null) {
    blocks.push({
      evalId: currentBlock.evalId,
      message: currentBlock.message,
      stack:
        currentBlock.detailLines.length > 0
          ? currentBlock.detailLines.join('\n').trim()
          : undefined,
    });
  }

  return blocks.length > 0 ? blocks : null;
}

function formatStandaloneRunError(errorMessage: string): ErrorDetailItem {
  const lines = errorMessage.split('\n');
  const messageLineIndex = lines.findIndex((line) => line.trim().length > 0);
  const message =
    messageLineIndex >= 0 ? lines[messageLineIndex]?.trim() : errorMessage;
  const stackText = lines
    .filter((_, index) => index !== messageLineIndex)
    .join('\n')
    .trim();

  return {
    id: 'run-error',
    name: 'Error',
    message: message ?? errorMessage,
    meta: undefined,
    stack: stackText.length > 0 ? stackText : undefined,
    attributes: undefined,
  };
}

function formatRunErrorItems(errorMessage: string): ErrorDetailItem[] {
  const parsedBlocks = parseRunErrorBlocks(errorMessage);
  if (parsedBlocks === null) return [formatStandaloneRunError(errorMessage)];

  return parsedBlocks.map((line, index) => ({
    id: `${String(index)}-${line.evalId}`,
    name: 'Error',
    message: line.message,
    meta: `Eval ${line.evalId}`,
    stack: line.stack,
    attributes: undefined,
  }));
}

function getScopedRunErrorMessage(params: {
  errorMessage: string | null;
  evals: Array<{ id: string; key: string; filePath: string }>;
  selectedEvalKey: string | null;
  selectedFolderPath: string | null;
}): string | null {
  if (params.errorMessage === null || params.errorMessage.length === 0) {
    return null;
  }

  if (params.selectedEvalKey === null && params.selectedFolderPath === null) {
    return params.errorMessage;
  }

  const parsedBlocks = parseRunErrorBlocks(params.errorMessage);
  if (parsedBlocks === null) {
    return params.errorMessage;
  }

  const selectedEvalIds = getSelectedRunErrorEvalIds({
    evals: params.evals,
    selectedEvalKey: params.selectedEvalKey,
    selectedFolderPath: params.selectedFolderPath,
  });
  const scopedLines = parsedBlocks.filter((line) =>
    selectedEvalIds.has(line.evalId),
  );

  if (scopedLines.length === 0) return null;
  return scopedLines
    .map((line) => {
      const heading = `[${line.evalId}] ${line.message}`;
      return line.stack === undefined ? heading : `${heading}\n${line.stack}`;
    })
    .join('\n');
}

function getSelectedRunErrorEvalIds(params: {
  evals: Array<{ id: string; key: string; filePath: string }>;
  selectedEvalKey: string | null;
  selectedFolderPath: string | null;
}): Set<string> {
  if (params.selectedEvalKey !== null) {
    const selectedEval = params.evals.find(
      (ev) =>
        ev.key === params.selectedEvalKey || ev.id === params.selectedEvalKey,
    );
    const selectedIds = new Set<string>([params.selectedEvalKey]);
    if (selectedEval !== undefined) {
      selectedIds.add(selectedEval.id);
      selectedIds.add(selectedEval.key);
    }
    return selectedIds;
  }

  if (params.selectedFolderPath === null) return new Set();

  const evalKeysInFolder = getEvalIdsForFolderPath({
    evals: params.evals,
    selectedFolderPath: params.selectedFolderPath,
  });
  const selectedIds = new Set<string>();
  for (const evalSummary of params.evals) {
    if (!evalKeysInFolder.has(evalSummary.key)) continue;
    selectedIds.add(evalSummary.id);
    selectedIds.add(evalSummary.key);
  }
  return selectedIds;
}

export function RunDrawer() {
  const { selectedRunId, selectedRunScope } = runStore.useSelectorRC((s) => ({
    selectedRunId: s.selectedRunId,
    selectedRunScope: s.selectedRunScope,
  }));
  const selectedRunResult = runDetailStore.useItem(
    selectedRunId === null ? null : { runId: selectedRunId },
  );
  const selectedRunDetail = selectedRunResult.data;
  const evals = evalSummariesStore.useDocument().data ?? [];
  const { sidebarWidth } = layoutStore.useSelectorRC((s) => ({
    sidebarWidth: s.sidebarWidth,
  }));
  const { selection } = selectionStore.useSelectorRC((s) => ({
    selection: s.selection,
  }));
  const workspaceRoot =
    workspaceConfigStore.useDocument().data?.workspaceRoot ??
    DEFAULT_WORKSPACE_CONFIG.workspaceRoot;
  const windowWidth = useWindowWidth();
  const minWidth = 360;
  const maxWidth = Math.max(minWidth, windowWidth - sidebarWidth);
  const { width, dragging, rootRef, handlePointerDown, handleDoubleClick } =
    useResizableWidth<HTMLDivElement>({
      storageKey: 'agent-evals.run-drawer-width',
      minWidth,
      maxWidth,
      defaultWidth: 540,
      edge: 'left',
    });

  const deleteRunCacheAction = useActionFn(async (runId: string) => {
    if (
      !window.confirm(
        'Delete cached entries recorded by this run and all previous runs?',
      )
    ) {
      return;
    }

    const errorMessage = await deleteCacheEntriesForRunAndPrevious(runId);
    if (errorMessage !== null) window.alert(errorMessage);
  });

  if (selectedRunResult.error !== null && selectedRunDetail === null) {
    return (
      <DrawerError style={{ width: `${width}px` }}>
        {selectedRunResult.error.message}
      </DrawerError>
    );
  }

  if (!selectedRunDetail) {
    return (
      <DrawerLoading style={{ width: `${width}px` }}>
        <LoadingLine>Loading run</LoadingLine>
      </DrawerLoading>
    );
  }

  const { manifest, summary, cases } = selectedRunDetail;
  const runFolderPath = formatRunFolderPath(workspaceRoot, manifest.id);
  const runFolderDisplayPath = formatRunFolderDisplayPath(manifest.id);
  const scopedEvalId =
    selectedRunScope?.kind === 'eval'
      ? selectedRunScope.id
      : selection.kind === 'eval'
        ? selection.id
        : null;
  const scopedFolderPath =
    selectedRunScope?.kind === 'folder'
      ? selectedRunScope.path
      : selection.kind === 'folder'
        ? selection.path
        : null;
  const scopedRunCases = scopeRunCases({
    cases,
    evals,
    selectedEvalKey: scopedEvalId,
    selectedFolderPath: scopedFolderPath,
  });
  const scopedSummary =
    scopedRunCases.label === null
      ? summary
      : deriveScopedSummaryFromCases({
          caseRows: scopedRunCases.cases,
          lifecycleStatus: manifest.status,
        });
  const displayStatus =
    manifest.status === 'running'
      ? getActiveScopedRunStatus(scopedRunCases.cases)
      : deriveStatusFromCaseRows({
          caseRows: scopedRunCases.cases,
          lifecycleStatus: manifest.status,
        });
  const failed = scopedSummary.failedCases + scopedSummary.errorCases;
  const scopedErrorMessage =
    summary.status === 'error'
      ? getScopedRunErrorMessage({
          errorMessage: summary.errorMessage,
          evals,
          selectedEvalKey: scopedEvalId,
          selectedFolderPath: scopedFolderPath,
        })
      : null;
  const showError = scopedErrorMessage !== null;
  const runErrorItems =
    scopedErrorMessage !== null ? formatRunErrorItems(scopedErrorMessage) : [];

  const scopedCases = scopedRunCases.cases;
  const showEvalIdInCase = new Set(scopedCases.map((c) => c.evalId)).size > 1;

  const runIsRunning = manifest.status === 'running';
  async function handleCopyRunFolderPath() {
    await copyTextToClipboard(runFolderPath, 'Copy run folder path');
  }

  const menuEntries: SplitButtonMenuEntry[] = [
    ...(manifest.temporary
      ? [
          {
            id: 'promote-run',
            label: 'Keep run',
            description: 'Save this temporary run permanently.',
            onSelect: () => {
              void promoteRun(manifest.id);
            },
          },
        ]
      : []),
    {
      id: 'copy-run-folder-path',
      label: 'Copy run folder path',
      description: 'Copy the saved artifact directory for this run.',
      onSelect: () => {
        void handleCopyRunFolderPath();
      },
    },
    {
      id: 'delete-run-cache-history',
      label: deleteRunCacheAction.isInProgress
        ? 'Deleting run caches'
        : 'Delete run caches',
      description:
        'Remove cache entries recorded by this run and earlier saved runs.',
      tone: 'danger',
      onSelect: () => {
        if (deleteRunCacheAction.isInProgress) return;
        void deleteRunCacheAction.call(manifest.id);
      },
    },
    {
      id: 'delete-run',
      label: 'Delete run',
      description: runIsRunning
        ? 'Cancel the run before deleting.'
        : 'Remove this run from history and disk.',
      tone: 'danger',
      onSelect: () => {
        if (runIsRunning) return;
        if (!window.confirm('Delete this run? This cannot be undone.')) return;
        void deleteRun(manifest.id);
      },
    },
  ];

  return (
    <DrawerRoot
      ref={rootRef}
      style={{ width: `${width}px` }}
    >
      <ResizeHandle
        dragging={dragging}
        edge="left"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      />
      <Header>
        <HeaderTop>
          <HeaderKicker>Run</HeaderKicker>
          <HeaderActions>
            {runIsRunning ? (
              <Button
                variant="danger"
                leftIcon={<SquareStop />}
                onClick={() => void cancelRun(manifest.id)}
                aria-label="Stop run"
              >
                Stop
              </Button>
            ) : null}
            <MenuButton
              menu={menuEntries}
              aria-label="Run actions"
            />
            <IconButton
              onClick={closeRun}
              aria-label="Close run drawer"
            >
              <X />
            </IconButton>
          </HeaderActions>
        </HeaderTop>
        <HeaderLeft>
          <RunTag>RUN</RunTag>
          {manifest.temporary ? <TemporaryTag>TEMPORARY</TemporaryTag> : null}
          <RunTime>{formatTimestamp(manifest.startedAt)}</RunTime>
          <StatusBadge status={displayStatus} />
        </HeaderLeft>
      </Header>

      <Body>
        <StatGrid>
          <Stat>
            <StatLabel>Cases</StatLabel>
            <StatValue
              accent={false}
              error={false}
            >
              {String(scopedSummary.totalCases)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Passed</StatLabel>
            <StatValue
              accent={false}
              error={false}
            >
              {String(scopedSummary.passedCases)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Failed</StatLabel>
            <StatValue
              accent={false}
              error={failed > 0}
            >
              {String(failed)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Duration</StatLabel>
            <StatValue
              accent={false}
              error={false}
            >
              {formatDuration(scopedSummary.totalDurationMs)}
            </StatValue>
          </Stat>
          <Stat>
            <StatLabel>Pass rate</StatLabel>
            <StatValue
              accent={true}
              error={false}
            >
              {scopedSummary.totalCases > 0
                ? `${String(scopedSummary.passedCases)}/${String(scopedSummary.totalCases)}`
                : '\u2014'}
            </StatValue>
          </Stat>
        </StatGrid>

        <Section>
          <SectionLabel>
            Cases{scopedCases.length > 0 ? ` (${scopedCases.length})` : ''}
          </SectionLabel>
          {scopedCases.length === 0 ? (
            <EmptyCases>No cases in this run</EmptyCases>
          ) : (
            <CaseList>
              {scopedCases.map((caseRow) => (
                <CaseItem
                  key={`${caseRow.caseKey ?? caseRow.caseId}-${String(caseRow.trial)}`}
                  type="button"
                  onClick={() =>
                    void selectCase(
                      manifest.id,
                      caseRow.caseKey ?? caseRow.caseId,
                    )
                  }
                >
                  <StatusBadge status={getCaseDisplayStatus(caseRow.status)} />
                  <CaseMain>
                    <CaseId>{caseRow.caseId}</CaseId>
                    {showEvalIdInCase ? (
                      <CaseSubline>{caseRow.evalId}</CaseSubline>
                    ) : null}
                  </CaseMain>
                  <CaseMetrics>
                    <CaseMetric>{formatCaseDuration(caseRow)}</CaseMetric>
                  </CaseMetrics>
                </CaseItem>
              ))}
            </CaseList>
          )}
        </Section>

        {showError ? (
          <Section>
            <ErrorDetails
              label={runErrorItems.length === 1 ? 'Run error' : 'Run errors'}
              errors={runErrorItems}
            />
          </Section>
        ) : null}

        <Section>
          <SectionLabel>Metadata</SectionLabel>
          <MetaList>
            <MetaKey>Run id</MetaKey>
            <MetaValue>{manifest.id}</MetaValue>
            <MetaKey>Run folder</MetaKey>
            <CopyableMetaValue>
              <Tooltip content={runFolderPath}>
                <MetaPath>{runFolderDisplayPath}</MetaPath>
              </Tooltip>
              <Tooltip content="Copy run folder path">
                <IconButton
                  onClick={() => void handleCopyRunFolderPath()}
                  aria-label="Copy run folder path"
                >
                  <Copy />
                </IconButton>
              </Tooltip>
            </CopyableMetaValue>
            {scopedRunCases.label !== null ? (
              <>
                <MetaKey>Scope</MetaKey>
                <MetaValue>{scopedRunCases.label}</MetaValue>
              </>
            ) : null}
            <MetaKey>Lifecycle status</MetaKey>
            <MetaValue>{manifest.status}</MetaValue>
            <MetaKey>Started</MetaKey>
            <MetaValue>{manifest.startedAt}</MetaValue>
            <MetaKey>Ended</MetaKey>
            <MetaValue>{manifest.endedAt ?? '\u2014'}</MetaValue>
            <MetaKey>Trials</MetaKey>
            <MetaValue>{String(manifest.trials)}</MetaValue>
            <MetaKey>Target</MetaKey>
            <MetaValue>{formatTarget(manifest.target)}</MetaValue>
          </MetaList>
        </Section>
      </Body>
    </DrawerRoot>
  );
}
