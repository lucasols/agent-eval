import type {
  CacheMode,
  EvalDisplayStatus,
  EvalSummary,
} from '@agent-evals/shared';
import { Play, SquareStop } from 'lucide-react';
import { useState } from 'react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { EmptyState } from '#src/components/EmptyState';
import { EvalCard } from '#src/components/EvalCard';
import { MenuButton } from '#src/components/MenuButton';
import { PathBreadcrumb } from '#src/components/PathBreadcrumb';
import {
  SplitButton,
  type SplitButtonMenuEntry,
} from '#src/components/SplitButton';
import { TagPickerModal } from '#src/components/TagPickerModal';
import {
  cleanRunsForEval,
  clearCacheForEval,
  cancelRun,
  recomputeStatusesForEval,
  startRun,
  runStore,
} from '#src/stores/runStore';
import {
  selectionStore,
  selectFolder,
  toggleEvalStatusFilter,
} from '#src/stores/selectionStore';
import { colors } from '#src/style/colors';
import { inline, kicker, stack, transition } from '#src/style/helpers';
import {
  getActiveEvalStatus,
  targetIncludesEval,
} from '#src/utils/activeEvalStatus';
import {
  filterEvalsByStatuses,
  filterEvalsByTags,
  getStatusBreakdown,
} from '#src/utils/buildEvalTree';

type FolderViewProps = { folderPath: string; evals: EvalSummary[] };

const Root = styled.div`
  height: 100%;
  overflow: auto;
`;

const Header = styled.div`
  ${stack({ gap: 6 })}
  padding: 22px 32px 18px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.bg.var};
  position: sticky;
  top: 0;
  z-index: 3;
`;

const TitleRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 14 })}
`;

const HeaderMeta = styled.div`
  ${inline({ align: 'center', gap: 12 })}
`;

const Count = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  flex-wrap: wrap;
`;

const TotalPill = styled.span`
  ${inline({ gap: 5, align: 'center' })}
  ${kicker};
  padding: 3px 9px;
  border-radius: 999px;
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  line-height: 1;
  letter-spacing: 0.04em;
`;

const TotalPillValue = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${colors.text.var};
  letter-spacing: -0.01em;
`;

type BreakdownTone =
  | 'running'
  | 'pass'
  | 'fail'
  | 'stale'
  | 'outdated'
  | 'unscored'
  | 'cancelled'
  | 'pending';

const BreakdownPill = styled.button<{
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
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 9.5px;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 500;
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};
  border: 1px solid transparent;
  cursor: pointer;

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }
  &.active {
    color: ${colors.bg.var};
    background: ${colors.text.var};
    border-color: ${colors.text.var};
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
    color: ${colors.textMuted.var};
    background: ${colors.surfaceActive.var};
    border-color: ${colors.border.var};
  }
  &.outdated:not(.active) {
    color: ${colors.warning.var};
    background: ${colors.warning.alpha(0.1)};
    border-color: ${colors.warning.alpha(0.22)};
  }
  &.unscored:not(.active) {
    color: ${colors.accentDim.var};
    background: ${colors.accent.alpha(0.09)};
    border-color: ${colors.accent.alpha(0.2)};
  }
  &.pending:not(.active) {
    color: ${colors.textMuted.var};
    background: ${colors.surface.var};
    border-color: ${colors.border.var};
  }
`;

const BreakdownValue = styled.span`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: -0.01em;
`;

const BREAKDOWN_STATUS_ORDER: Array<{
  key: EvalDisplayStatus;
  label: string;
  tone: BreakdownTone;
}> = [
  { key: 'running', label: 'running', tone: 'running' },
  { key: 'enqueued', label: 'enqueued', tone: 'pending' },
  { key: 'pass', label: 'pass', tone: 'pass' },
  { key: 'fail', label: 'fail', tone: 'fail' },
  { key: 'error', label: 'error', tone: 'fail' },
  { key: 'stale', label: 'stale', tone: 'stale' },
  { key: 'outdated', label: 'outdated', tone: 'outdated' },
  { key: 'unscored', label: 'unscored', tone: 'unscored' },
  { key: 'cancelled', label: 'cancelled', tone: 'cancelled' },
  { key: 'pending', label: 'pending', tone: 'pending' },
];

const Stack = styled.div`
  ${stack({ gap: 20 })}
  padding: 24px 32px 40px;
`;

export function FolderView({ folderPath, evals }: FolderViewProps) {
  const [maintenanceAction, setMaintenanceAction] = useState<
    'recompute' | 'clean' | null
  >(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagPickerCacheMode, setTagPickerCacheMode] =
    useState<CacheMode>('use');
  const [tagPickerTemporary, setTagPickerTemporary] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));
  const { statusFilters, tagFilters } = selectionStore.useSelectorRC((s) => ({
    statusFilters: s.statusFilters,
    tagFilters: s.tagFilters,
  }));
  const displaySegments = folderPath
    .split('/')
    .filter((segment) => segment.length > 0);
  const currentLabel = displaySegments.at(-1) ?? '/';
  const parentSegments = displaySegments
    .slice(0, -1)
    .map((label, index) => ({
      label,
      path: displaySegments.slice(0, index + 1).join('/'),
    }));
  const getEvalActiveStatusForKey = (evalKey: string) =>
    getActiveEvalStatus(currentRun, evalKey);
  const statusFilteredEvals = filterEvalsByStatuses(
    evals,
    statusFilters,
    getEvalActiveStatusForKey,
  );
  const filteredEvals = filterEvalsByTags(statusFilteredEvals, tagFilters);
  const evalKeys = filteredEvals.map((ev) => ev.key);
  const isRunning =
    currentRun?.manifest.status === 'running' &&
    evalKeys.some((evalKey) =>
      targetIncludesEval(currentRun.manifest.target, evalKey),
    );
  const breakdown = getStatusBreakdown(evals, getEvalActiveStatusForKey);
  const breakdownItems = BREAKDOWN_STATUS_ORDER.filter(
    ({ key }) => breakdown[key] > 0 || statusFilters.has(key),
  );
  const availableTags = [
    ...new Set(filteredEvals.flatMap((ev) => ev.tags ?? [])),
  ].toSorted();

  function startRunForEvalKeys(
    cacheMode?: 'use' | 'bypass' | 'refresh',
    temporary = false,
  ): void {
    if (evalKeys.length === 0) return;
    const skipped = filteredEvals.filter((ev) => ev.manualInput !== undefined);
    const runnableKeys = filteredEvals
      .filter((ev) => ev.manualInput === undefined)
      .map((ev) => ev.key);
    if (skipped.length > 0) {
      const skippedNames = skipped.map((ev) => ev.title ?? ev.id).join(', ');
      window.alert(
        `Skipping ${String(skipped.length)} eval(s) that require manual input — run them individually: ${skippedNames}`,
      );
    }
    if (runnableKeys.length === 0) return;
    void startRun(
      { mode: 'evalIds', evalKeys: runnableKeys },
      { ...(cacheMode ? { cacheMode } : {}), temporary },
    );
  }

  function handleRunAll() {
    startRunForEvalKeys();
  }

  function handleTemporaryRunAll() {
    startRunForEvalKeys(undefined, true);
  }

  function openTagPicker(cacheMode: CacheMode) {
    setTagPickerCacheMode(cacheMode);
    setTagPickerTemporary(false);
    setSelectedTags(availableTags);
    setTagPickerOpen(true);
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((selected) => selected !== tag)
        : [...current, tag],
    );
  }

  function handleRunTags() {
    if (selectedTags.length === 0) return;
    const skipped = filteredEvals.filter((ev) => ev.manualInput !== undefined);
    const runnableKeys = filteredEvals
      .filter((ev) => ev.manualInput === undefined)
      .map((ev) => ev.key);
    if (skipped.length > 0) {
      const skippedNames = skipped.map((ev) => ev.title ?? ev.id).join(', ');
      window.alert(
        `Skipping ${String(skipped.length)} eval(s) that require manual input — run them individually: ${skippedNames}`,
      );
    }
    if (runnableKeys.length === 0) return;
    setTagPickerOpen(false);
    void startRun(
      {
        mode: 'evalIds',
        evalKeys: runnableKeys,
        tagsFilter: [selectedTags.join(' || ')],
      },
      { cacheMode: tagPickerCacheMode, temporary: tagPickerTemporary },
    );
  }

  function handleStop() {
    void cancelRun(currentRun?.manifest.id);
  }

  function handleRecomputeStatuses() {
    setMaintenanceAction('recompute');
    void Promise.all(
      evalKeys.map((evalKey) => recomputeStatusesForEval(evalKey)),
    ).finally(() => {
      setMaintenanceAction(null);
    });
  }

  function handleCleanRuns() {
    setMaintenanceAction('clean');
    void Promise.all(
      evalKeys.map((evalKey) => cleanRunsForEval(evalKey)),
    ).finally(() => {
      setMaintenanceAction(null);
    });
  }

  function handleClearCache() {
    void Promise.all(evalKeys.map((evalKey) => clearCacheForEval(evalKey)));
  }

  const cacheMenu: SplitButtonMenuEntry[] = [
    {
      id: 'run-default',
      label: 'Run all',
      description: 'Run all evals using default evals config',
      onSelect: () => startRunForEvalKeys('use'),
    },
    {
      id: 'run-no-cache',
      label: 'Run without cache',
      description: 'Skip reads and writes for this run.',
      onSelect: () => startRunForEvalKeys('bypass'),
    },
    {
      id: 'run-temporary',
      label: 'Run temporary',
      description: 'Persist this run until the next run starts.',
      onSelect: handleTemporaryRunAll,
    },
    {
      id: 'run-tags',
      label: 'Run tags',
      description: 'Choose tags to run in this folder.',
      onSelect: () => openTagPicker('use'),
    },
    {
      id: 'run-refresh',
      label: 'Refresh cache',
      description: 'Force re-execution and overwrite entries.',
      onSelect: () => startRunForEvalKeys('refresh'),
    },
  ];

  const moreMenu: SplitButtonMenuEntry[] = [
    {
      id: 'clear-cache',
      label: 'Clear cache for these evals',
      description: 'Remove cached entries tied to every eval in view.',
      tone: 'danger',
      onSelect: () => {
        if (
          !window.confirm(
            `Clear cached entries recorded by saved runs for ${String(evalKeys.length)} evals in this view?`,
          )
        ) {
          return;
        }
        handleClearCache();
      },
    },
    { kind: 'separator' },
    {
      id: 'recompute-status',
      label: 'Recompute status',
      description:
        'Recalculate statuses for saved runs that touched these evals.',
      onSelect: handleRecomputeStatuses,
    },
    {
      id: 'clean-runs',
      label: 'Clean runs',
      description: 'Delete saved terminal runs that touched these evals.',
      tone: 'danger',
      onSelect: () => {
        if (
          !window.confirm(
            `Delete saved runs for ${String(evalKeys.length)} evals in this view?`,
          )
        ) {
          return;
        }
        handleCleanRuns();
      },
    },
  ];

  return (
    <Root>
      <Header>
        <TitleRow>
          <PathBreadcrumb
            segments={parentSegments}
            currentLabel={currentLabel}
            onSelect={selectFolder}
          />
          <HeaderMeta>
            <Count>
              <TotalPill>
                <TotalPillValue>
                  {statusFilters.size > 0 || tagFilters.size > 0
                    ? `${filteredEvals.length}/${evals.length}`
                    : evals.length}
                </TotalPillValue>
                {filteredEvals.length === 1 ? 'eval' : 'evals'}
              </TotalPill>
              {breakdownItems.map(({ key, label, tone }) => (
                <BreakdownPill
                  key={key}
                  type="button"
                  aria-pressed={statusFilters.has(key)}
                  active={statusFilters.has(key)}
                  pass={tone === 'pass'}
                  fail={tone === 'fail'}
                  running={tone === 'running'}
                  cancelled={tone === 'cancelled'}
                  stale={tone === 'stale'}
                  outdated={tone === 'outdated'}
                  unscored={tone === 'unscored'}
                  pending={tone === 'pending'}
                  onClick={() => {
                    toggleEvalStatusFilter(key);
                  }}
                >
                  <BreakdownValue>{breakdown[key]}</BreakdownValue>
                  {label}
                </BreakdownPill>
              ))}
            </Count>
            {isRunning ? (
              <Button
                variant="danger"
                leftIcon={<SquareStop />}
                onClick={handleStop}
                aria-label="Stop run"
              >
                Stop
              </Button>
            ) : (
              <SplitButton
                label="Run all"
                leftIcon={<Play />}
                onPrimaryClick={handleRunAll}
                disabled={evalKeys.length === 0}
                menu={cacheMenu}
                aria-label="Run all"
              />
            )}
            <MenuButton
              menu={moreMenu}
              disabled={evalKeys.length === 0 || maintenanceAction !== null}
              aria-label="More eval actions"
            />
          </HeaderMeta>
        </TitleRow>
      </Header>
      {evals.length === 0 ? (
        <EmptyState
          title="No evals here"
          description="This folder doesn't contain any evals."
        />
      ) : filteredEvals.length === 0 ? (
        <EmptyState
          title="No evals match"
          description="The active filters hide every eval in this folder."
        />
      ) : (
        <Stack>
          {filteredEvals.map((ev) => (
            <EvalCard
              key={ev.key}
              evalSummary={ev}
              mode="stacked"
            />
          ))}
        </Stack>
      )}
      <TagPickerModal
        isOpen={tagPickerOpen}
        title="Run Tags"
        subtitle={currentLabel}
        tags={availableTags}
        selectedTags={selectedTags}
        cacheMode={tagPickerCacheMode}
        temporary={tagPickerTemporary}
        onCacheModeChange={setTagPickerCacheMode}
        onTemporaryChange={setTagPickerTemporary}
        onSelectedTagsChange={setSelectedTags}
        onToggleTag={toggleTag}
        onCancel={() => setTagPickerOpen(false)}
        onRun={handleRunTags}
      />
    </Root>
  );
}
