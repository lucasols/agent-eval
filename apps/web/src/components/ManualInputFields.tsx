import type { ManualInputFieldDescriptor } from '@agent-evals/shared';
import { css, styled } from 'vindur';
import { colors } from '#src/style/colors';
import { stack, inline, transition } from '#src/style/helpers';

const FieldRow = styled.label`
  ${stack({ gap: 6 })}
  font-size: 13px;
`;

const FieldHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 8 })}
`;

const FieldLabel = styled.span`
  ${inline({ align: 'center', gap: 6 })}
  font-weight: 500;
  color: ${colors.text.var};
`;

const OptionalBadge = styled.span`
  font-size: 11px;
  color: ${colors.textMuted.var};
  font-weight: 400;
`;

const FieldDescription = styled.span`
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const inputStyles = css`
  width: 100%;
  padding: 8px 10px;
  border: 1px solid ${colors.borderStrong.var};
  border-radius: 6px;
  background: ${colors.bg.var};
  font-size: 13px;
  color: ${colors.text.var};
  font-family: inherit;
  ${transition({ property: 'border-color, box-shadow' })}

  &:focus {
    outline: none;
    border-color: ${colors.accent.var};
    box-shadow: 0 0 0 3px ${colors.accent.alpha(0.18)};
  }
`;

const TextInput = styled.input`
  ${inputStyles};
`;

const TextareaInput = styled.textarea`
  ${inputStyles};
  resize: vertical;
  min-height: 72px;
  font-family:
    'Geist Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
`;

const SelectInput = styled.select`
  ${inputStyles};
  appearance: auto;
`;

const BooleanRow = styled.div`
  ${inline({ align: 'center', gap: 8 })}
`;

const Checkbox = styled.input`
  width: 16px;
  height: 16px;
  cursor: pointer;
`;

const ErrorList = styled.ul`
  ${stack({ gap: 2 })}
  font-size: 12px;
  color: ${colors.error.var};
  margin: 0;
  padding: 0;
  list-style: none;
`;

type FieldProps = {
  descriptor: ManualInputFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  errors: string[];
};

function FieldShell({
  descriptor,
  errors,
  children,
}: {
  descriptor: ManualInputFieldDescriptor;
  errors: string[];
  children: React.ReactNode;
}) {
  return (
    <FieldRow>
      <FieldHeader>
        <FieldLabel>
          {descriptor.label}
          {!descriptor.required ? (
            <OptionalBadge>optional</OptionalBadge>
          ) : null}
        </FieldLabel>
      </FieldHeader>
      {descriptor.description ? (
        <FieldDescription>{descriptor.description}</FieldDescription>
      ) : null}
      {children}
      {errors.length > 0 ? (
        <ErrorList>
          {errors.map((message, index) => (
            <li key={`${message}-${String(index)}`}>{message}</li>
          ))}
        </ErrorList>
      ) : null}
    </FieldRow>
  );
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/** Render one descriptor field as the matching widget. */
export function ManualInputField({
  descriptor,
  value,
  onChange,
  errors,
}: FieldProps) {
  if (descriptor.kind === 'text') {
    return (
      <FieldShell
        descriptor={descriptor}
        errors={errors}
      >
        <TextInput
          type="text"
          value={asString(value)}
          placeholder={descriptor.placeholder}
          minLength={descriptor.minLength}
          maxLength={descriptor.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      </FieldShell>
    );
  }
  if (descriptor.kind === 'multiline') {
    return (
      <FieldShell
        descriptor={descriptor}
        errors={errors}
      >
        <TextareaInput
          rows={descriptor.rows ?? 4}
          value={asString(value)}
          placeholder={descriptor.placeholder}
          minLength={descriptor.minLength}
          maxLength={descriptor.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      </FieldShell>
    );
  }
  if (descriptor.kind === 'number') {
    return (
      <FieldShell
        descriptor={descriptor}
        errors={errors}
      >
        <TextInput
          type="number"
          value={asString(value)}
          placeholder={descriptor.placeholder}
          min={descriptor.min}
          max={descriptor.max}
          step={descriptor.integer ? 1 : (descriptor.step ?? 'any')}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '') {
              onChange(undefined);
              return;
            }
            const parsed = Number(next);
            onChange(Number.isFinite(parsed) ? parsed : next);
          }}
        />
      </FieldShell>
    );
  }
  if (descriptor.kind === 'boolean') {
    return (
      <FieldShell
        descriptor={descriptor}
        errors={errors}
      >
        <BooleanRow>
          <Checkbox
            type="checkbox"
            checked={asBoolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{descriptor.placeholder ?? 'Enable'}</span>
        </BooleanRow>
      </FieldShell>
    );
  }
  if (descriptor.kind === 'select') {
    return (
      <FieldShell
        descriptor={descriptor}
        errors={errors}
      >
        <SelectInput
          value={asString(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          {!descriptor.required ? <option value="">—</option> : null}
          {descriptor.options.map((option) => (
            <option
              key={option.value}
              value={option.value}
            >
              {option.label}
            </option>
          ))}
        </SelectInput>
      </FieldShell>
    );
  }
  return (
    <FieldShell
      descriptor={descriptor}
      errors={errors}
    >
      <TextareaInput
        rows={descriptor.rows ?? 6}
        value={asString(value)}
        placeholder={descriptor.placeholder ?? '{ }'}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldShell>
  );
}
