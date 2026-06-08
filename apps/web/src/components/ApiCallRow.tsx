import type { ApiCallEntry, ApiCallMetricValue } from '@agent-evals/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { styled } from 'vindur';
import { ErrorStackTrace } from '#src/components/ErrorStackTrace';
import { JsonViewer } from '#src/components/JsonViewer';
import { StatusBadge } from '#src/components/StatusBadge';
import { Tooltip } from '#src/components/Tooltip';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatDuration, formatNumber } from '#src/utils/formatters';

const EM_DASH = '\u2014';

const Card = styled.div`
  ${stack({ gap: 0 })}
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  overflow: hidden;
`;

const HeaderButton = styled.button`
  ${inline({ gap: 10, align: 'center' })}
  width: 100%;
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

const HeaderName = styled.span`
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: ${colors.text.var};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HeaderMeta = styled.span`
  ${inline({ gap: 8, align: 'center' })}
  ${monoFont};
  margin-left: auto;
  font-size: 11px;
  color: ${colors.textMuted.var};
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const MethodChip = styled.span`
  ${monoFont};
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 2px 7px;
  border-radius: 20px;
  color: ${colors.accentDim.var};
  background: ${colors.accent.alpha(0.1)};
`;

const UrlText = styled.span`
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StatusCodeChip = styled.span<{
  ok: boolean;
  redirect: boolean;
  failed: boolean;
}>`
  ${monoFont};
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};

  &.ok {
    color: ${colors.success.var};
    background: ${colors.success.alpha(0.12)};
  }

  &.redirect {
    color: ${colors.cost.var};
    background: ${colors.cost.alpha(0.12)};
  }

  &.failed {
    color: ${colors.error.var};
    background: ${colors.error.alpha(0.12)};
  }
`;

const MetricChip = styled.span`
  ${monoFont};
  display: inline-flex;
  align-items: center;
  font-size: 10.5px;
  letter-spacing: 0.01em;
  padding: 2px 7px;
  border-radius: 20px;
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};
`;

const MetricChipLabel = styled.span`
  margin-right: 4px;
  color: ${colors.textDim.var};
`;

const Body = styled.div`
  ${stack({ gap: 12 })}
  padding: 12px 14px;
  border-top: 1px solid ${colors.border.var};
`;

const RequestDetailsSection = styled.div`
  ${stack({ gap: 6 })}
`;

const DetailRow = styled.div`
  ${inline({ gap: 12 })}
  align-items: baseline;
  font-size: 12px;
`;

const DetailRowLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
  min-width: 110px;
`;

const DetailRowValue = styled.span`
  ${monoFont};
  color: ${colors.text.var};
  word-break: break-all;
`;

const MetricRow = styled.div`
  ${inline({ gap: 12, align: 'center' })}
  font-size: 12px;
`;

const MetricRowLabel = styled.span`
  ${kicker};
  color: ${colors.textMuted.var};
  min-width: 110px;
`;

const MetricRowValue = styled.span`
  ${monoFont};
  color: ${colors.text.var};
  word-break: break-word;
`;

const MetricsSection = styled.div`
  ${stack({ gap: 6 })}
`;

const RawSectionWrapper = styled.div``;

const RawLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
  margin-bottom: 8px;
`;

const ErrorContainer = styled.div`
  color: ${colors.error.var};
`;

const ErrorTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
`;

const WarningContainer = styled.div`
  ${stack({ gap: 6 })}
  color: ${colors.warning.var};
  font-size: 12px;
`;

const WarningTitle = styled.div`
  font-weight: 600;
`;

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value === null) return 'null';
  if (value === undefined) return EM_DASH;
  return JSON.stringify(value);
}

function formatMetricValue(metric: ApiCallMetricValue): ReactNode {
  const { rawValue, format, numberFormat } = metric;
  if (rawValue === null) return EM_DASH;

  if (format === 'number') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return formatNumber(rawValue, numberFormat);
    }
    return safeStringify(rawValue);
  }

  if (format === 'duration') {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return formatDuration(rawValue);
    }
    return safeStringify(rawValue);
  }

  if (format === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue ? 'Yes' : 'No';
    return safeStringify(rawValue);
  }

  if (format === 'json') {
    if (typeof rawValue === 'string' || typeof rawValue === 'number') {
      return safeStringify(rawValue);
    }
    return (
      <JsonViewer
        value={rawValue}
        compact
        maxHeight="raw"
        collapsed={6}
      />
    );
  }

  return safeStringify(rawValue);
}

function RawSection({ label, data }: { label: string; data: unknown }) {
  return (
    <RawSectionWrapper>
      <RawLabel>{label}</RawLabel>
      <JsonViewer
        value={data}
        compact
        maxHeight="raw"
        collapsed={6}
      />
    </RawSectionWrapper>
  );
}

function summarizeUrl(value: string): string {
  if (!URL.canParse(value)) return value;
  const parsed = new URL(value);
  return `${parsed.host}${parsed.pathname}${parsed.search}`;
}

function metricKey(metric: ApiCallMetricValue): string {
  return `${metric.label}-${metric.placements.join(',')}`;
}

function renderStatusCode(statusCode: number | null) {
  if (statusCode === null) return null;
  const ok = statusCode >= 200 && statusCode < 300;
  const redirect = statusCode >= 300 && statusCode < 400;
  const failed = statusCode >= 400;

  return (
    <StatusCodeChip
      ok={ok}
      redirect={redirect}
      failed={failed}
    >
      {statusCode}
    </StatusCodeChip>
  );
}

/**
 * Render one API-call card inside the case-drawer API calls tab.
 *
 * Collapsed by default. The header shows the call name, eval span status,
 * method, route or URL, HTTP status code, duration, and any user-defined
 * metric whose `placements` includes `'header'`. Expanding the row reveals the
 * original URL, metrics, and request/response payloads captured on the span.
 */
export function ApiCallRow({ entry }: { entry: ApiCallEntry }) {
  const [expanded, setExpanded] = useState(false);

  const headerMetrics = entry.metrics.filter((m) =>
    m.placements.includes('header'),
  );
  const bodyMetrics = entry.metrics.filter((m) =>
    m.placements.includes('body'),
  );
  const durationLabel =
    entry.durationMs === null ? null : formatDuration(entry.durationMs);
  const methodLabel = entry.method === null ? null : entry.method.toUpperCase();
  const urlLabel = entry.url === null ? null : summarizeUrl(entry.url);
  const routeLabel = entry.routeAlias ?? urlLabel;
  const routeTooltip = entry.url ?? entry.routeAlias ?? undefined;

  return (
    <Card>
      <HeaderButton
        type="button"
        onClick={() => {
          setExpanded((prev) => !prev);
        }}
        aria-expanded={expanded}
      >
        <Caret>{expanded ? <ChevronDown /> : <ChevronRight />}</Caret>
        <HeaderName>{entry.name}</HeaderName>
        <HeaderMeta>
          <StatusBadge status={entry.status} />
          {methodLabel !== null ? <MethodChip>{methodLabel}</MethodChip> : null}
          {routeLabel !== null ? (
            <Tooltip content={routeTooltip}>
              <UrlText>{routeLabel}</UrlText>
            </Tooltip>
          ) : null}
          {renderStatusCode(entry.statusCode)}
          {durationLabel !== null ? <span>{durationLabel}</span> : null}
          {headerMetrics.map((metric) => (
            <Tooltip
              key={metricKey(metric)}
              content={metric.tooltip}
            >
              <MetricChip>
                <MetricChipLabel>{metric.label}</MetricChipLabel>
                {formatMetricValue(metric)}
              </MetricChip>
            </Tooltip>
          ))}
        </HeaderMeta>
      </HeaderButton>

      {expanded ? (
        <Body>
          {entry.routeAlias !== null ||
          entry.url !== null ||
          methodLabel !== null ||
          entry.statusCode !== null ||
          durationLabel !== null ? (
            <RequestDetailsSection>
              {methodLabel !== null ? (
                <DetailRow>
                  <DetailRowLabel>Method</DetailRowLabel>
                  <DetailRowValue>{methodLabel}</DetailRowValue>
                </DetailRow>
              ) : null}
              {entry.routeAlias !== null ? (
                <DetailRow>
                  <DetailRowLabel>Route</DetailRowLabel>
                  <DetailRowValue>{entry.routeAlias}</DetailRowValue>
                </DetailRow>
              ) : null}
              {entry.url !== null ? (
                <DetailRow>
                  <DetailRowLabel>URL</DetailRowLabel>
                  <DetailRowValue>{entry.url}</DetailRowValue>
                </DetailRow>
              ) : null}
              {entry.statusCode !== null ? (
                <DetailRow>
                  <DetailRowLabel>Status</DetailRowLabel>
                  <DetailRowValue>{entry.statusCode}</DetailRowValue>
                </DetailRow>
              ) : null}
              {durationLabel !== null ? (
                <DetailRow>
                  <DetailRowLabel>Duration</DetailRowLabel>
                  <DetailRowValue>{durationLabel}</DetailRowValue>
                </DetailRow>
              ) : null}
            </RequestDetailsSection>
          ) : null}

          {bodyMetrics.length > 0 ? (
            <MetricsSection>
              {bodyMetrics.map((metric) => (
                <MetricRow key={metricKey(metric)}>
                  <Tooltip content={metric.tooltip}>
                    <MetricRowLabel>{metric.label}</MetricRowLabel>
                  </Tooltip>
                  <MetricRowValue>{formatMetricValue(metric)}</MetricRowValue>
                </MetricRow>
              ))}
            </MetricsSection>
          ) : null}

          {entry.request !== undefined ? (
            <RawSection
              label="Request"
              data={entry.request}
            />
          ) : null}
          {entry.requestBody !== undefined ? (
            <RawSection
              label="Request body"
              data={entry.requestBody}
            />
          ) : null}
          {entry.response !== undefined ? (
            <RawSection
              label="Response"
              data={entry.response}
            />
          ) : null}
          {entry.responseBody !== undefined ? (
            <RawSection
              label="Response body"
              data={entry.responseBody}
            />
          ) : null}
          {entry.headers !== undefined ? (
            <RawSection
              label="Headers"
              data={entry.headers}
            />
          ) : null}
          {entry.errorPayload !== undefined ? (
            <RawSection
              label="Error"
              data={entry.errorPayload}
            />
          ) : null}

          {entry.warnings.map((warning, i) => (
            <WarningContainer key={`${warning.message}-${String(i)}`}>
              <WarningTitle>
                {warning.name ?? 'Warning'}: {warning.message}
              </WarningTitle>
              {warning.stack ? <ErrorStackTrace stack={warning.stack} /> : null}
            </WarningContainer>
          ))}

          {entry.error !== null ? (
            <ErrorContainer>
              <ErrorTitle>
                {entry.error.name ?? 'Error'}: {entry.error.message}
              </ErrorTitle>
              {entry.error.stack ? (
                <ErrorStackTrace stack={entry.error.stack} />
              ) : null}
            </ErrorContainer>
          ) : null}
        </Body>
      ) : null}
    </Card>
  );
}
