import type { RunLogEntry, RunLogPhase } from '@agent-evals/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import {
  formatShortStackLocation,
  StackTraceViewer,
} from '#src/components/StackTraceViewer';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';

const LogToolbar = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 10 })}
  margin-bottom: 12px;
`;

const LogCount = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const LogPhaseSelect = styled.select`
  height: 28px;
  min-width: 150px;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bg.var};
  color: ${colors.text.var};
  padding: 0 26px 0 9px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;

  &:hover {
    border-color: ${colors.borderStrong.var};
  }

  &:focus {
    outline: 2px solid ${colors.accent.alpha(0.25)};
    outline-offset: 1px;
    border-color: ${colors.accent.alpha(0.65)};
  }
`;

const LogList = styled.div`
  ${stack({ gap: 8 })}
`;

const Card = styled.div`
  ${stack({ gap: 0 })}
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: hidden;
`;

const HeaderRow = styled.div`
  ${inline({ gap: 4, align: 'center' })}
  width: 100%;
  min-width: 0;
`;

const HeaderButton = styled.button`
  ${inline({ gap: 10, align: 'center' })}
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  padding: 10px 14px;
  text-align: left;
  cursor: pointer;
  color: ${colors.text.var};

  &:hover {
    background: ${colors.surface.var};
  }
`;

const Caret = styled.span`
  ${inline({ align: 'center' })}
  color: ${colors.textMuted.var};
  flex-shrink: 0;
`;

const LogMeta = styled.div`
  ${inline({ gap: 8, align: 'center' })}
  margin-left: auto;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const LogTime = styled.span`
  ${monoFont};
  font-size: 10.5px;
  color: ${colors.textMuted.var};
`;

const LogLevel = styled.span<{ info: boolean; warn: boolean; error: boolean }>`
  ${kicker};
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: ${colors.surface.var};
  color: ${colors.textMuted.var};
  font-size: 9.5px;
  line-height: 1.2;
  flex-shrink: 0;

  &.info {
    background: ${colors.accent.alpha(0.12)};
    color: ${colors.accentDim.var};
  }
  &.warn {
    background: ${colors.warning.alpha(0.12)};
    color: ${colors.warning.var};
  }
  &.error {
    background: ${colors.error.alpha(0.12)};
    color: ${colors.error.var};
  }
`;

const LogPhaseTag = styled.span`
  ${kicker};
  font-size: 9.5px;
  color: ${colors.textMuted.var};
  flex-shrink: 0;
`;

const LocationTag = styled.span`
  ${monoFont};
  font-size: 10.5px;
  color: ${colors.textMuted.var};
  flex-shrink: 0;
`;

const LogPreview = styled.span`
  ${monoFont};
  flex: 1 1 140px;
  font-size: 12px;
  color: ${colors.text.var};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const LogMessage = styled.pre`
  ${monoFont};
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11.5px;
  line-height: 1.55;
  color: ${colors.text.var};
`;

const LogJsonSection = styled.div`
  ${stack({ gap: 8 })}
`;

const SectionLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const Body = styled.div`
  ${stack({ gap: 10 })}
  padding: 12px 14px;
  border-top: 1px solid ${colors.border.var};
`;

const DetailRow = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  flex-wrap: wrap;
  font-size: 11px;
  color: ${colors.textMuted.var};
`;

const DetailItem = styled.span`
  ${inline({ gap: 4, align: 'center' })}
`;

const LocationDetailItem = styled.span`
  ${inline({ gap: 4, align: 'center' })}
  min-width: 0;
  flex: 1 1 100%;
`;

const DetailLabel = styled.span`
  ${kicker};
  font-size: 9.5px;
  color: ${colors.textDim.var};
`;

const DetailValue = styled.span`
  ${monoFont};
  font-size: 11px;
  color: ${colors.text.var};
`;

const LocationDetailValue = styled.div`
  min-width: 0;
  flex: 1 1 auto;
`;

const TruncatedTag = styled.span`
  ${kicker};
  color: ${colors.warning.var};
  font-size: 9.5px;
  flex-shrink: 0;
`;

const LOG_PHASE_LABELS: Record<RunLogPhase, string> = {
  eval: 'Execute',
  derive: 'Derive',
  outputsSchema: 'Outputs schema',
  scorer: 'Scorer',
};
const collapsedPreviewMaxChars = 220;

export function getLogPhases(logs: { phase: RunLogPhase }[]): RunLogPhase[] {
  const order: RunLogPhase[] = ['eval', 'derive', 'outputsSchema', 'scorer'];
  const present = new Set(logs.map((entry) => entry.phase));
  return order.filter((phase) => present.has(phase));
}

export function CaseRunLogs({
  logs,
  phases,
  selectedPhase,
  onPhaseChange,
  workspaceRoot,
}: {
  logs: RunLogEntry[];
  phases: RunLogPhase[];
  selectedPhase: RunLogPhase | 'all';
  onPhaseChange: (phase: RunLogPhase | 'all') => void;
  workspaceRoot: string;
}) {
  return (
    <>
      <LogToolbar>
        <LogCount>{String(logs.length)} entries</LogCount>
        <LogPhaseSelect
          value={selectedPhase}
          onChange={(event) => {
            onPhaseChange(parseLogPhaseFilter(event.currentTarget.value));
          }}
          aria-label="Filter logs by phase"
        >
          <option value="all">All phases</option>
          {phases.map((phase) => (
            <option
              key={phase}
              value={phase}
            >
              {LOG_PHASE_LABELS[phase]}
            </option>
          ))}
        </LogPhaseSelect>
      </LogToolbar>
      <LogList>
        {logs.map((entry, index) => (
          <LogEntry
            key={`${entry.timestamp}-${String(index)}`}
            entry={entry}
            workspaceRoot={workspaceRoot}
          />
        ))}
      </LogList>
    </>
  );
}

function LogEntry({
  entry,
  workspaceRoot,
}: {
  entry: RunLogEntry;
  workspaceRoot: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const location = entry.location;
  const normalizedLocation = location
    ? normalizeLogLocation(location)
    : undefined;
  return (
    <Card>
      <HeaderRow>
        <HeaderButton
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <Caret>{expanded ? <ChevronDown /> : <ChevronRight />}</Caret>
          <LogLevel
            info={entry.level === 'info'}
            warn={entry.level === 'warn'}
            error={entry.level === 'error'}
          >
            {entry.level}
          </LogLevel>
          <LogPreview>{summarizeLogMessage(entry.message)}</LogPreview>
          <LogMeta>
            <LogTime>{formatLogTimestamp(entry.timestamp)}</LogTime>
            <LogPhaseTag>
              {LOG_PHASE_LABELS[entry.phase]}
              {entry.source ? ` / ${entry.source}` : ''}
            </LogPhaseTag>
            {normalizedLocation ? (
              <LocationTag>
                {formatShortStackLocation(normalizedLocation)}
              </LocationTag>
            ) : null}
            {entry.truncated ? <TruncatedTag>truncated</TruncatedTag> : null}
          </LogMeta>
        </HeaderButton>
      </HeaderRow>
      {expanded ? (
        <Body>
          <DetailRow>
            <DetailItem>
              <DetailLabel>phase</DetailLabel>
              <DetailValue>{LOG_PHASE_LABELS[entry.phase]}</DetailValue>
            </DetailItem>
            {entry.source ? (
              <DetailItem>
                <DetailLabel>source</DetailLabel>
                <DetailValue>{entry.source}</DetailValue>
              </DetailItem>
            ) : null}
            <DetailItem>
              <DetailLabel>time</DetailLabel>
              <DetailValue>{entry.timestamp}</DetailValue>
            </DetailItem>
            {normalizedLocation ? (
              <LocationDetailItem>
                <DetailLabel>location</DetailLabel>
                <LocationDetailValue>
                  <StackTraceViewer
                    stack={normalizedLocation.stack}
                    primaryLocation={normalizedLocation}
                    workspaceRoot={workspaceRoot}
                    openButtonLabel="Open log location in editor"
                  />
                </LocationDetailValue>
              </LocationDetailItem>
            ) : null}
          </DetailRow>
          {entry.args.length > 0 ? (
            <LogJsonSection>
              <SectionLabel>Arguments</SectionLabel>
              <JsonViewer
                value={entry.args.length === 1 ? entry.args[0] : entry.args}
                compact
                maxHeight="raw"
                collapsed={1}
              />
            </LogJsonSection>
          ) : (
            <LogMessage>{entry.message}</LogMessage>
          )}
        </Body>
      ) : null}
    </Card>
  );
}

function normalizeLogLocation(
  location: NonNullable<RunLogEntry['location']>,
): NonNullable<RunLogEntry['location']> {
  return location;
}

function summarizeLogMessage(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  if (firstLine.length === 0) return '(empty log)';
  if (firstLine.length <= collapsedPreviewMaxChars) return firstLine;
  return `${firstLine.slice(0, collapsedPreviewMaxChars)}...`;
}

function parseLogPhaseFilter(value: string): RunLogPhase | 'all' {
  if (
    value === 'eval' ||
    value === 'derive' ||
    value === 'outputsSchema' ||
    value === 'scorer'
  ) {
    return value;
  }
  return 'all';
}

function formatLogTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}
