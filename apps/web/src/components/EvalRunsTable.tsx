import { styled } from 'vindur';
import type { CaseRow, ColumnDef, RunManifest, RunSummary } from '@agent-evals/shared';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  monoFont,
  tabularNums,
  transition,
} from '#src/style/helpers';
import { selectCase } from '../stores/runStore.ts';
import { StatusBadge, StatusDot } from './StatusBadge.tsx';
import {
  formatCost,
  formatDuration,
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
  padding: 24px;
  border: 1px dashed ${colors.border.var};
  border-radius: var(--radius-md);
  text-align: center;
  color: ${colors.textDim.var};
  font-size: 12px;
  background: ${colors.bgElevated.var};
`;

const TableWrap = styled.div`
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  background: ${colors.bgElevated.var};
  overflow: hidden;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  table-layout: auto;
`;

const Th = styled.th<{ rightAlign: boolean; indent: boolean }>`
  padding: 8px 12px;
  background: ${colors.surface.var};
  border-bottom: 1px solid ${colors.border.var};
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${colors.textDim.var};
  text-align: left;
  white-space: nowrap;

  &.rightAlign {
    text-align: right;
  }
  &.indent {
    padding-left: 28px;
  }
`;

const RunHeaderRow = styled.tr`
  border-top: 1px solid ${colors.border.var};
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.surface.var};

  &:first-child {
    border-top: none;
  }
`;

const RunHeaderCell = styled.td`
  padding: 0;
`;

const RunHeaderBar = styled.div`
  ${inline({ gap: 18, align: 'center' })}
  padding: 10px 14px;
  flex-wrap: wrap;
`;

const RunTag = styled.span`
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${colors.accent.var};
  padding: 2px 8px;
  border: 1px solid ${colors.accent.alpha(0.35)};
  border-radius: 3px;
  background: ${colors.accent.alpha(0.08)};
`;

const RunTime = styled.span`
  font-size: 12.5px;
  font-weight: 500;
  color: ${colors.text.var};
  ${tabularNums}
`;

const RunStat = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  font-size: 12px;
  color: ${colors.textMuted.var};
  ${tabularNums}
`;

const RunStatLabel = styled.span`
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${colors.textDim.var};
`;

const RunStatValue = styled.span<{ accent: boolean; cost: boolean }>`
  ${monoFont}
  font-size: 12px;
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
  border-bottom: 1px solid ${colors.border.alpha(0.5)};

  &:hover {
    background: ${colors.surfaceHover.var};
  }
`;

const CaseTd = styled.td<{ rightAlign: boolean; mono: boolean; indent: boolean }>`
  padding: 8px 12px;
  vertical-align: middle;
  white-space: nowrap;
  color: ${colors.text.var};

  &.rightAlign {
    text-align: right;
  }
  &.mono {
    ${monoFont}
    ${tabularNums}
    font-size: 12px;
  }
  &.indent {
    padding-left: 28px;
  }
`;

const CaseId = styled.div`
  ${ellipsis}
  ${monoFont}
  font-size: 12px;
  color: ${colors.text.var};
  max-width: 240px;
`;

const CostText = styled.span`
  color: ${colors.cost.var};
`;

const Dim = styled.span`
  color: ${colors.textDim.var};
`;

const PlaceholderRow = styled.tr`
  border-bottom: 1px solid ${colors.border.alpha(0.5)};
`;

const PlaceholderCell = styled.td`
  padding: 14px;
  text-align: center;
  font-size: 12px;
  color: ${colors.textDim.var};
  font-style: italic;
`;

export function EvalRunsTable({ runs, columnDefs }: EvalRunsTableProps) {
  if (runs.length === 0) {
    return <Empty>Run this eval to see results.</Empty>;
  }

  const customColumns = columnDefs.filter((c) =>
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
          <RunHeaderBar>
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
            No cases recorded for this run.
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
              const display =
                v === null || v === undefined ? '\u2014' : String(v);
              return (
                <CaseTd
                  key={c.key}
                  rightAlign={c.align === 'right'}
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
