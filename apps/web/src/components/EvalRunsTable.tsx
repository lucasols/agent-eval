import type {
  CaseRow,
  CellValue,
  ColumnDef,
  RunManifest,
  ScopedCaseSummary,
} from '@agent-evals/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type MouseEvent } from 'react';
import { styled } from 'vindur';
import { summarizeCellValue } from '#src/components/FormattedCellValue';
import { ManualScoreCell, ScoreCell } from '#src/components/ScoreCell';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
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
import {
  formatDuration,
  formatNumericCellValue,
  formatTimestamp,
} from '#src/utils/formatters';

export type RunRow = {
  manifest: RunManifest;
  summary: ScopedCaseSummary;
  cases: CaseRow[];
};

type RunScope = { kind: 'eval'; id: string } | { kind: 'folder'; path: string };

type EvalRunsTableProps = {
  runs: RunRow[];
  columnDefs: ColumnDef[];
  expandedRunIds: Set<string>;
  onToggleExpandedRun: (runId: string) => void;
  fillHeight: boolean;
  runScope: RunScope | null;
};

const Empty = styled.div`
  padding: 30px 24px;
  border: 1px dashed ${colors.border.var};
  border-radius: var(--radius-lg);
  text-align: center;
  color: ${colors.textMuted.var};
  font-size: 12.5px;
`;

const TableWrap = styled.div<{ fillHeight: boolean }>`
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-lg);
  background: ${colors.bg.var};
  overflow: auto;

  &.fillHeight {
    flex: 1;
    min-height: 0;
  }
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

const Dim = styled.span`
  color: ${colors.textDim.var};
`;

const RUN_SHORT_ID_PREFIX = /^r/;

const EM_DASH = '—';

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

function formatCellValue(c: ColumnDef, value: CellValue | undefined): string {
  if (value === null || value === undefined) return EM_DASH;
  if (Array.isArray(value)) return `${String(value.length)} block(s)`;
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

export function EvalRunsTable({
  runs,
  columnDefs,
  expandedRunIds,
  onToggleExpandedRun,
  fillHeight,
  runScope,
}: EvalRunsTableProps) {
  const { selectedRunId, selectedCaseRunId, selectedCaseId } =
    runStore.useSelectorRC((s) => ({
      selectedRunId: s.selectedRunId,
      selectedCaseRunId: s.selectedCaseRunId,
      selectedCaseId: s.selectedCaseId,
    }));

  if (runs.length === 0) {
    return <Empty>Run this eval to see results</Empty>;
  }

  const scoreColumns = columnDefs.filter((c) => c.isScore === true);
  const otherCustomColumns = columnDefs.filter(
    (c) =>
      !c.hideInTable &&
      c.isScore !== true &&
      runs.some((r) => r.cases.some((row) => row.columns[c.key] !== undefined)),
  );
  const totalCols = 3 + scoreColumns.length + otherCustomColumns.length;

  return (
    <TableWrap fillHeight={fillHeight}>
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
                {c.label}
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
                {c.label}
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
  const runHasOpenDrawer =
    selectedRunId === manifest.id || selectedCaseRunId === manifest.id;

  function handleCaseClick(caseId: string) {
    void selectCase(manifest.id, caseId);
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
            {cases.length > 1 && <CasesChip>{cases.length} cases</CasesChip>}
          </RunCaseCell>
        </RunHeaderTd>
        <RunHeaderTd
          rightAlign={false}
          mono={false}
        >
          <StatusBadge status={summary.status} />
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
          const avg = isNumericColumn(c)
            ? averageNumericColumn(cases, c.key)
            : null;
          return (
            <RunHeaderTd
              key={c.key}
              rightAlign={c.align === 'right' || isNumericColumn(c)}
              mono={true}
            >
              {avg === null ? (
                <Dim>{EM_DASH}</Dim>
              ) : (
                formatNumericCellValue(c, avg)
              )}
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
          cases.map((row) => (
            <CaseRowEl
              key={`${row.caseId}-${String(row.trial)}`}
              active={
                selectedCaseRunId === manifest.id &&
                selectedCaseId === row.caseId
              }
              onClick={() => handleCaseClick(row.caseId)}
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
                <StatusBadge status={row.status} />
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
                        caseId={row.caseId}
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
                {row.latencyMs === null ? (
                  <Dim>{EM_DASH}</Dim>
                ) : (
                  formatDuration(row.latencyMs)
                )}
              </CaseTd>
              {otherCustomColumns.map((c) => {
                const v = row.columns[c.key];
                const display = formatCellValue(c, v);
                const tooltipContent = getCellTooltipContent(v);
                const showTooltip =
                  tooltipContent !== undefined &&
                  (tooltipContent !== display || tooltipContent.length > 48);
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
                      <Tooltip
                        content={showTooltip ? tooltipContent : undefined}
                      >
                        <ColumnText>{display}</ColumnText>
                      </Tooltip>
                    )}
                  </CaseTd>
                );
              })}
            </CaseRowEl>
          ))
        ))}
    </>
  );
}
