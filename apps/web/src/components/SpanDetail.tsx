import type { EvalTraceSpan, TraceDisplayConfig } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, kicker, monoFont, stack } from '#src/style/helpers';
import {
  formatTraceAttributeValue,
  getTraceAttributeItems,
} from '#src/utils/traceAttributes';
import { JsonViewer } from './JsonViewer.tsx';

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
  color: ${colors.error.var};
`;

const ErrorTitle = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
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
  const durationMs =
    span.startedAt && span.endedAt
      ? new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()
      : null;
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

  return (
    <DetailRoot>
      <DetailTitle>{span.name}</DetailTitle>

      <DetailItems>
        <DetailItem
          label="Kind"
          value={span.kind}
        />
        <DetailItem
          label="Status"
          value={span.status}
        />
        {durationMs !== null ? (
          <DetailItem
            label="Duration"
            value={`${String(durationMs)}ms`}
          />
        ) : null}
        {detailItems.map((item) => (
          <DetailItem
            key={item.config.path}
            label={item.config.label ?? item.config.path}
            value={formatTraceAttributeValue(item.value, item.config.format)}
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

      {span.attributes !== undefined ? (
        <JsonSection
          label="Attributes"
          data={span.attributes}
          asJson
        />
      ) : null}

      {span.error ? (
        <ErrorContainer>
          <ErrorTitle>
            {span.error.name ?? 'Error'}: {span.error.message}
          </ErrorTitle>
          {span.error.stack ? (
            <ErrorStack>{span.error.stack}</ErrorStack>
          ) : null}
        </ErrorContainer>
      ) : null}
    </DetailRoot>
  );
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
