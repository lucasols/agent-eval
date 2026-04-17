import { styled } from 'vindur';
import type { CaseRow, CellValue, ColumnDef, RunManifest, RunSummary } from '@agent-evals/shared';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  monoFont,
  tabularNums,
  transition,
} from '#src/style/helpers';
import { selectCase, selectRun } from '../stores/runStore.ts';
import { StatusBadge, StatusDot } from './StatusBadge.tsx';
import {
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
  formatTimestamp,
} from '../utils/formatters.ts';

export type RunRow = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
};

type EvalRunsTableProps = {
  runs: RunRow[];
  columnDefs: ColumnDef[];
};

const Empty = styled.div`
  padding: 32px 24px;
  border: 1px dashed ${colors.border.var};
  text-align: center;
  color: ${colors.textDim.var};
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  background: transparent;
`;

const TableWrap = styled.div`
  border: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.alpha(0.4)};
  overflow: hidden;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: auto;
`;

const Th = styled.th<{ rightAlign: boolean; indent: boolean }>`
  padding: 10px 14px;
  background: ${colors.surface.var};
  border-bottom: 1px solid ${colors.border.var};
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: ${colors.textDim.var};
  text-align: left;
  white-space: nowrap;

  &.rightAlign {
    text-align: right;
  }
  &.indent {
    padding-left: 32px;
  }
`;

const RunHeaderRow = styled.tr`
  border-top: 1px solid ${colors.borderStrong.var};
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.surface.var};

  &:first-child {
    border-top: none;
  }
`;

const RunHeaderCell = styled.td`
  padding: 0;
`;

const RunHeaderBar = styled.button`
  ${inline({ gap: 20, align: 'center' })}
  ${transition({ property: 'background, border-color' })}
  width: 100%;
  padding: 12px 16px 12px 14px;
  flex-wrap: wrap;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;

  &:hover {
    background: ${colors.surfaceHover.var};
    border-left-color: ${colors.accent.var};
  }
`;

const RunTag = styled.span`
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: ${colors.accentInk.var};
  background: ${colors.accent.var};
  padding: 4px 8px 4px 10px;
`;

const RunTime = styled.span`
  ${monoFont}
  font-size: 12px;
  font-weight: 600;
  color: ${colors.text.var};
  ${tabularNums}
`;

const RunStat = styled.div`
  ${inline({ gap: 8, align: 'center' })}
  font-size: 11px;
  color: ${colors.textMuted.var};
  ${tabularNums}
`;

const RunStatLabel = styled.span`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: ${colors.textDim.var};
`;

const RunStatValue = styled.span<{ accent: boolean; cost: boolean }>`
  ${monoFont}
  font-size: 12px;
  font-weight: 600;
  color: ${colors.text.var};

  &.accent {
    color: ${colors.accent.var};
  }
  &.cost {
    color: ${colors.cost.var};
  }
`;

const CaseRowEl = styled.tr`
  ${transition({ property: 'background' })}
  cursor: pointer;
  border-bottom: 1px solid ${colors.border.alpha(0.4)};

  &:hover {
    background: ${colors.surfaceHover.alpha(0.5)};
  }

  &:hover td:first-child {
    color: ${colors.accent.var};
  }
`;

const CaseTd = styled.td<{ rightAlign: boolean; mono: boolean; indent: boolean }>`
  padding: 10px 14px;
  vertical-align: middle;
  white-space: nowrap;
  color: ${colors.text.var};
  ${transition({ property: 'color' })}

  &.rightAlign {
    text-align: right;
  }
  &.mono {
    ${monoFont}
    ${tabularNums}
    font-size: 11.5px;
  }
  &.indent {
    padding-left: 32px;
  }
`;

const CaseId = styled.div`
  ${ellipsis}
  ${monoFont}
  font-size: 12px;
  font-weight: 500;
  color: ${colors.text.var};
  max-width: 260px;
  ${transition({ property: 'color' })}
`;

const CostText = styled.span`
  color: ${colors.cost.var};
`;

const Dim = styled.span`
  color: ${colors.textDim.var};
`;

const PlaceholderRow = styled.tr`
  border-bottom: 1px solid ${colors.border.alpha(0.4)};
`;

const PlaceholderCell = styled.td`
  padding: 18px;
  text-align: center;
  font-size: 10px;
  color: ${colors.textDim.var};
  text-transform: uppercase;
  letter-spacing: 0.18em;
`;

function isNumericColumn(c: ColumnDef): boolean {
  return c.kind === 'number';
}

function formatCellValue(c: ColumnDef, value: CellValue | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  if (Array.isArray(value)) return `${String(value.length)} block(s)`;
  if (typeof value === 'number') {
    if (c.format === 'usd') return formatCost(value);
    if (c.format === 'duration') return formatDuration(value);
    if (c.format === 'percent') return formatPercent(value);
    if (c.isScore) return formatScore(value);
    return String(value);
  }
  return String(value);
}

export function EvalRunsTable({ runs, columnDefs }: EvalRunsTableProps) {
  if (runs.length === 0) {
    return <Empty>Run this eval to see results</Empty>;
  }

  const customColumns = columnDefs.filter(
    (c) =>
      !c.primary &&
      runs.some((r) => r.cases.some((row) => row.columns[c.key] !== undefined)),
  );
  const totalCols = 5 + customColumns.length;

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th rightAlign={false} indent={true}>
              Case
            </Th>
            <Th rightAlign={false} indent={false}>
              Status
            </Th>
            <Th rightAlign={true} indent={false}>
              Score
            </Th>
            <Th rightAlign={true} indent={false}>
              Latency
            </Th>
            <Th rightAlign={true} indent={false}>
              Cost
            </Th>
            {customColumns.map((c) => (
              <Th
                key={c.key}
                rightAlign={c.align === 'right'}
                indent={false}
              >
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunGroup
              key={run.manifest.id}
              run={run}
              customColumns={customColumns}
              totalCols={totalCols}
            />
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function RunGroup({
  run,
  customColumns,
  totalCols,
}: {
  run: RunRow;
  customColumns: ColumnDef[];
  totalCols: number;
}) {
  const { manifest, summary, cases } = run;
  const passFail =
    summary.totalCases === 0
      ? '\u2014'
      : `${summary.passedCases}/${summary.totalCases}`;

  function handleCaseClick(caseId: string) {
    void selectCase(manifest.id, caseId);
  }

  return (
    <>
      <RunHeaderRow>
        <RunHeaderCell colSpan={totalCols}>
          <RunHeaderBar type="button" onClick={() => void selectRun(manifest.id)}>
            <RunTag>Run</RunTag>
            <RunTime>{formatTimestamp(manifest.startedAt)}</RunTime>
            <StatusBadge status={manifest.status} />
            <RunStat>
              <RunStatLabel>Cases</RunStatLabel>
              <RunStatValue accent={false} cost={false}>
                {passFail}
              </RunStatValue>
            </RunStat>
            <RunStat>
              <RunStatLabel>Duration</RunStatLabel>
              <RunStatValue accent={false} cost={false}>
                {formatDuration(summary.totalDurationMs)}
              </RunStatValue>
            </RunStat>
            <RunStat>
              <RunStatLabel>Cost</RunStatLabel>
              <RunStatValue accent={false} cost={true}>
                {formatCost(summary.cost.totalUsd)}
              </RunStatValue>
            </RunStat>
            <RunStat>
              <RunStatLabel>Avg</RunStatLabel>
              <RunStatValue accent={true} cost={false}>
                {formatScore(summary.averageScore)}
              </RunStatValue>
            </RunStat>
          </RunHeaderBar>
        </RunHeaderCell>
      </RunHeaderRow>
      {cases.length === 0 ? (
        <PlaceholderRow>
          <PlaceholderCell colSpan={totalCols}>
            No cases recorded for this run
          </PlaceholderCell>
        </PlaceholderRow>
      ) : (
        cases.map((row) => (
          <CaseRowEl
            key={`${row.caseId}-${String(row.trial)}`}
            onClick={() => handleCaseClick(row.caseId)}
          >
            <CaseTd rightAlign={false} mono={false} indent={true}>
              <CaseId>{row.caseId}</CaseId>
            </CaseTd>
            <CaseTd rightAlign={false} mono={false} indent={false}>
              <StatusDot status={row.status} />
            </CaseTd>
            <CaseTd rightAlign={true} mono={true} indent={false}>
              {row.score === null ? (
                <Dim>{'\u2014'}</Dim>
              ) : (
                formatScore(row.score)
              )}
            </CaseTd>
            <CaseTd rightAlign={true} mono={true} indent={false}>
              {row.latencyMs === null ? (
                <Dim>{'\u2014'}</Dim>
              ) : (
                formatDuration(row.latencyMs)
              )}
            </CaseTd>
            <CaseTd rightAlign={true} mono={true} indent={false}>
              {row.costUsd === null ? (
                <Dim>{'\u2014'}</Dim>
              ) : (
                <CostText>{formatCost(row.costUsd)}</CostText>
              )}
            </CaseTd>
            {customColumns.map((c) => {
              const v = row.columns[c.key];
              const display = formatCellValue(c, v);
              return (
                <CaseTd
                  key={c.key}
                  rightAlign={c.align === 'right' || isNumericColumn(c)}
                  mono={true}
                  indent={false}
                >
                  {display === '\u2014' ? <Dim>{display}</Dim> : display}
                </CaseTd>
              );
            })}
          </CaseRowEl>
        ))
      )}
    </>
  );
}
