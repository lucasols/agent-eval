import {
  getCaseRowCaseKey,
  type CacheActivityEntry,
  type CaseRow,
} from '@agent-evals/shared';
import {
  MultiFileDiff,
  type FileContents,
  type LineDiffTypes,
  type MultiFileDiffProps,
} from '@pierre/diffs/react';
import { Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { LoadingLine } from '#src/components/LoadingState';
import { Modal } from '#src/components/Modal';
import { cacheEntryStore } from '#src/stores/cacheStore';
import { runHistoryStore } from '#src/stores/historyStore';
import { caseDetailStore } from '#src/stores/runStore';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import {
  getScopedCacheActivityEntries,
  type ScopedCacheActivityEntry,
} from '#src/utils/cacheActivity';
import {
  getSameEvalCases,
  getSameEvalRuns,
  selectDefaultComparisonCaseKey,
  selectDefaultComparisonRunId,
  stringifyCanonicalJson,
} from '#src/utils/cacheRawKeyCompare';
import { copyTextToClipboard } from '#src/utils/clipboard';
import { formatTimestamp } from '#src/utils/formatters';

const SelectorGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;

  @media (max-width: 980px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const Field = styled.label`
  ${stack({ gap: 6 })}
  min-width: 0;
`;

const FieldLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const SelectInput = styled.select`
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
  background: ${colors.bg.var};
  color: ${colors.text.var};
  font-size: 12.5px;
`;

const ReadonlyValue = styled.div`
  ${monoFont};
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
  color: ${colors.text.var};
  font-size: 12px;
  line-height: 32px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StatusMessage = styled.div`
  ${monoFont};
  padding: 14px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  color: ${colors.textMuted.var};
  background: ${colors.bgElevated.var};
  font-size: 12px;
`;

const ErrorMessage = styled(StatusMessage)`
  color: ${colors.error.var};
  border-color: ${colors.error.alpha(0.25)};
  background: ${colors.error.alpha(0.04)};
`;

const DiffHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  margin: 0 0 8px;
  flex-wrap: wrap;
`;

const DiffTitle = styled.div`
  ${stack({ gap: 2 })}
  min-width: 0;
`;

const DiffLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const DiffMeta = styled.span`
  ${monoFont};
  color: ${colors.textMuted.var};
  font-size: 11px;
  word-break: break-word;
`;

const EqualBadge = styled.span`
  ${kicker};
  flex-shrink: 0;
  padding: 4px 7px;
  border-radius: var(--radius-sm);
  background: ${colors.success.alpha(0.12)};
  color: ${colors.success.var};
  font-size: 10px;
`;

const DiffControls = styled.div`
  ${inline({ align: 'center', gap: 10 })}
  flex-wrap: wrap;
`;

const DiffControl = styled.label`
  ${inline({ align: 'center', gap: 6 })}
`;

const DiffControlLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
`;

const CompactSelectInput = styled(SelectInput)`
  width: auto;
  min-width: 116px;
`;

const DiffPanel = styled.div<{ wrap: boolean }>`
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: auto;
  max-height: min(640px, calc(100vh - 300px));
  background: ${colors.bg.var};

  diffs-file-diff {
    min-width: 920px;
    font-size: 12px;
  }

  &.wrap {
    diffs-file-diff {
      min-width: 0;
    }
  }
`;

const FooterActions = styled.div`
  ${inline({ justify: 'right', align: 'center', gap: 8 })}
  width: 100%;
`;

type RawKeyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; rawKey: unknown }
  | { status: 'error'; message: string };

type CacheRawKeyCompareModalProps = {
  isOpen: boolean;
  currentEntry: CacheActivityEntry;
  currentRunId: string;
  currentCaseKey: string;
  currentEvalKey: string;
  currentCacheIndex: number;
  onClose: () => void;
};

type DiffStyle = 'split' | 'unified';
type DiffOverflow = 'scroll' | 'wrap';
type LineDiffType = LineDiffTypes;

function getRunLabel(run: {
  manifest: { shortId: string; startedAt: string; id: string };
}): string {
  return `${run.manifest.shortId} · ${formatTimestamp(run.manifest.startedAt)}`;
}

function getCurrentRunLabel(params: {
  runs: Array<{ manifest: { id: string; shortId: string; startedAt: string } }>;
  currentRunId: string;
}): string {
  const currentRun = params.runs.find(
    (run) => run.manifest.id === params.currentRunId,
  );
  return currentRun === undefined
    ? params.currentRunId
    : getRunLabel(currentRun);
}

function getCaseLabel(caseRow: CaseRow): string {
  return `${caseRow.caseId} · trial ${String(caseRow.trial)}`;
}

function getCacheLabel(entry: ScopedCacheActivityEntry, index: number): string {
  const status = entry.entry.action === 'hit' ? 'hit' : entry.entry.action;
  const phase =
    entry.phase.kind === 'scoring' ? `${entry.phase.scoreLabel} · ` : '';
  return `#${String(index + 1)} · ${phase}${entry.entry.name} · ${status}`;
}

function useRawCacheKey(entry: CacheActivityEntry | null): RawKeyState {
  const payload = useMemo(
    () =>
      entry?.stored === true
        ? { namespace: entry.namespace, key: entry.key }
        : null,
    [entry],
  );
  const cacheEntry = cacheEntryStore.useItem(payload);

  if (entry === null) return { status: 'idle' };
  if (!entry.stored) {
    return { status: 'error', message: 'This cache entry was not stored.' };
  }
  if (cacheEntry.isLoading) return { status: 'loading' };
  if (cacheEntry.error !== null) {
    return { status: 'error', message: cacheEntry.error.message };
  }
  if (cacheEntry.data === null) return { status: 'idle' };
  if (cacheEntry.data.debugKey === undefined) {
    return {
      status: 'error',
      message: 'Raw cache key debug data is not available.',
    };
  }
  return { status: 'loaded', rawKey: cacheEntry.data.debugKey.rawKey };
}

function selectedEntryFromEntries(params: {
  entries: ScopedCacheActivityEntry[];
  selectedEntryId: string | null;
  currentCacheIndex: number;
}): ScopedCacheActivityEntry | null {
  const selectedEntry = params.entries.find(
    (entry) => entry.id === params.selectedEntryId && entry.entry.stored,
  );
  if (selectedEntry !== undefined) return selectedEntry;
  const sameIndexEntry = params.entries[params.currentCacheIndex];
  if (sameIndexEntry?.entry.stored === true) return sameIndexEntry;
  return params.entries.find((entry) => entry.entry.stored) ?? null;
}

export function CacheRawKeyCompareModal({
  isOpen,
  currentEntry,
  currentRunId,
  currentCaseKey,
  currentEvalKey,
  currentCacheIndex,
  onClose,
}: CacheRawKeyCompareModalProps) {
  const runHistoryResult = runHistoryStore.useDocument();
  const runs = runHistoryResult.data ?? [];
  const runHistoryIsLoading = runHistoryResult.isLoading && runs.length === 0;
  const runOptions = useMemo(
    () => getSameEvalRuns(runs, currentEvalKey),
    [currentEvalKey, runs],
  );
  const defaultRunId = selectDefaultComparisonRunId({
    runs: runOptions,
    currentRunId,
  });
  const [selectedRunId, setSelectedRunId] = useState(defaultRunId ?? '');
  const effectiveRunId = runOptions.some(
    (run) => run.manifest.id === selectedRunId,
  )
    ? selectedRunId
    : (defaultRunId ?? '');
  const selectedRun = runOptions.find(
    (run) => run.manifest.id === effectiveRunId,
  );
  const caseOptions = getSameEvalCases(selectedRun, currentEvalKey);
  const defaultCaseKey = selectDefaultComparisonCaseKey({
    cases: caseOptions,
    currentCaseKey,
  });
  const [selectedCaseKey, setSelectedCaseKey] = useState(defaultCaseKey ?? '');
  const effectiveCaseKey = caseOptions.some(
    (caseRow) => getCaseRowCaseKey(caseRow) === selectedCaseKey,
  )
    ? selectedCaseKey
    : (defaultCaseKey ?? '');
  const [selectedCacheEntryId, setSelectedCacheEntryId] = useState<
    string | null
  >(null);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split');
  const [diffOverflow, setDiffOverflow] = useState<DiffOverflow>('scroll');
  const [lineDiffType, setLineDiffType] = useState<LineDiffType>('word');
  const comparisonCaseDetail = caseDetailStore.useItem(
    effectiveRunId.length === 0 || effectiveCaseKey.length === 0
      ? null
      : { runId: effectiveRunId, caseId: effectiveCaseKey },
  );

  const comparisonEntries =
    comparisonCaseDetail.data !== null
      ? getScopedCacheActivityEntries({ caseDetail: comparisonCaseDetail.data })
      : [];
  const selectedComparisonScopedEntry = selectedEntryFromEntries({
    entries: comparisonEntries,
    selectedEntryId: selectedCacheEntryId,
    currentCacheIndex,
  });
  const currentRawKeyState = useRawCacheKey(currentEntry);
  const comparisonRawKeyState = useRawCacheKey(
    selectedComparisonScopedEntry?.entry ?? null,
  );
  const currentRawKeyJson = useMemo(
    () =>
      currentRawKeyState.status === 'loaded'
        ? stringifyCanonicalJson(currentRawKeyState.rawKey)
        : null,
    [currentRawKeyState],
  );
  const comparisonRawKeyJson = useMemo(
    () =>
      comparisonRawKeyState.status === 'loaded'
        ? stringifyCanonicalJson(comparisonRawKeyState.rawKey)
        : null,
    [comparisonRawKeyState],
  );
  const comparisonFile: FileContents | null =
    comparisonRawKeyJson === null
      ? null
      : {
          name: 'comparison.raw-key.json',
          contents: comparisonRawKeyJson,
          lang: 'json',
          cacheKey: `comparison:${selectedComparisonScopedEntry?.entry.namespace ?? ''}:${selectedComparisonScopedEntry?.entry.key ?? ''}:${comparisonRawKeyJson.length}`,
        };
  const currentFile: FileContents | null =
    currentRawKeyJson === null
      ? null
      : {
          name: 'current.raw-key.json',
          contents: currentRawKeyJson,
          lang: 'json',
          cacheKey: `current:${currentEntry.namespace}:${currentEntry.key}:${currentRawKeyJson.length}`,
        };
  const selectedComparisonEntryId = selectedComparisonScopedEntry?.id ?? '';
  const currentRunLabel = getCurrentRunLabel({
    runs: runOptions,
    currentRunId,
  });
  const diffOptions: NonNullable<MultiFileDiffProps<undefined>['options']> =
    useMemo(
      () => ({
        diffStyle,
        overflow: diffOverflow,
        themeType: 'light',
        lineDiffType,
        maxLineDiffLength: Number.MAX_SAFE_INTEGER,
        collapsedContextThreshold: 6,
      }),
      [diffOverflow, diffStyle, lineDiffType],
    );

  function handleRunChange(nextRunId: string) {
    const nextRun = runOptions.find((run) => run.manifest.id === nextRunId);
    const nextCases = getSameEvalCases(nextRun, currentEvalKey);
    setSelectedRunId(nextRunId);
    setSelectedCaseKey(
      selectDefaultComparisonCaseKey({ cases: nextCases, currentCaseKey }) ??
        '',
    );
    setSelectedCacheEntryId(null);
  }

  function handleCaseChange(nextCaseKey: string) {
    setSelectedCaseKey(nextCaseKey);
    setSelectedCacheEntryId(null);
  }

  function updateLineDiffType(value: string) {
    if (
      value === 'word-alt' ||
      value === 'word' ||
      value === 'char' ||
      value === 'none'
    ) {
      setLineDiffType(value);
    }
  }

  async function handleCopyLeft() {
    if (comparisonRawKeyJson === null) return;
    await copyTextToClipboard(comparisonRawKeyJson, 'Copy left raw key');
  }

  async function handleCopyRight() {
    if (currentRawKeyJson === null) return;
    await copyTextToClipboard(currentRawKeyJson, 'Copy right raw key');
  }

  return (
    <Modal
      isOpen={isOpen}
      title="Compare Raw Cache Keys"
      subtitle={currentEntry.name}
      onClose={onClose}
      wide
      footer={
        <FooterActions>
          <Button
            variant="secondary"
            onClick={onClose}
          >
            Close
          </Button>
        </FooterActions>
      }
    >
      <SelectorGrid>
        <Field>
          <FieldLabel>Current run</FieldLabel>
          <ReadonlyValue title={currentRunLabel}>
            {currentRunLabel}
          </ReadonlyValue>
        </Field>
        <Field>
          <FieldLabel>Comparison run</FieldLabel>
          <SelectInput
            value={effectiveRunId}
            disabled={runHistoryIsLoading || runOptions.length === 0}
            onChange={(event) => handleRunChange(event.currentTarget.value)}
          >
            {runOptions.map((run) => (
              <option
                key={run.manifest.id}
                value={run.manifest.id}
              >
                {getRunLabel(run)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field>
          <FieldLabel>Case</FieldLabel>
          <SelectInput
            value={effectiveCaseKey}
            disabled={caseOptions.length === 0}
            onChange={(event) => handleCaseChange(event.currentTarget.value)}
          >
            {caseOptions.map((caseRow) => {
              const caseKey = getCaseRowCaseKey(caseRow);
              return (
                <option
                  key={caseKey}
                  value={caseKey}
                >
                  {getCaseLabel(caseRow)}
                </option>
              );
            })}
          </SelectInput>
        </Field>
        <Field>
          <FieldLabel>Cache</FieldLabel>
          <SelectInput
            value={selectedComparisonEntryId}
            disabled={comparisonEntries.length === 0}
            onChange={(event) =>
              setSelectedCacheEntryId(event.currentTarget.value)
            }
          >
            {comparisonEntries.map((entry, index) => (
              <option
                key={entry.id}
                value={entry.id}
                disabled={!entry.entry.stored}
              >
                {getCacheLabel(entry, index)}
              </option>
            ))}
          </SelectInput>
        </Field>
      </SelectorGrid>

      {runHistoryIsLoading ? (
        <StatusMessage>
          <LoadingLine>Loading saved runs</LoadingLine>
        </StatusMessage>
      ) : null}
      {!runHistoryIsLoading && runOptions.length === 0 ? (
        <StatusMessage>
          No saved runs for this eval are available.
        </StatusMessage>
      ) : null}
      {comparisonCaseDetail.isLoading ? (
        <StatusMessage>
          <LoadingLine>Loading comparison case</LoadingLine>
        </StatusMessage>
      ) : null}
      {comparisonCaseDetail.error !== null ? (
        <ErrorMessage>{comparisonCaseDetail.error.message}</ErrorMessage>
      ) : null}
      {comparisonCaseDetail.data !== null && comparisonEntries.length === 0 ? (
        <StatusMessage>
          The selected case has no cache entries to compare.
        </StatusMessage>
      ) : null}
      {comparisonCaseDetail.data !== null &&
      comparisonEntries.length > 0 &&
      selectedComparisonScopedEntry === null ? (
        <StatusMessage>
          The selected case has no stored cache entries to compare.
        </StatusMessage>
      ) : null}
      {currentRawKeyState.status === 'loading' ||
      comparisonRawKeyState.status === 'loading' ? (
        <StatusMessage>
          <LoadingLine>Loading raw cache keys</LoadingLine>
        </StatusMessage>
      ) : null}
      {currentRawKeyState.status === 'error' ? (
        <ErrorMessage>Current entry: {currentRawKeyState.message}</ErrorMessage>
      ) : null}
      {comparisonRawKeyState.status === 'error' ? (
        <ErrorMessage>
          Comparison entry: {comparisonRawKeyState.message}
        </ErrorMessage>
      ) : null}

      {currentFile !== null && comparisonFile !== null ? (
        <>
          <DiffHeader>
            <DiffTitle>
              <DiffLabel>Raw key diff</DiffLabel>
              <DiffMeta>
                {selectedComparisonScopedEntry?.entry.namespace ?? ''} ·{' '}
                {selectedComparisonScopedEntry?.entry.key ?? ''}
              </DiffMeta>
            </DiffTitle>
            {currentRawKeyJson === comparisonRawKeyJson ? (
              <EqualBadge>Identical</EqualBadge>
            ) : null}
            <DiffControls>
              <DiffControl>
                <DiffControlLabel>Style</DiffControlLabel>
                <CompactSelectInput
                  value={diffStyle}
                  onChange={(event) =>
                    setDiffStyle(
                      event.currentTarget.value === 'unified'
                        ? 'unified'
                        : 'split',
                    )
                  }
                >
                  <option value="split">Split</option>
                  <option value="unified">Unified</option>
                </CompactSelectInput>
              </DiffControl>
              <DiffControl>
                <DiffControlLabel>Line diff</DiffControlLabel>
                <CompactSelectInput
                  value={lineDiffType}
                  onChange={(event) =>
                    updateLineDiffType(event.currentTarget.value)
                  }
                >
                  <option value="word">Word</option>
                  <option value="word-alt">Word alt</option>
                  <option value="char">Character</option>
                  <option value="none">None</option>
                </CompactSelectInput>
              </DiffControl>
              <DiffControl>
                <DiffControlLabel>Overflow</DiffControlLabel>
                <CompactSelectInput
                  value={diffOverflow}
                  onChange={(event) =>
                    setDiffOverflow(
                      event.currentTarget.value === 'wrap' ? 'wrap' : 'scroll',
                    )
                  }
                >
                  <option value="scroll">Scroll</option>
                  <option value="wrap">Wrap</option>
                </CompactSelectInput>
              </DiffControl>
              <Button
                variant="secondary"
                leftIcon={<Copy />}
                onClick={() => void handleCopyLeft()}
              >
                Copy left
              </Button>
              <Button
                variant="secondary"
                leftIcon={<Copy />}
                onClick={() => void handleCopyRight()}
              >
                Copy right
              </Button>
            </DiffControls>
          </DiffHeader>
          <DiffPanel wrap={diffOverflow === 'wrap'}>
            <MultiFileDiff
              oldFile={comparisonFile}
              newFile={currentFile}
              options={diffOptions}
              disableWorkerPool
            />
          </DiffPanel>
        </>
      ) : null}
    </Modal>
  );
}
