import type {
  CaseRow,
  CellValue,
  ColumnDef,
  RunManifest,
  RunSummary,
} from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import {
  ellipsis,
  inline,
  kicker,
  monoFont,
  tabularNums,
  transition,
} from '#src/style/helpers';
import { selectCase, selectRun } from '../stores/runStore.ts';
import {
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
  formatTimestamp,
} from '../utils/formatters.ts';
import { StatusBadge, StatusDot } from './StatusBadge.tsx';

export type RunRow = {
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
};

type EvalRunsTableProps = { runs: RunRow[]; columnDefs: ColumnDef[] };

const Empty = styled.div`
  padding: 30px 24px;
  border: 1px dashed ${colors.border.var};
  border-radius: var(--radius-lg);
  text-align: center;
  color: ${colors.textMuted.var};
  font-size: 12.5px;
`;

const TableWrap = styled.div`
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-lg);
  background: ${colors.bg.var};
  overflow: hidden;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: auto;
`;

const Th = styled.th<{ rightAlign: boolean; indent: boolean }>`
  ${kicker};
  padding: 10px 16px;
  background: ${colors.bgElevated.var};
  border-bottom: 1px solid ${colors.border.var};
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

const RunHeaderRow = styled.tr<{ latest: boolean }>`
  border-top: 1px solid ${colors.border.var};

  &:first-child {
    border-top: none;
  }

  &.latest {
    background: ${colors.accent.alpha(0.03)};
  }
`;

const RunHeaderCell = styled.td`
  padding: 0;
`;

const RunHeaderBar = styled.button`
  ${inline({ gap: 16, align: 'center' })}
  ${transition({ property: 'background' })}
  width: 100%;
  padding: 12px 20px;
  flex-wrap: wrap;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;

  &:hover {
    background: ${colors.bgElevated.var};
  }
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

const RunStat = styled.div`
  ${inline({ gap: 6, align: 'center' })}
  font-size: 11.5px;
  color: ${colors.textMuted.var};
  ${tabularNums};
`;

const RunStatLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const RunStatValue = styled.span<{ accent: boolean; cost: boolean }>`
  ${monoFont};
  ${tabularNums};
  font-size: 12px;
  font-weight: 500;
  color: ${colors.text.var};

  &.accent {
    color: ${colors.accentDim.var};
  }
  &.cost {
    color: ${colors.cost.var};
  }
`;

const CaseRowEl = styled.tr<{ active: boolean }>`
  ${transition({ property: 'background' })}
  cursor: pointer;
  border-top: 1px solid ${colors.border.var};

  &:hover {
    background: ${colors.bgElevated.var};
  }

  &.active {
    background: ${colors.surface.var};
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

const ScoreBar = styled.span`
  display: inline-block;
  width: 40px;
  height: 3px;
  border-radius: 4px;
  background: ${colors.surface.var};
  position: relative;
  overflow: hidden;
  margin-right: 8px;
  vertical-align: middle;
`;

const ScoreBarFill = styled.span<{
  pass: boolean;
  partial: boolean;
  fail: boolean;
}>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  background: ${colors.textDim.var};

  &.pass {
    background: ${colors.success.var};
  }
  &.partial {
    background: ${colors.warning.var};
  }
  &.fail {
    background: ${colors.error.var};
  }
`;

const ScoreText = styled.span`
  ${monoFont};
  ${tabularNums};
  font-size: 12px;
  color: ${colors.text.var};
  font-weight: 500;
`;

const CostText = styled.span`
  color: ${colors.cost.var};
`;

const Dim = styled.span`
  color: ${colors.textDim.var};
`;

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
            <Th
              rightAlign={false}
              indent={true}
            >
              Case
            </Th>
            <Th
              rightAlign={false}
              indent={false}
            >
              Status
            </Th>
            <Th
              rightAlign={true}
              indent={false}
            >
              Score
            </Th>
            <Th
              rightAlign={true}
              indent={false}
            >
              Latency
            </Th>
            <Th
              rightAlign={true}
              indent={false}
            >
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
          {runs.map((run, idx) => (
            <RunGroup
              key={run.manifest.id}
              run={run}
              isLatest={idx === 0}
              customColumns={customColumns}
              totalCols={totalCols}
            />
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function ScoreCell({ score }: { score: number | null }) {
  if (score === null) return <Dim>{'\u2014'}</Dim>;
  const tone: 'pass' | 'partial' | 'fail' =
    score >= 0.7 ? 'pass' : score >= 0.4 ? 'partial' : 'fail';
  return (
    <>
      <ScoreBar>
        <ScoreBarFill
          pass={tone === 'pass'}
          partial={tone === 'partial'}
          fail={tone === 'fail'}
          style={{ width: `${score * 100}%` }}
        />
      </ScoreBar>
      <ScoreText>{formatScore(score)}</ScoreText>
    </>
  );
}

function RunGroup({
  run,
  isLatest,
  customColumns,
  totalCols,
}: {
  run: RunRow;
  isLatest: boolean;
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
      <RunHeaderRow latest={isLatest}>
        <RunHeaderCell colSpan={totalCols}>
          <RunHeaderBar
            type="button"
            onClick={() => void selectRun(manifest.id)}
          >
            <RunTime latest={isLatest}>
              {formatTimestamp(manifest.startedAt)}
            </RunTime>
            <StatusBadge status={manifest.status} />
            <RunStat>
              <RunStatLabel>Cases</RunStatLabel>
              <RunStatValue
                accent={false}
                cost={false}
              >
                {passFail}
              </RunStatValue>
            </RunStat>
            <RunStat>
              <RunStatLabel>Duration</RunStatLabel>
              <RunStatValue
                accent={false}
                cost={false}
              >
                {formatDuration(summary.totalDurationMs)}
              </RunStatValue>
            </RunStat>
            <RunStat>
              <RunStatLabel>Cost</RunStatLabel>
              <RunStatValue
                accent={false}
                cost={true}
              >
                {formatCost(summary.cost.totalUsd)}
              </RunStatValue>
            </RunStat>
            <RunStat>
              <RunStatLabel>Avg</RunStatLabel>
              <RunStatValue
                accent={true}
                cost={false}
              >
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
            active={false}
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
              <StatusDot status={row.status} />
            </CaseTd>
            <CaseTd
              rightAlign={true}
              mono={false}
              indent={false}
            >
              <ScoreCell score={row.score} />
            </CaseTd>
            <CaseTd
              rightAlign={true}
              mono={true}
              indent={false}
            >
              {row.latencyMs === null ? (
                <Dim>{'\u2014'}</Dim>
              ) : (
                formatDuration(row.latencyMs)
              )}
            </CaseTd>
            <CaseTd
              rightAlign={true}
              mono={true}
              indent={false}
            >
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
