import { styled } from 'vindur';
import { JsonViewer } from '#src/components/JsonViewer';
import { colors } from '#src/style/colors';
import { kicker, monoFont, stack } from '#src/style/helpers';

const ErrorContainer = styled.div`
  ${stack({ gap: 8 })}
  min-width: 0;
  color: ${colors.error.var};
  background: ${colors.error.alpha(0.06)};
  border: 1px solid ${colors.error.alpha(0.22)};
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  overflow-wrap: anywhere;
`;

const ErrorTitle = styled.div`
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const ErrorMeta = styled.div`
  ${monoFont};
  font-size: 10px;
  color: ${colors.error.alpha(0.72)};
  min-width: 0;
  overflow-wrap: anywhere;
`;

const ErrorSectionLabel = styled.div`
  ${kicker};
  color: ${colors.error.var};
`;

const ErrorItemRoot = styled.div`
  ${stack({ gap: 4 })}
  min-width: 0;

  & + & {
    border-top: 1px solid ${colors.error.alpha(0.18)};
    padding-top: 8px;
  }
`;

const ErrorStack = styled.pre`
  ${monoFont};
  font-size: 10px;
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  opacity: 0.8;
  margin: 0;
`;

const JsonSectionRoot = styled.div`
  ${stack({ gap: 6 })}
`;

const JsonSectionLabel = styled.div`
  ${kicker};
  color: ${colors.textMuted.var};
`;

export type ErrorDetailItem = {
  id: string;
  name: string | undefined;
  message: string;
  meta: string | undefined;
  stack: string | undefined;
  attributes: Record<string, unknown> | undefined;
};

export function ErrorDetails({
  label,
  errors,
}: {
  label: string;
  errors: ErrorDetailItem[];
}) {
  return (
    <ErrorContainer>
      <ErrorSectionLabel>{label}</ErrorSectionLabel>
      {errors.map((error) => (
        <ErrorItemRoot key={error.id}>
          <ErrorTitle>
            {error.name ?? 'Error'}: {error.message}
          </ErrorTitle>
          {error.meta !== undefined ? (
            <ErrorMeta>{error.meta}</ErrorMeta>
          ) : null}
          {error.stack !== undefined ? (
            <ErrorStack>{error.stack}</ErrorStack>
          ) : null}
          {error.attributes !== undefined ? (
            <JsonSection
              label="Attributes"
              data={error.attributes}
            />
          ) : null}
        </ErrorItemRoot>
      ))}
    </ErrorContainer>
  );
}

function JsonSection({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown>;
}) {
  return (
    <JsonSectionRoot>
      <JsonSectionLabel>{label}</JsonSectionLabel>
      <JsonViewer
        value={data}
        compact
        maxHeight="detail"
        collapsed={6}
      />
    </JsonSectionRoot>
  );
}
