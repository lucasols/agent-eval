import type {
  EvalTraceSpan,
  EvalTraceSpanError,
  TraceDisplayConfig,
} from '@agent-evals/shared';
import { styled } from 'vindur';
import {
  ErrorDetails,
  type ErrorDetailItem,
} from '#src/components/ErrorDetails';
import { JsonViewer } from '#src/components/JsonViewer';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatDuration } from '#src/utils/formatters';
import {
  type DiagnosticOutputMatch,
  findDiagnosticOutputMatch,
} from '#src/utils/outputDiagnostics';
import {
  formatTraceAttributeValue,
  getTraceAttributeItems,
} from '#src/utils/traceAttributes';

const DetailRoot = styled.div`
  ${stack({ gap: 14 })}
  font-size: 12px;
`;

const errorCoreFields = new Set(['name', 'message', 'stack', 'capturedAt']);
const OUTPUT_WARNING_TITLE_VALUE_LIMIT = 140;

const DetailTitle = styled.div`
  ${monoFont};
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: ${colors.text.var};
`;

const DetailItems = styled.div`
  ${stack({ gap: 6 })}
`;

const DetailItemRoot = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  padding: 8px 10px;
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
`;

const DetailItemLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const DetailItemValue = styled.div`
  ${monoFont};
  font-size: 11.5px;
  color: ${colors.text.var};
  text-align: right;
  max-width: 60%;
  word-break: break-all;
`;

const JsonSectionRoot = styled.div`
  ${stack({ gap: 6 })}
`;

const JsonSectionLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

const JsonSectionText = styled.pre`
  ${monoFont};
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${colors.textMuted.var};
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.border.var};
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  max-height: 200px;
  overflow: auto;
`;

type SpanDetailProps = {
  span: EvalTraceSpan;
  spans: EvalTraceSpan[];
  traceDisplay: TraceDisplayConfig;
};

export function SpanDetail({ span, spans, traceDisplay }: SpanDetailProps) {
  const isCheckpoint = span.kind === 'checkpoint';
  const durationMs =
    span.startedAt && span.endedAt
      ? new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()
      : null;
  const startedAt = formatSpanStartOffset(span, spans);
  const detailItems = getTraceAttributeItems(
    span,
    spans,
    traceDisplay,
    'detail',
  );
  const sectionItems = getTraceAttributeItems(
    span,
    spans,
    traceDisplay,
    'section',
  );
  const checkpointValue = isCheckpoint ? span.attributes?.value : undefined;
  const remainingAttributes =
    isCheckpoint && span.attributes !== undefined
      ? Object.fromEntries(
          Object.entries(span.attributes).filter(([k]) => k !== 'value'),
        )
      : null;
  const hasRemainingAttributes =
    remainingAttributes !== null && Object.keys(remainingAttributes).length > 0;
  const capturedErrors = span.errors ?? [];
  const capturedWarnings = span.warnings ?? [];
  const outputDiagnosticMatch = findDiagnosticOutputMatch(
    span.attributes?.output,
  );
  const lastCapturedError = capturedErrors.at(-1);
  const outputWarningItems =
    outputDiagnosticMatch !== undefined
      ? [toOutputWarningDetailItem(outputDiagnosticMatch)]
      : [];
  const capturedWarningItems = capturedWarnings.map((warning, index) =>
    toDiagnosticDetailItem({
      diagnostic: warning,
      id: `captured-warning-${String(index)}-${warning.message}`,
      meta:
        warning.capturedAt !== undefined
          ? formatCapturedErrorTime(span, warning.capturedAt)
          : undefined,
    }),
  );
  const showTerminalError =
    span.error !== undefined &&
    (lastCapturedError === undefined ||
      span.error.name !== lastCapturedError.name ||
      span.error.message !== lastCapturedError.message ||
      span.error.stack !== lastCapturedError.stack ||
      span.error.capturedAt !== lastCapturedError.capturedAt);
  const terminalError = showTerminalError ? span.error : undefined;
  const capturedErrorItems = capturedErrors.map((error, index) =>
    toDiagnosticDetailItem({
      diagnostic: error,
      id: `captured-${String(index)}-${error.message}`,
      meta:
        error.capturedAt !== undefined
          ? formatCapturedErrorTime(span, error.capturedAt)
          : undefined,
    }),
  );
  const terminalErrorItems =
    terminalError !== undefined
      ? [
          toDiagnosticDetailItem({
            diagnostic: terminalError,
            id: `terminal-${terminalError.message}`,
            meta: undefined,
          }),
        ]
      : [];

  return (
    <DetailRoot>
      <DetailTitle>{span.name}</DetailTitle>

      {isCheckpoint ? (
        <JsonSection
          label="Value"
          data={checkpointValue}
          asJson
        />
      ) : null}

      <DetailItems>
        <DetailItem
          label="Kind"
          value={span.kind}
        />
        <DetailItem
          label="Status"
          value={span.status}
        />
        {startedAt !== null ? (
          <DetailItem
            label="Started at"
            value={startedAt}
          />
        ) : null}
        {!isCheckpoint && durationMs !== null ? (
          <DetailItem
            label="Duration"
            value={`${String(durationMs)}ms`}
          />
        ) : null}
        {detailItems.map((item) => (
          <DetailItem
            key={item.config.path}
            label={item.config.label ?? item.config.path}
            value={formatTraceAttributeValue(item.value, item.config)}
          />
        ))}
      </DetailItems>

      {sectionItems.map((item) => (
        <JsonSection
          key={item.config.path}
          label={item.config.label ?? item.config.path}
          data={item.value}
          asJson={item.config.format === 'json'}
        />
      ))}

      {!isCheckpoint && span.attributes !== undefined ? (
        <JsonSection
          label="Attributes"
          data={span.attributes}
          asJson
        />
      ) : null}

      {isCheckpoint && hasRemainingAttributes ? (
        <JsonSection
          label="Other attributes"
          data={remainingAttributes}
          asJson
        />
      ) : null}

      {capturedErrors.length > 0 ? (
        <ErrorDetails
          label={`Captured ${capturedErrors.length === 1 ? 'error' : 'errors'}`}
          errors={capturedErrorItems}
        />
      ) : null}

      {outputWarningItems.length > 0 ? (
        <ErrorDetails
          label={`Output ${
            outputWarningItems.length === 1 ? 'warning' : 'warnings'
          }`}
          errors={outputWarningItems}
          tone="warning"
        />
      ) : null}

      {capturedWarnings.length > 0 ? (
        <ErrorDetails
          label={`Captured ${
            capturedWarnings.length === 1 ? 'warning' : 'warnings'
          }`}
          errors={capturedWarningItems}
          tone="warning"
        />
      ) : null}

      {terminalError ? (
        <ErrorDetails
          label="Terminal error"
          errors={terminalErrorItems}
        />
      ) : null}
    </DetailRoot>
  );
}

function formatSpanStartOffset(
  span: EvalTraceSpan,
  spans: EvalTraceSpan[],
): string | null {
  const spanStartMs = Date.parse(span.startedAt);
  if (!Number.isFinite(spanStartMs)) return null;

  const referenceSpan =
    span.parentId === null
      ? spans
          .filter((candidate) => candidate.parentId === null)
          .toSorted(
            (left, right) =>
              Date.parse(left.startedAt) - Date.parse(right.startedAt),
          )
          .at(0)
      : spans.find((candidate) => candidate.id === span.parentId);
  const referenceStartMs = referenceSpan
    ? Date.parse(referenceSpan.startedAt)
    : spanStartMs;
  if (!Number.isFinite(referenceStartMs)) return null;

  return formatSignedDuration(spanStartMs - referenceStartMs);
}

function formatCapturedErrorTime(
  span: EvalTraceSpan,
  capturedAt: string,
): string {
  const capturedAtMs = Date.parse(capturedAt);
  const spanStartMs = Date.parse(span.startedAt);
  if (!Number.isFinite(capturedAtMs) || !Number.isFinite(spanStartMs)) {
    return 'Captured during span';
  }

  const offsetMs = capturedAtMs - spanStartMs;
  return `Captured ${formatSignedDuration(offsetMs)} from span start`;
}

function formatSignedDuration(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  return `${sign}${formatDuration(Math.abs(ms))}`;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <DetailItemRoot>
      <DetailItemLabel>{label}</DetailItemLabel>
      <DetailItemValue>{value}</DetailItemValue>
    </DetailItemRoot>
  );
}

function toDiagnosticDetailItem({
  diagnostic,
  id,
  meta,
}: {
  diagnostic: EvalTraceSpanError;
  id: string;
  meta: string | undefined;
}): ErrorDetailItem {
  const attributes = Object.fromEntries(
    Object.entries(diagnostic).filter(([key]) => !errorCoreFields.has(key)),
  );
  const hasAttributes = Object.keys(attributes).length > 0;

  return {
    id,
    name: diagnostic.name,
    message: diagnostic.message,
    meta,
    stack: diagnostic.stack,
    attributes: hasAttributes ? attributes : undefined,
  };
}

function toOutputWarningDetailItem(
  match: DiagnosticOutputMatch,
): ErrorDetailItem {
  const shouldShowValueInTitle =
    match.valueText.length <= OUTPUT_WARNING_TITLE_VALUE_LIMIT;
  const titleValue = shouldShowValueInTitle
    ? match.valueText
    : `${match.valueText.slice(0, OUTPUT_WARNING_TITLE_VALUE_LIMIT - 1)}…`;

  return {
    id: `output-diagnostic-${match.path}`,
    name: null,
    message: `${match.path}: ${titleValue}`,
    meta: undefined,
    stack: undefined,
    attributes: shouldShowValueInTitle
      ? undefined
      : { path: match.path, value: match.value },
  };
}

function JsonSection({
  label,
  data,
  asJson = false,
}: {
  label: string;
  data: unknown;
  asJson?: boolean;
}) {
  return (
    <JsonSectionRoot>
      <JsonSectionLabel>{label}</JsonSectionLabel>
      {asJson ? (
        <JsonViewer
          value={data}
          compact
          maxHeight="detail"
          collapsed={6}
        />
      ) : (
        <JsonSectionText>{String(data)}</JsonSectionText>
      )}
    </JsonSectionRoot>
  );
}
