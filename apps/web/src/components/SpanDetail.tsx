import type { EvalTraceSpan, TraceDisplayConfig } from '@agent-evals/shared';
import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import { formatDuration } from '#src/utils/formatters';
import {
  formatTraceAttributeValue,
  getTraceAttributeItems,
} from '#src/utils/traceAttributes';

const DetailRoot = styled.div`
  ${stack({ gap: 14 })}
  font-size: 12px;
`;

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

const ErrorContainer = styled.div`
  ${stack({ gap: 8 })}
  color: ${colors.error.var};
  background: ${colors.error.alpha(0.06)};
  border: 1px solid ${colors.error.alpha(0.22)};
  border-radius: var(--radius-sm);
  padding: 10px 12px;
`;

const ErrorTitle = styled.div`
  font-weight: 600;
`;

const ErrorMeta = styled.div`
  ${monoFont};
  font-size: 10px;
  color: ${colors.error.alpha(0.72)};
`;

const ErrorSectionLabel = styled.div`
  ${kicker};
  color: ${colors.error.var};
`;

const ErrorItem = styled.div`
  ${stack({ gap: 4 })}

  & + & {
    border-top: 1px solid ${colors.error.alpha(0.18)};
    padding-top: 8px;
  }
`;

const ErrorStack = styled.pre`
  ${monoFont};
  font-size: 10px;
  white-space: pre-wrap;
  opacity: 0.8;
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
  const lastCapturedError = capturedErrors.at(-1);
  const showTerminalError =
    span.error !== undefined &&
    (lastCapturedError === undefined ||
      span.error.name !== lastCapturedError.name ||
      span.error.message !== lastCapturedError.message ||
      span.error.stack !== lastCapturedError.stack ||
      span.error.capturedAt !== lastCapturedError.capturedAt);
  const terminalError = showTerminalError ? span.error : undefined;

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
        <ErrorContainer>
          <ErrorSectionLabel>
            Captured {capturedErrors.length === 1 ? 'error' : 'errors'}
          </ErrorSectionLabel>
          {capturedErrors.map((error, index) => (
            <ErrorItem key={`${String(index)}-${error.message}`}>
              <ErrorTitle>
                {error.name ?? 'Error'}: {error.message}
              </ErrorTitle>
              {error.capturedAt ? (
                <ErrorMeta>
                  {formatCapturedErrorTime(span, error.capturedAt)}
                </ErrorMeta>
              ) : null}
              {error.stack ? <ErrorStack>{error.stack}</ErrorStack> : null}
            </ErrorItem>
          ))}
        </ErrorContainer>
      ) : null}

      {terminalError ? (
        <ErrorContainer>
          <ErrorSectionLabel>Terminal error</ErrorSectionLabel>
          <ErrorTitle>
            {terminalError.name ?? 'Error'}: {terminalError.message}
          </ErrorTitle>
          {terminalError.stack ? (
            <ErrorStack>{terminalError.stack}</ErrorStack>
          ) : null}
        </ErrorContainer>
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
