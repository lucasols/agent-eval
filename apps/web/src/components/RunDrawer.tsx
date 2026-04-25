import {
  deriveScopedSummaryFromCases,
  deriveStatusFromCaseRows,
  type CaseRow,
} from '@agent-evals/shared';
import { X } from 'lucide-react';
import { styled } from 'vindur';
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
import { useResizableWidth } from '../hooks/useResizableWidth.ts';
import { useWindowWidth } from '../hooks/useWindowWidth.ts';
import { evalsStore } from '../stores/evalsStore.ts';
import { layoutStore } from '../stores/layoutStore.ts';
import {
  closeRun,
  deleteRun,
  runStore,
  selectCase,
} from '../stores/runStore.ts';
import { selectionStore } from '../stores/selectionStore.ts';
import { scopeRunCases } from '../utils/evalRuns.ts';
import { formatDuration, formatTimestamp } from '../utils/formatters.ts';
import { IconButton } from './IconButton.tsx';
import { MenuButton } from './MenuButton.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import type { SplitButtonMenuEntry } from './SplitButton.tsx';
import { StatusBadge } from './StatusBadge.tsx';

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

const ErrorBlock = styled.pre`
  ${monoFont};
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${colors.error.var};
  background: ${colors.error.alpha(0.06)};
  border: 1px solid ${colors.error.alpha(0.3)};
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin: 0;
`;

function formatCaseDuration(caseRow: CaseRow): string {
  if (caseRow.latencyMs === null || caseRow.latencyMs <= 0) return '—';
  return formatDuration(caseRow.latencyMs);
}

function formatTarget(target: {
  mode: 'all' | 'evalIds' | 'caseIds';
  evalIds?: string[];
  caseIds?: string[];
}): string {
  if (target.mode === 'all') return 'all evals';
  if (target.mode === 'evalIds') {
    const ids = target.evalIds ?? [];
    return ids.length > 0 ? ids.join(', ') : 'evalIds';
  }
  const ids = target.caseIds ?? [];
  return ids.length > 0 ? ids.join(', ') : 'caseIds';
}

export function RunDrawer() {
  const { selectedRunDetail, selectedRunScope } = runStore.useSelectorRC(
    (s) => ({
      selectedRunDetail: s.selectedRunDetail,
      selectedRunScope: s.selectedRunScope,
    }),
  );
  const { evals } = evalsStore.useSelectorRC((s) => ({ evals: s.evals }));
  const { sidebarWidth } = layoutStore.useSelectorRC((s) => ({
    sidebarWidth: s.sidebarWidth,
  }));
  const { selection } = selectionStore.useSelectorRC((s) => ({
    selection: s.selection,
  }));
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

  if (!selectedRunDetail) {
    return (
      <DrawerLoading style={{ width: `${width}px` }}>
        Loading run...
      </DrawerLoading>
    );
  }

  const { manifest, summary, cases } = selectedRunDetail;
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
    selectedEvalId: scopedEvalId,
    selectedFolderPath: scopedFolderPath,
  });
  const scopedSummary =
    scopedRunCases.label === null
      ? summary
      : deriveScopedSummaryFromCases({
          caseRows: scopedRunCases.cases,
          lifecycleStatus: manifest.status,
        });
  const displayStatus = deriveStatusFromCaseRows({
    caseRows: scopedRunCases.cases,
    lifecycleStatus: manifest.status,
  });
  const failed = scopedSummary.failedCases + scopedSummary.errorCases;
  const showError =
    scopedRunCases.label === null &&
    summary.status === 'error' &&
    summary.errorMessage !== null &&
    summary.errorMessage.length > 0;

  const scopedCases = scopedRunCases.cases;
  const showEvalIdInCase = new Set(scopedCases.map((c) => c.evalId)).size > 1;

  const runIsRunning = manifest.status === 'running';
  const menuEntries: SplitButtonMenuEntry[] = [
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
                  key={`${caseRow.caseId}-${String(caseRow.trial)}`}
                  type="button"
                  onClick={() => void selectCase(manifest.id, caseRow.caseId)}
                >
                  <StatusBadge status={caseRow.status} />
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

        {showError && summary.errorMessage !== null ? (
          <Section>
            <SectionLabel>Error</SectionLabel>
            <ErrorBlock>{summary.errorMessage}</ErrorBlock>
          </Section>
        ) : null}

        <Section>
          <SectionLabel>Metadata</SectionLabel>
          <MetaList>
            <MetaKey>Run id</MetaKey>
            <MetaValue>{manifest.id}</MetaValue>
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
