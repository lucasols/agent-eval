import type { EvalTraceSpan } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors.ts';
import { inline, monoFont } from '#src/style/helpers.ts';
import { DisplayBlockRenderer } from './DisplayBlockRenderer.tsx';

const DetailRoot = styled.div`
  padding: 12px;
  background: ${colors.bg.var};
  border-radius: var(--radius-md);
  border: 1px solid ${colors.border.var};
  font-size: 12px;
`;

const DetailTitle = styled.div`
  font-weight: 600;
  margin-bottom: 8px;
`;

const DetailItems = styled.div`
  ${inline({ gap: 12 })}
  margin-bottom: 12px;
  flex-wrap: wrap;
`;

const DetailItemRoot = styled.div``;

const DetailItemLabel = styled.div`
  font-size: 10px;
  color: ${colors.textMuted.var};
  margin-bottom: 2px;
`;

const DetailItemValue = styled.div`
  ${monoFont}
`;

const ErrorContainer = styled.div`
  color: ${colors.error.var};
  margin-top: 8px;
`;

const ErrorTitle = styled.div`
  font-weight: 600;
`;

const ErrorStack = styled.pre`
  ${monoFont}
  font-size: 10px;
  white-space: pre-wrap;
  margin-top: 4px;
  opacity: 0.8;
`;

const JsonSectionRoot = styled.div`
  margin-top: 8px;
`;

const JsonSectionLabel = styled.div`
  font-weight: 600;
  font-size: 11px;
  color: ${colors.textSecondary.var};
  margin-bottom: 4px;
`;

const JsonSectionPre = styled.pre`
  ${monoFont}
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  background: ${colors.surface.var};
  padding: 8px;
  border-radius: var(--radius-sm);
  max-height: 200px;
  overflow: auto;
`;

type SpanDetailProps = {
  span: EvalTraceSpan;
};

export function SpanDetail({ span }: SpanDetailProps) {
  const durationMs =
    span.startedAt && span.endedAt
      ? new Date(span.endedAt).getTime() - new Date(span.startedAt).getTime()
      : null;

  return (
    <DetailRoot>
      <DetailTitle>{span.name}</DetailTitle>

      <DetailItems>
        <DetailItem label="Kind" value={span.kind} />
        <DetailItem label="Status" value={span.status} />
        {durationMs !== null ? <DetailItem label="Duration" value={`${String(durationMs)}ms`} /> : null}
        {span.usage ? (
          <>
            {span.usage.inputTokens !== undefined ? (
              <DetailItem label="Input tokens" value={String(span.usage.inputTokens)} />
            ) : null}
            {span.usage.outputTokens !== undefined ? (
              <DetailItem label="Output tokens" value={String(span.usage.outputTokens)} />
            ) : null}
          </>
        ) : null}
        {span.costUsd !== null && span.costUsd !== undefined ? (
          <DetailItem label="Cost" value={`$${span.costUsd.toFixed(4)}`} />
        ) : null}
        {span.cache ? (
          <>
            <DetailItem label="Cache mode" value={span.cache.mode} />
            <DetailItem label="Cache status" value={span.cache.status} />
          </>
        ) : null}
      </DetailItems>

      {span.display?.map((block, i) => (
        <DisplayBlockRenderer key={i} block={block} />
      ))}

      {span.input !== undefined ? (
        <JsonSection label="Input" data={span.input} />
      ) : null}

      {span.output !== undefined ? (
        <JsonSection label="Output" data={span.output} />
      ) : null}

      {span.error ? (
        <ErrorContainer>
          <ErrorTitle>
            {span.error.name ?? 'Error'}: {span.error.message}
          </ErrorTitle>
          {span.error.stack ? (
            <ErrorStack>
              {span.error.stack}
            </ErrorStack>
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

function JsonSection({ label, data }: { label: string; data: unknown }) {
  return (
    <JsonSectionRoot>
      <JsonSectionLabel>
        {label}
      </JsonSectionLabel>
      <JsonSectionPre>
        {JSON.stringify(data, null, 2)}
      </JsonSectionPre>
    </JsonSectionRoot>
  );
}
