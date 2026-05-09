import { styled } from 'vindur';
import { CollapsibleDetails } from '#src/components/CollapsibleDetails';
import { JsonViewer } from '#src/components/JsonViewer';
import { StackTraceViewer } from '#src/components/StackTraceViewer';
import {
  DEFAULT_WORKSPACE_CONFIG,
  workspaceConfigStore,
} from '#src/stores/workspaceConfigStore';
import { colors } from '#src/style/colors';
import { kicker, monoFont, stack } from '#src/style/helpers';

type ErrorDetailTone = 'error' | 'warning';

const ErrorContainer = styled.div<{ warning: boolean }>`
  ---detail-tone: ${colors.error.var};
  ---detail-tone-soft: ${colors.error.alpha(0.06)};
  ---detail-tone-border: ${colors.error.alpha(0.22)};

  ${stack({ gap: 8 })}
  min-width: 0;
  color: var(---detail-tone);
  background: var(---detail-tone-soft);
  border: 1px solid var(---detail-tone-border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  overflow-wrap: anywhere;

  &.warning {
    ---detail-tone: ${colors.warning.var};
    ---detail-tone-soft: ${colors.warning.alpha(0.08)};
    ---detail-tone-border: ${colors.warning.alpha(0.24)};
  }
`;

const ErrorTitle = styled.div`
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const ErrorMeta = styled.div<{ warning: boolean }>`
  ${monoFont};
  font-size: 10px;
  color: ${colors.error.alpha(0.72)};
  min-width: 0;
  overflow-wrap: anywhere;

  &.warning {
    color: ${colors.warning.alpha(0.76)};
  }
`;

const ErrorSectionLabel = styled.div`
  ${kicker};
  color: var(---detail-tone);
`;

const ErrorItemRoot = styled.div<{ warning: boolean }>`
  ${stack({ gap: 4 })}
  min-width: 0;

  & + & {
    border-top: 1px solid ${colors.error.alpha(0.18)};
    padding-top: 8px;
  }

  &.warning + &.warning {
    border-top-color: ${colors.warning.alpha(0.2)};
  }
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
  name: string | null | undefined;
  message: string;
  meta: string | undefined;
  stack: string | undefined;
  attributes: Record<string, unknown> | undefined;
};

export function ErrorDetails({
  label,
  errors,
  tone = 'error',
}: {
  label: string;
  errors: ErrorDetailItem[];
  tone?: ErrorDetailTone;
}) {
  const isWarning = tone === 'warning';
  const workspaceRoot =
    workspaceConfigStore.useDocument().data?.workspaceRoot ??
    DEFAULT_WORKSPACE_CONFIG.workspaceRoot;

  return (
    <ErrorContainer warning={isWarning}>
      <ErrorSectionLabel>{label}</ErrorSectionLabel>
      {errors.map((error) => (
        <ErrorItemRoot
          key={error.id}
          warning={isWarning}
        >
          <ErrorTitle>
            {error.name === null
              ? error.message
              : `${error.name ?? 'Error'}: ${error.message}`}
          </ErrorTitle>
          {error.meta !== undefined ? (
            <ErrorMeta warning={isWarning}>{error.meta}</ErrorMeta>
          ) : null}
          {error.stack !== undefined ? (
            <StackTraceViewer
              stack={error.stack}
              workspaceRoot={workspaceRoot}
            />
          ) : null}
          {error.attributes !== undefined ? (
            <CollapsibleDetails>
              <JsonSection
                label="Attributes"
                data={error.attributes}
              />
            </CollapsibleDetails>
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
