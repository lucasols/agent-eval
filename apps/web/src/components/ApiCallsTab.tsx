import type { ApiCallEntry } from '@agent-evals/shared';
import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { styled } from 'vindur';
import { ApiCallRow } from '#src/components/ApiCallRow';
import { EmptyState } from '#src/components/EmptyState';
import { Tooltip } from '#src/components/Tooltip';
import { buildSpanNameWildcardRegex } from '#src/components/TraceTree.helpers';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';

type ApiEndpointCallCount = { key: string; label: string; count: number };

const MAX_ENDPOINT_CHART_ROWS = 8;

const ApiCallsContent = styled.div`
  ${stack({ gap: 14 })}
`;

const ApiCallsToolbar = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 24px;
  column-gap: 10px;
  row-gap: 6px;
  align-items: center;
`;

const ApiCallsCount = styled.span`
  ${monoFont};
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${colors.textDim.var};
  white-space: nowrap;
  grid-column: 1;
  grid-row: 1;
`;

const ApiCallsFilterControls = styled.div`
  ${inline({ justify: 'right', align: 'center', gap: 6 })}
  min-width: 0;
  grid-column: 2;
  grid-row: 1;
`;

const ApiCallSearchButton = styled.button<{ active: boolean }>`
  width: 26px;
  height: 24px;
  padding: 0;
  border: 1px solid ${colors.border.var};
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${colors.bg.var};
  color: ${colors.textDim.var};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    border-color: ${colors.borderStrong.var};
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  &.active {
    border-color: ${colors.accent.alpha(0.45)};
    background: ${colors.accent.alpha(0.1)};
    color: ${colors.text.var};
  }

  & > svg {
    width: 13px;
    height: 13px;
  }
`;

const ApiCallSearchRow = styled.div`
  grid-column: 1 / -1;
  grid-row: 2;
`;

const ApiCallSearchBox = styled.div`
  ${inline({ align: 'center' })}
  width: min(100%, 420px);
  height: 24px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  overflow: hidden;

  &:focus-within {
    border-color: ${colors.accent.alpha(0.55)};
  }
`;

const ApiCallSearchInput = styled.input`
  ${monoFont};
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 8px;
  border: none;
  outline: none;
  background: transparent;
  color: ${colors.text.var};
  font-size: 11px;

  &::placeholder {
    color: ${colors.textDim.var};
  }
`;

const ClearApiCallSearchButton = styled.button`
  width: 24px;
  height: 22px;
  padding: 0;
  border: none;
  border-left: 1px solid ${colors.border.var};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: ${colors.textDim.var};
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: ${colors.surface.var};
    color: ${colors.text.var};
  }

  & > svg {
    width: 12px;
    height: 12px;
  }
`;

const ApiCallsList = styled.div`
  ${stack({ gap: 8 })}
`;

const EndpointChartSection = styled.section`
  ${stack({ gap: 10 })}
  padding-top: 14px;
  border-top: 1px solid ${colors.border.var};
`;

const EndpointChartHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
`;

const EndpointChartTitle = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const EndpointChartMeta = styled.div`
  ${monoFont};
  color: ${colors.textMuted.var};
  font-size: 11px;
`;

const EndpointChartRows = styled.div`
  ${stack({ gap: 10 })}
`;

const EndpointChartRow = styled.div`
  ${stack({ gap: 5 })}
`;

const EndpointChartLabelRow = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
  min-width: 0;
`;

const EndpointChartLabel = styled.span`
  ${monoFont};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${colors.text.var};
  font-size: 11.5px;
`;

const EndpointChartCount = styled.span`
  ${monoFont};
  color: ${colors.textMuted.var};
  font-size: 11px;
  flex-shrink: 0;
`;

const EndpointMeter = styled.meter`
  width: 100%;
  height: 8px;
  border: none;
  border-radius: 999px;
  background: ${colors.surface.var};
  overflow: hidden;

  &::-webkit-meter-bar {
    background: ${colors.surface.var};
    border: none;
    border-radius: 999px;
  }

  &::-webkit-meter-optimum-value {
    background: ${colors.accentDim.var};
    border-radius: 999px;
  }

  &::-moz-meter-bar {
    background: ${colors.accentDim.var};
    border-radius: 999px;
  }
`;

export function ApiCallsTab({ entries }: { entries: ApiCallEntry[] }) {
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchPattern, setSearchPattern] = useState('');
  const searchRegex = buildSpanNameWildcardRegex(searchPattern);
  const filteredEntries =
    searchRegex === null
      ? entries
      : entries.filter((entry) =>
          getApiCallSearchValues(entry).some((value) =>
            searchRegex.test(value),
          ),
        );
  const hasSearch = searchRegex !== null;
  const showSearch = searchVisible || hasSearch;
  const filterLabel = hasSearch
    ? `${String(filteredEntries.length)} of ${String(entries.length)} API calls`
    : `${String(entries.length)} API calls`;

  return (
    <ApiCallsContent>
      <ApiCallSearchToolbar
        filteredLabel={filterLabel}
        searchPattern={searchPattern}
        searchVisible={showSearch}
        onSearchPatternChange={setSearchPattern}
        onSearchVisibleChange={setSearchVisible}
      />
      {filteredEntries.length > 0 ? (
        <>
          <ApiCallsList>
            {filteredEntries.map((entry) => (
              <ApiCallRow
                key={entry.id}
                entry={entry}
              />
            ))}
          </ApiCallsList>
          <ApiEndpointChart entries={filteredEntries} />
        </>
      ) : (
        <EmptyState
          title="No matching API calls"
          description="No API call rows matched the current search pattern."
        />
      )}
    </ApiCallsContent>
  );
}

function ApiCallSearchToolbar({
  filteredLabel,
  searchPattern,
  searchVisible,
  onSearchPatternChange,
  onSearchVisibleChange,
}: {
  filteredLabel: string;
  searchPattern: string;
  searchVisible: boolean;
  onSearchPatternChange: (pattern: string) => void;
  onSearchVisibleChange: (visible: boolean) => void;
}) {
  return (
    <ApiCallsToolbar>
      <ApiCallsCount>{filteredLabel}</ApiCallsCount>
      <ApiCallsFilterControls>
        <Tooltip content="Search API calls">
          <ApiCallSearchButton
            type="button"
            active={searchVisible}
            onClick={() => onSearchVisibleChange(true)}
            aria-label="Search API calls"
            aria-pressed={searchVisible}
          >
            <Search />
          </ApiCallSearchButton>
        </Tooltip>
      </ApiCallsFilterControls>
      {searchVisible ? (
        <ApiCallSearchRow>
          <ApiCallSearchBox>
            <ApiCallSearchInput
              value={searchPattern}
              onChange={(event) =>
                onSearchPatternChange(event.currentTarget.value)
              }
              placeholder="POST api.example.test/* OR fetch-*"
              aria-label="API call wildcard"
              autoFocus
            />
            <Tooltip content="Clear API call search">
              <ClearApiCallSearchButton
                type="button"
                onClick={() => {
                  onSearchPatternChange('');
                  onSearchVisibleChange(false);
                }}
                aria-label="Clear API call search"
              >
                <X />
              </ClearApiCallSearchButton>
            </Tooltip>
          </ApiCallSearchBox>
        </ApiCallSearchRow>
      ) : null}
    </ApiCallsToolbar>
  );
}

function ApiEndpointChart({ entries }: { entries: ApiCallEntry[] }) {
  const endpointCounts = getMostCalledApiEndpoints(entries);
  if (endpointCounts.length === 0) return null;

  const maxCount = endpointCounts[0]?.count ?? 1;

  return (
    <EndpointChartSection>
      <EndpointChartHeader>
        <EndpointChartTitle>Most called endpoints</EndpointChartTitle>
        <EndpointChartMeta>{formatCallCount(entries.length)}</EndpointChartMeta>
      </EndpointChartHeader>
      <EndpointChartRows>
        {endpointCounts.map((endpoint) => (
          <EndpointChartRow key={endpoint.key}>
            <EndpointChartLabelRow>
              <Tooltip content={endpoint.label}>
                <EndpointChartLabel>{endpoint.label}</EndpointChartLabel>
              </Tooltip>
              <EndpointChartCount>
                {formatCallCount(endpoint.count)}
              </EndpointChartCount>
            </EndpointChartLabelRow>
            <EndpointMeter
              min={0}
              max={maxCount}
              value={endpoint.count}
              aria-label={`${endpoint.label}: ${formatCallCount(endpoint.count)}`}
            />
          </EndpointChartRow>
        ))}
      </EndpointChartRows>
    </EndpointChartSection>
  );
}

function getMostCalledApiEndpoints(
  entries: ApiCallEntry[],
): ApiEndpointCallCount[] {
  const counts = new Map<string, ApiEndpointCallCount>();

  for (const entry of entries) {
    const label = getApiEndpointLabel(entry);
    const existing = counts.get(label);
    if (existing !== undefined) {
      counts.set(label, { ...existing, count: existing.count + 1 });
    } else {
      counts.set(label, { key: label, label, count: 1 });
    }
  }

  return [...counts.values()]
    .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_ENDPOINT_CHART_ROWS);
}

function getApiEndpointLabel(entry: ApiCallEntry): string {
  const target = getApiEndpointTarget(entry);
  if (entry.method === null || entry.method.length === 0) return target;
  return `${entry.method.toUpperCase()} ${target}`;
}

function getApiCallSearchValues(entry: ApiCallEntry): string[] {
  return [
    entry.name,
    getApiEndpointTarget(entry),
    getApiEndpointLabel(entry),
    ...(entry.url === null ? [] : [entry.url]),
  ];
}

function getApiEndpointTarget(entry: ApiCallEntry): string {
  if (entry.url !== null && entry.url.length > 0) {
    return summarizeEndpointUrl(entry.url);
  }
  return entry.name;
}

function summarizeEndpointUrl(url: string): string {
  if (URL.canParse(url)) {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  }

  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function formatCallCount(value: number): string {
  return `${String(value)} ${value === 1 ? 'call' : 'calls'}`;
}
