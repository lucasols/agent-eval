import type {
  CaseRow,
  CellValue,
  ColumnDef,
  FileRef,
  RunManifest,
} from '@agent-evals/shared';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { styled } from 'vindur';
import {
  getEffectiveMediaPreviewItems,
  getMediaPreviewItemsForColumns,
  MediaPreviewModal,
  summarizeCellValue,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from '#src/components/FormattedCellValue';
import { LoadingLine } from '#src/components/LoadingState';
import { ManualScoreCell, ScoreCell } from '#src/components/ScoreCell';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
import { useElapsedRunTime } from '#src/hooks/useElapsedRunTime';
import { runStore, selectCase, selectRun } from '#src/stores/runStore';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  kicker,
  monoFont,
  tabularNums,
  transition,
} from '#src/style/helpers';
import { getVisibleRunTableColumns } from '#src/utils/columnVisibility';
import {
  getManualScoreAwareCaseDisplayStatus,
  type DisplayScopedCaseSummary,
} from '#src/utils/evalRuns';
import {
  getEffectiveFileRefFormat,
  getFileLabel,
  isPreviewableFileRefFormat,
} from '#src/utils/fileRefDisplay';
import {
  formatDuration,
  formatNumericCellValue,
  formatTimestamp,
} from '#src/utils/formatters';
import { mergeRunRuntimeColumnDefs } from '#src/utils/runtimeColumnDefs';

export type RunRow = {
  manifest: RunManifest;
  summary: DisplayScopedCaseSummary;
  cases: CaseRow[];
};

type RunScope = { kind: 'eval'; id: string } | { kind: 'folder'; path: string };
type ActiveRunDisplayStatus = 'running' | 'enqueued';

type EvalRunsTableProps = {
  runs: RunRow[];
  columnDefs: ColumnDef[];
  expandedRunIds: Set<string>;
  onToggleExpandedRun: (runId: string) => void;
  runScope: RunScope | null;
  emptyMessage?: string;
  isLoading?: boolean;
};

const Empty = styled.div`
  padding: 30px 24px;
  border: 1px dashed ${colors.border.var};
  border-radius: var(--radius-lg);
  text-align: center;
  color: ${colors.textMuted.var};
  font-size: 12.5px;
`;

function getActiveRunDisplayStatus(run: RunRow): ActiveRunDisplayStatus {
  if (run.cases.some((caseRow) => caseRow.status === 'running')) {
    return 'running';
  }
  if (
    run.cases.length === 0 ||
    run.cases.some((caseRow) => caseRow.status === 'pending')
  ) {
    return 'enqueued';
  }
  return 'running';
}

const TableWrap = styled.div`
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-lg);
  background: ${colors.bg.var};
  overflow: auto;
`;

const Table = styled.table`
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: auto;
`;

const Th = styled.th<{ rightAlign: boolean; indent: boolean }>`
  ${kicker};
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 10px 16px;
  background: ${colors.bgElevated.var};
  box-shadow: inset 0 -1px 0 ${colors.border.var};
  color: ${colors.textMuted.var};
  text-align: left;
  white-space: nowrap;

  &.rightAlign {
    text-align: right;
  }
  &.indent {
    padding-left: 36px;
  }
`;

const ColumnHeaderLabel = styled.span`
  ${ellipsis};
  display: inline-block;
  max-width: 220px;
  vertical-align: bottom;
`;

const RunHeaderRow = styled.tr<{ latest: boolean; active: boolean }>`
  ${transition({ property: 'background' })}
  cursor: pointer;
  border-top: 1px solid ${colors.border.var};
  border-left: 3px solid transparent;
  background: ${colors.bgElevated.var};

  &:first-child {
    border-top: none;
  }

  &:hover {
    background: ${colors.surface.var};
  }

  &.latest {
    background: ${colors.accent.alpha(0.06)};
  }
  &.latest:hover {
    background: ${colors.accent.alpha(0.1)};
  }
  &.active {
    border-left-color: ${colors.accent.var};
  }
`;

const RunHeaderTd = styled.td<{ rightAlign: boolean; mono: boolean }>`
  padding: 12px 16px;
  vertical-align: middle;
  white-space: nowrap;
  color: ${colors.text.var};
  font-size: 12px;

  &.rightAlign {
    text-align: right;
  }
  &.mono {
    ${monoFont};
    ${tabularNums};
    font-size: 11.5px;
    color: ${colors.textMuted.var};
  }
`;

const RunCaseCell = styled.div`
  ${inline({ gap: 8, align: 'center' })}
`;

const ChevronButton = styled.button`
  ${transition({ property: 'color' })}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: ${colors.textMuted.var};

  &:hover {
    color: ${colors.text.var};
  }
`;

const LatestBadge = styled.span`
  ${kicker};
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.accent.alpha(0.12)};
  color: ${colors.accentDim.var};
  font-size: 10px;
  letter-spacing: 0.04em;
  line-height: 1;
`;

const RunIdBadge = styled.span`
  ${monoFont};
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 10.5px;
  line-height: 1;
`;

const BranchBadge = styled.span`
  ${monoFont};
  ${ellipsis};
  max-width: 180px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 10.5px;
  line-height: 1;
`;

const CasesChip = styled.span`
  ${kicker};
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 10px;
  letter-spacing: 0.04em;
  line-height: 1;
`;

const TemporaryBadge = styled.span`
  ${kicker};
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.warning.alpha(0.1)};
  color: ${colors.warning.var};
  font-size: 10px;
  letter-spacing: 0.04em;
  line-height: 1;
`;

const RunTime = styled.span<{ latest: boolean }>`
  font-size: 12.5px;
  font-weight: 500;
  color: ${colors.text.var};
  letter-spacing: -0.005em;

  &.latest {
    color: ${colors.accentDim.var};
  }
`;

const CaseRowEl = styled.tr<{ active: boolean }>`
  ${transition({ property: 'background' })}
  cursor: pointer;
  border-top: 1px solid ${colors.border.var};
  border-left: 3px solid transparent;

  &:hover {
    background: ${colors.bgElevated.var};
  }

  &.active {
    border-left-color: ${colors.accent.var};
  }
`;

const CaseTd = styled.td<{
  rightAlign: boolean;
  mono: boolean;
  indent: boolean;
}>`
  padding: 10px 16px;
  vertical-align: middle;
  white-space: nowrap;
  color: ${colors.text.var};
  font-size: 12px;

  &.rightAlign {
    text-align: right;
  }
  &.mono {
    ${monoFont};
    ${tabularNums};
    font-size: 11.5px;
    color: ${colors.textMuted.var};
  }
  &.indent {
    padding-left: 36px;
  }
`;

const CaseId = styled.div`
  ${ellipsis};
  ${monoFont};
  font-size: 12px;
  color: ${colors.text.var};
  max-width: 260px;
`;

const ColumnText = styled.span`
  ${ellipsis};
  display: block;
  max-width: 320px;
`;

const FilePreviewButton = styled.button`
  ${inline({ align: 'center', gap: 6 })}
  ${ellipsis};
  max-width: 320px;
  padding: 0;
  border: none;
  background: transparent;
  color: ${colors.accentDim.var};
  font: inherit;
  cursor: pointer;

  &:hover {
    color: ${colors.accent.var};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  & svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
  }
`;

const FilePreviewLabel = styled.span`
  ${ellipsis};
  min-width: 0;
`;

const Dim = styled.span`
  color: ${colors.textDim.var};
`;

const RUN_SHORT_ID_PREFIX = /^r/;

const EM_DASH = '—';
const SIMPLE_JSON_PREVIEW_MAX_LENGTH = 96;

const PlaceholderRow = styled.tr`
  border-top: 1px solid ${colors.border.var};
`;

const PlaceholderCell = styled.td`
  padding: 18px;
  text-align: center;
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

function isNumericColumn(c: ColumnDef): boolean {
  return c.kind === 'number';
}

function getSimpleJsonPreview(
  c: ColumnDef,
  value: CellValue,
): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'object' && c.format !== 'json') return undefined;
  if (typeof value === 'object' && isFileRefLike(value)) return undefined;

  const serialized = JSON.stringify(value);
  if (serialized.length > SIMPLE_JSON_PREVIEW_MAX_LENGTH) return undefined;
  return serialized;
}

function isFileRefLike(value: object): boolean {
  if (!('source' in value)) return false;
  return value.source === 'repo' || value.source === 'run';
}

function isFileRef(value: CellValue | undefined): value is FileRef {
  if (typeof value !== 'object' || value === null || !('source' in value)) {
    return false;
  }
  return value.source === 'repo' || value.source === 'run';
}

export function isPreviewableFileRef(
  def: ColumnDef,
  value: CellValue | undefined,
): value is FileRef {
  if (!isFileRef(value)) return false;
  const format = getEffectiveFileRefFormat(def, value);
  return isPreviewableFileRefFormat(format);
}

function formatCellValue(c: ColumnDef, value: CellValue | undefined): string {
  if (value === null || value === undefined) return EM_DASH;
  const simpleJsonPreview = getSimpleJsonPreview(c, value);
  if (simpleJsonPreview !== undefined) return simpleJsonPreview;
  if (Array.isArray(value)) return `JSON Array (len=${String(value.length)})`;
  if (typeof value === 'number') {
    return formatNumericCellValue(c, value);
  }
  return summarizeCellValue(c, value);
}

function getCellTooltipContent(
  value: CellValue | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return undefined;
  if (typeof value === 'object') {
    if ('path' in value && typeof value.path === 'string') {
      return value.path;
    }
    if ('fileName' in value && typeof value.fileName === 'string') {
      return value.fileName;
    }
    return undefined;
  }
  return String(value);
}

function TableHeaderLabel({ column }: { column: ColumnDef }) {
  return (
    <Tooltip content={column.description}>
      <ColumnHeaderLabel>{column.label}</ColumnHeaderLabel>
    </Tooltip>
  );
}

function TableColumnValue({
  column,
  value,
  display,
  tooltipContent,
  mediaPreviewItems = [],
}: {
  column: ColumnDef;
  value: CellValue | undefined;
  display: string;
  tooltipContent: string | undefined;
  mediaPreviewItems?: MediaPreviewItem[];
}) {
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const showTooltip =
    tooltipContent !== undefined &&
    (tooltipContent !== display || tooltipContent.length > 48);

  if (isPreviewableFileRef(column, value)) {
    const label = getFileLabel(value);
    const format = getEffectiveFileRefFormat(column, value);
    if (!isPreviewableFileRefFormat(format)) {
      return <ColumnText>{display}</ColumnText>;
    }
    const previewItem = toMediaPreviewItem({
      def: column,
      fileRef: value,
      format,
    });
    const effectivePreviewItems = getEffectiveMediaPreviewItems(
      previewItem,
      mediaPreviewItems,
    );
    return (
      <>
        <Tooltip content={formatFilePreviewTooltip(label, tooltipContent)}>
          <FilePreviewButton
            type="button"
            aria-label={`Open ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              setActivePreviewId(previewItem.id);
            }}
          >
            <Eye />
            <FilePreviewLabel>{display}</FilePreviewLabel>
          </FilePreviewButton>
        </Tooltip>
        <MediaPreviewModal
          isOpen={activePreviewId !== null}
          items={effectivePreviewItems}
          activeItemId={activePreviewId ?? previewItem.id}
          footer={undefined}
          onChange={setActivePreviewId}
          onClose={() => setActivePreviewId(null)}
        />
      </>
    );
  }

  return (
    <Tooltip content={showTooltip ? tooltipContent : undefined}>
      <ColumnText>{display}</ColumnText>
    </Tooltip>
  );
}

function formatFilePreviewTooltip(
  label: string,
  context: string | undefined,
): string {
  const action = `Open ${label}`;
  if (context === undefined || context === label) return action;
  return `${action}\n${context}`;
}

function averageNumericColumn(cases: CaseRow[], key: string): number | null {
  let sum = 0;
  let count = 0;
  for (const row of cases) {
    const v = row.columns[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  if (count === 0) return null;
  return sum / count;
}

function pickBestScoringCase(
  cases: CaseRow[],
  scoreColumns: ColumnDef[],
): CaseRow | null {
  let best: { row: CaseRow; mean: number } | null = null;
  for (const row of cases) {
    let sum = 0;
    let count = 0;
    for (const col of scoreColumns) {
      const v = row.columns[col.key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
    if (count === 0) continue;
    const mean = sum / count;
    if (best === null || mean > best.mean) best = { row, mean };
  }
  return best?.row ?? null;
}

export function EvalRunsTable({
  runs,
  columnDefs,
  expandedRunIds,
  onToggleExpandedRun,
  runScope,
  emptyMessage = 'Run this eval to see results',
  isLoading = false,
}: EvalRunsTableProps) {
  const { selectedRunId, selectedCaseRunId, selectedCaseId } =
    runStore.useSelectorRC((s) => ({
      selectedRunId: s.selectedRunId,
      selectedCaseRunId: s.selectedCaseRunId,
      selectedCaseId: s.selectedCaseId,
    }));

  if (isLoading && runs.length === 0) {
    return (
      <Empty>
        <LoadingLine>Loading runs</LoadingLine>
      </Empty>
    );
  }

  if (runs.length === 0) {
    return <Empty>{emptyMessage}</Empty>;
  }

  const effectiveColumnDefs = mergeRunRuntimeColumnDefs(columnDefs, runs);
  const manualScoreColumns = effectiveColumnDefs.filter(
    (column) => column.isManualScore === true,
  );
  const { scoreColumns, otherCustomColumns } = getVisibleRunTableColumns({
    columnDefs: effectiveColumnDefs,
    runs,
  });
  const totalCols = 3 + scoreColumns.length + otherCustomColumns.length;

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th
              rightAlign={false}
              indent={false}
            >
              Case
            </Th>
            <Th
              rightAlign={false}
              indent={false}
            >
              Status
            </Th>
            {scoreColumns.map((c) => (
              <Th
                key={c.key}
                rightAlign={true}
                indent={false}
              >
                <TableHeaderLabel column={c} />
              </Th>
            ))}
            <Th
              rightAlign={true}
              indent={false}
            >
              Duration
            </Th>
            {otherCustomColumns.map((c) => (
              <Th
                key={c.key}
                rightAlign={c.align === 'right' || isNumericColumn(c)}
                indent={false}
              >
                <TableHeaderLabel column={c} />
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run, idx) => (
            <RunGroup
              key={run.manifest.id}
              run={run}
              isLatest={idx === 0}
              expanded={expandedRunIds.has(run.manifest.id)}
              onToggle={onToggleExpandedRun}
              scoreColumns={scoreColumns}
              manualScoreColumns={manualScoreColumns}
              otherCustomColumns={otherCustomColumns}
              totalCols={totalCols}
              runScope={runScope}
              selectedRunId={selectedRunId}
              selectedCaseRunId={selectedCaseRunId}
              selectedCaseId={selectedCaseId}
            />
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function RunGroup({
  run,
  isLatest,
  expanded,
  onToggle,
  scoreColumns,
  manualScoreColumns,
  otherCustomColumns,
  totalCols,
  runScope,
  selectedRunId,
  selectedCaseRunId,
  selectedCaseId,
}: {
  run: RunRow;
  isLatest: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  scoreColumns: ColumnDef[];
  manualScoreColumns: ColumnDef[];
  otherCustomColumns: ColumnDef[];
  totalCols: number;
  runScope: RunScope | null;
  selectedRunId: string | null;
  selectedCaseRunId: string | null;
  selectedCaseId: string | null;
}) {
  const { manifest, summary, cases } = run;
  const displayShortId = manifest.shortId.replace(RUN_SHORT_ID_PREFIX, '');
  const durationValue = summary.totalDurationMs;
  const displayStatus =
    summary.status === 'running'
      ? getActiveRunDisplayStatus(run)
      : summary.status;
  const runningElapsedLabel = useElapsedRunTime(
    displayStatus === 'running' ? manifest.startedAt : null,
  );
  const runHasOpenDrawer =
    selectedRunId === manifest.id || selectedCaseRunId === manifest.id;
  const bestPreviewCase = pickBestScoringCase(cases, scoreColumns) ?? cases[0];
  const runHeaderMediaPreviewItems =
    bestPreviewCase === undefined
      ? []
      : getMediaPreviewItemsForColumns(
          otherCustomColumns,
          bestPreviewCase.columns,
        );

  function handleCaseClick(caseKey: string) {
    void selectCase(manifest.id, caseKey);
  }

  function handleChevronClick(e: MouseEvent) {
    e.stopPropagation();
    onToggle(manifest.id);
  }

  return (
    <>
      <RunHeaderRow
        latest={isLatest}
        active={runHasOpenDrawer}
        onClick={() => void selectRun(manifest.id, runScope)}
      >
        <RunHeaderTd
          rightAlign={false}
          mono={false}
        >
          <RunCaseCell>
            <ChevronButton
              type="button"
              onClick={handleChevronClick}
            >
              {expanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </ChevronButton>
            {isLatest ? (
              <LatestBadge>LATEST</LatestBadge>
            ) : (
              <RunIdBadge>#{displayShortId}</RunIdBadge>
            )}
            <RunTime latest={isLatest}>
              {formatTimestamp(manifest.startedAt)}
            </RunTime>
            {manifest.branchName !== null ? (
              <Tooltip content={`Branch ${manifest.branchName}`}>
                <BranchBadge>{manifest.branchName}</BranchBadge>
              </Tooltip>
            ) : null}
            {manifest.temporary ? <TemporaryBadge>TEMP</TemporaryBadge> : null}
            {cases.length > 1 && <CasesChip>{cases.length} cases</CasesChip>}
          </RunCaseCell>
        </RunHeaderTd>
        <RunHeaderTd
          rightAlign={false}
          mono={false}
        >
          <StatusBadge
            status={displayStatus}
            detail={
              displayStatus === 'running'
                ? (runningElapsedLabel ?? undefined)
                : undefined
            }
          />
        </RunHeaderTd>
        {scoreColumns.map((c) => {
          const avg = averageNumericColumn(cases, c.key);
          return (
            <RunHeaderTd
              key={c.key}
              rightAlign={true}
              mono={false}
            >
              <ScoreCell
                score={avg}
                passThreshold={c.passThreshold}
                column={c}
                isAverage={cases.length > 1}
              />
            </RunHeaderTd>
          );
        })}
        <RunHeaderTd
          rightAlign={true}
          mono={true}
        >
          {durationValue !== null && durationValue > 0 ? (
            formatDuration(durationValue)
          ) : (
            <Dim>{EM_DASH}</Dim>
          )}
        </RunHeaderTd>
        {otherCustomColumns.map((c) => {
          if (isNumericColumn(c)) {
            const avg = averageNumericColumn(cases, c.key);
            return (
              <RunHeaderTd
                key={c.key}
                rightAlign={true}
                mono={true}
              >
                {avg === null ? (
                  <Dim>{EM_DASH}</Dim>
                ) : (
                  `${cases.length > 1 ? '~' : ''}${formatNumericCellValue(c, avg)}`
                )}
              </RunHeaderTd>
            );
          }
          if (expanded) {
            return (
              <RunHeaderTd
                key={c.key}
                rightAlign={c.align === 'right'}
                mono={true}
              >
                <Dim>{EM_DASH}</Dim>
              </RunHeaderTd>
            );
          }
          const bestValue =
            bestPreviewCase === undefined
              ? undefined
              : bestPreviewCase.columns[c.key];
          const display = formatCellValue(c, bestValue);
          if (display === EM_DASH) {
            return (
              <RunHeaderTd
                key={c.key}
                rightAlign={c.align === 'right'}
                mono={true}
              >
                <Dim>{display}</Dim>
              </RunHeaderTd>
            );
          }
          const tooltipContent = getCellTooltipContent(bestValue);
          const allCasesTooltip =
            cases.length > 1
              ? cases
                  .map(
                    (row) =>
                      `${row.caseId}: ${formatCellValue(c, row.columns[c.key])}`,
                  )
                  .join('\n')
              : undefined;
          return (
            <RunHeaderTd
              key={c.key}
              rightAlign={c.align === 'right'}
              mono={true}
            >
              <TableColumnValue
                column={c}
                value={bestValue}
                display={display}
                tooltipContent={allCasesTooltip ?? tooltipContent}
                mediaPreviewItems={runHeaderMediaPreviewItems}
              />
            </RunHeaderTd>
          );
        })}
      </RunHeaderRow>
      {expanded &&
        (cases.length === 0 ? (
          <PlaceholderRow>
            <PlaceholderCell colSpan={totalCols}>
              No cases recorded for this run
            </PlaceholderCell>
          </PlaceholderRow>
        ) : (
          cases.map((row) => {
            const rowMediaPreviewItems = getMediaPreviewItemsForColumns(
              otherCustomColumns,
              row.columns,
            );
            return (
              <CaseRowEl
                key={`${row.caseKey ?? row.caseId}-${String(row.trial)}`}
                active={
                  selectedCaseRunId === manifest.id &&
                  selectedCaseId === (row.caseKey ?? row.caseId)
                }
                onClick={() => handleCaseClick(row.caseKey ?? row.caseId)}
              >
                <CaseTd
                  rightAlign={false}
                  mono={false}
                  indent={true}
                >
                  <CaseId>{row.caseId}</CaseId>
                </CaseTd>
                <CaseTd
                  rightAlign={false}
                  mono={false}
                  indent={false}
                >
                  <StatusBadge
                    status={getManualScoreAwareCaseDisplayStatus({
                      caseRow: row,
                      columnDefs: manualScoreColumns,
                    })}
                  />
                </CaseTd>
                {scoreColumns.map((c) => {
                  const v = row.columns[c.key];
                  const score =
                    typeof v === 'number' && Number.isFinite(v) ? v : null;
                  return (
                    <CaseTd
                      key={c.key}
                      rightAlign={true}
                      mono={false}
                      indent={false}
                    >
                      {c.isManualScore === true ? (
                        <ManualScoreCell
                          runId={manifest.id}
                          caseId={row.caseKey ?? row.caseId}
                          column={c}
                          value={score}
                        />
                      ) : (
                        <ScoreCell
                          score={score}
                          passThreshold={c.passThreshold}
                          column={c}
                        />
                      )}
                    </CaseTd>
                  );
                })}
                <CaseTd
                  rightAlign={true}
                  mono={true}
                  indent={false}
                >
                  {row.durationMs === null ? (
                    <Dim>{EM_DASH}</Dim>
                  ) : (
                    formatDuration(row.durationMs)
                  )}
                </CaseTd>
                {otherCustomColumns.map((c) => {
                  const v = row.columns[c.key];
                  const display = formatCellValue(c, v);
                  const tooltipContent = getCellTooltipContent(v);
                  return (
                    <CaseTd
                      key={c.key}
                      rightAlign={c.align === 'right' || isNumericColumn(c)}
                      mono={true}
                      indent={false}
                    >
                      {display === EM_DASH ? (
                        <Dim>{display}</Dim>
                      ) : (
                        <TableColumnValue
                          column={c}
                          value={v}
                          display={display}
                          tooltipContent={tooltipContent}
                          mediaPreviewItems={rowMediaPreviewItems}
                        />
                      )}
                    </CaseTd>
                  );
                })}
              </CaseRowEl>
            );
          })
        ))}
    </>
  );
}
