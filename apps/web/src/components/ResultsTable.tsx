import { styled, css } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { inline, stack, ellipsis, transition, centerContent, monoFont } from '#src/style/helpers.ts';
import { runStore, selectCase } from '../stores/runStore.ts';
import { uiStore, setSortColumn } from '../stores/uiStore.ts';
import { StatusBadge } from './StatusBadge.tsx';
import type { CaseRow } from '@agent-evals/shared';

type BuiltinColumn = {
  key: string;
  label: string;
  render: (row: CaseRow) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
};

// --- Styled components ---

const EmptyState = styled.div`
  padding: 32px;
  text-align: center;
  color: ${colors.textMuted.var};
`;

const ScrollContainer = styled.div`
  overflow: auto;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
`;

const thBase = css`
  padding: 8px 12px;
  border-bottom: 1px solid ${colors.border.var};
  background: ${colors.surface.var};
  position: sticky;
  top: 0;
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  font-size: 12px;
  color: ${colors.textSecondary.var};
  white-space: nowrap;
`;

const Th = styled.th`
  ${thBase}
`;

const TableRow = styled.tr`
  cursor: pointer;
  border-bottom: 1px solid ${colors.border.var};
  ${transition({ property: 'background' })}

  &:hover {
    background: ${colors.surfaceHover.var};
  }
`;

const Td = styled.td`
  padding: 8px 12px;
  white-space: nowrap;
`;

const CostValue = styled.span`
  color: ${colors.cost.var};
  ${monoFont}
`;

// --- Columns ---

const builtinColumns: BuiltinColumn[] = [
  { key: 'caseId', label: 'Case', render: (r) => r.caseId },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'score',
    label: 'Score',
    align: 'right',
    render: (r) => (r.score !== null ? r.score.toFixed(2) : '\u2014'),
  },
  {
    key: 'latencyMs',
    label: 'Latency',
    align: 'right',
    render: (r) => (r.latencyMs !== null ? `${(r.latencyMs / 1000).toFixed(1)}s` : '\u2014'),
  },
  {
    key: 'costUsd',
    label: 'Cost',
    align: 'right',
    render: (r) => {
      if (r.costUsd === null) return '\u2014';
      return (
        <CostValue>
          ${r.costUsd < 0.01 ? r.costUsd.toFixed(4) : r.costUsd.toFixed(2)}
        </CostValue>
      );
    },
  },
  {
    key: 'cacheStatus',
    label: 'Cache',
    render: (r) => r.cacheStatus ?? '\u2014',
  },
];

// --- Component ---

export function ResultsTable() {
  const { currentRun } = runStore.useSelectorRC((s) => ({
    currentRun: s.currentRun,
  }));
  const { sortColumn, sortDirection, columnVisibility } = uiStore.useState();

  if (!currentRun) {
    return <EmptyState>Run evals to see results</EmptyState>;
  }

  const customColumnKeys = new Set<string>();
  for (const row of currentRun.cases) {
    for (const key of Object.keys(row.columns)) {
      customColumnKeys.add(key);
    }
  }

  const visibleBuiltins = builtinColumns.filter(
    (c) => columnVisibility[c.key] !== false,
  );

  const visibleCustomKeys = [...customColumnKeys].filter(
    (k) => columnVisibility[k] !== false,
  );

  let sortedCases = [...currentRun.cases];
  if (sortColumn) {
    sortedCases.sort((a, b) => {
      const aVal = getColumnValue(a, sortColumn);
      const bVal = getColumnValue(b, sortColumn);
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDirection === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }

  return (
    <ScrollContainer>
      <Table>
        <thead>
          <tr>
            {visibleBuiltins.map((col) => (
              <Th
                key={col.key}
                onClick={() => setSortColumn(col.key)}
                css={`text-align: ${col.align ?? 'left'};`}
              >
                {col.label}
                {sortColumn === col.key ? (sortDirection === 'asc' ? ' \u25b2' : ' \u25bc') : ''}
              </Th>
            ))}
            {visibleCustomKeys.map((key) => (
              <Th
                key={key}
                onClick={() => setSortColumn(key)}
                css="text-align: left;"
              >
                {key}
                {sortColumn === key ? (sortDirection === 'asc' ? ' \u25b2' : ' \u25bc') : ''}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedCases.map((row) => (
            <TableRow
              key={`${row.caseId}-${String(row.trial)}`}
              onClick={() => void selectCase(row.caseId)}
            >
              {visibleBuiltins.map((col) => (
                <Td
                  key={col.key}
                  css={`text-align: ${col.align ?? 'left'};`}
                >
                  {col.render(row)}
                </Td>
              ))}
              {visibleCustomKeys.map((key) => (
                <Td key={key}>
                  {row.columns[key] !== null && row.columns[key] !== undefined
                    ? String(row.columns[key])
                    : '\u2014'}
                </Td>
              ))}
            </TableRow>
          ))}
        </tbody>
      </Table>
    </ScrollContainer>
  );
}

function getColumnValue(
  row: CaseRow,
  key: string,
): string | number | boolean | null {
  switch (key) {
    case 'caseId':
      return row.caseId;
    case 'status':
      return row.status;
    case 'score':
      return row.score;
    case 'latencyMs':
      return row.latencyMs;
    case 'costUsd':
      return row.costUsd;
    case 'cacheStatus':
      return row.cacheStatus;
    default:
      return row.columns[key] ?? null;
  }
}
