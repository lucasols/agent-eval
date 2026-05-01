import type {
  EvalSummary,
  ManualInputDescriptor,
  ManualInputFieldDescriptor,
} from '@agent-evals/shared';
import { useMemo, useState, type SyntheticEvent } from 'react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { ManualInputField } from '#src/components/ManualInputFields';
import { Modal } from '#src/components/Modal';
import type { ManualInputStartRunFailure } from '#src/stores/runStore';
import { colors } from '#src/style/colors';
import { stack } from '#src/style/helpers';

const Form = styled.form`
  ${stack({ gap: 14 })}
`;

const FormError = styled.p`
  font-size: 13px;
  color: ${colors.error.var};
  margin: 0;
`;

type ManualInputModalProps = {
  evalSummary: EvalSummary;
  descriptor: ManualInputDescriptor;
  isOpen: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void;
  serverFailure?: ManualInputStartRunFailure | undefined;
  isSubmitting?: boolean;
};

function defaultValueFor(descriptor: ManualInputFieldDescriptor): unknown {
  if (descriptor.defaultValue !== undefined) return descriptor.defaultValue;
  if (descriptor.kind === 'boolean') return false;
  if (descriptor.kind === 'number') return undefined;
  return '';
}

function buildInitialValues(
  descriptor: ManualInputDescriptor,
): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const field of descriptor.fields) {
    initial[field.key] = defaultValueFor(field);
  }
  return initial;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

function tryParseJson(
  raw: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

type ValidationResult = {
  values: Record<string, unknown>;
  errors: Record<string, string[]>;
};

function validateValues(
  descriptor: ManualInputDescriptor,
  draft: Record<string, unknown>,
): ValidationResult {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};

  for (const field of descriptor.fields) {
    const raw = draft[field.key];
    const fieldErrors: string[] = [];

    if (field.kind === 'json') {
      if (typeof raw !== 'string' || raw.trim() === '') {
        if (field.required) fieldErrors.push('Required');
      } else {
        const parsed = tryParseJson(raw);
        if (parsed.ok) {
          values[field.key] = parsed.value;
        } else {
          fieldErrors.push(`Invalid JSON: ${parsed.message}`);
        }
      }
    } else if (field.kind === 'number') {
      if (raw === undefined || raw === '') {
        if (field.required) fieldErrors.push('Required');
      } else if (typeof raw === 'number' && Number.isFinite(raw)) {
        values[field.key] = raw;
      } else {
        fieldErrors.push('Must be a number');
      }
    } else if (field.kind === 'boolean') {
      values[field.key] = raw === true;
    } else if (field.kind === 'select') {
      if (isEmpty(raw)) {
        if (field.required) fieldErrors.push('Required');
      } else {
        values[field.key] = raw;
      }
    } else {
      // text + multiline
      if (isEmpty(raw)) {
        if (field.required) fieldErrors.push('Required');
      } else {
        values[field.key] = raw;
      }
    }

    if (fieldErrors.length > 0) errors[field.key] = fieldErrors;
  }

  return { values, errors };
}

/**
 * Modal that collects manual-input values for one eval before kicking off a
 * run. Renders the eval's wire descriptor as inputs, validates required
 * fields and JSON parsing client-side, and surfaces server-side validation
 * failures returned by the run-start endpoint.
 */
export function ManualInputModal({
  evalSummary,
  descriptor,
  isOpen,
  onCancel,
  onSubmit,
  serverFailure,
  isSubmitting,
}: ManualInputModalProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    buildInitialValues(descriptor),
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string[]>>(
    {},
  );

  const serverFieldErrors = useMemo(() => {
    if (!serverFailure) return {};
    const map: Record<string, string[]> = {};
    for (const issue of serverFailure.issues) {
      const segment = issue.path.split('.')[0] ?? '';
      const key = segment === '' ? '__form__' : segment;
      const list = map[key] ?? [];
      list.push(issue.message);
      map[key] = list;
    }
    return map;
  }, [serverFailure]);

  function setField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (clientErrors[key]) {
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateValues(descriptor, draft);
    if (Object.keys(validation.errors).length > 0) {
      setClientErrors(validation.errors);
      return;
    }
    setClientErrors({});
    await onSubmit(validation.values);
  }

  const formLevelError = serverFieldErrors.__form__?.join(' ') ?? '';

  return (
    <Modal
      isOpen={isOpen}
      title={descriptor.title ?? evalSummary.title ?? evalSummary.id}
      subtitle={descriptor.description}
      onClose={onCancel}
      footer={
        <>
          <Button
            variant="ghost"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="manual-input-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Starting…' : (descriptor.submitLabel ?? 'Run')}
          </Button>
        </>
      }
    >
      <Form
        id="manual-input-form"
        onSubmit={handleSubmit}
      >
        {descriptor.fields.map((field) => {
          const errors = [
            ...(clientErrors[field.key] ?? []),
            ...(serverFieldErrors[field.key] ?? []),
          ];
          return (
            <ManualInputField
              key={field.key}
              descriptor={field}
              value={draft[field.key]}
              onChange={(value) => setField(field.key, value)}
              errors={errors}
            />
          );
        })}
        {formLevelError ? <FormError>{formLevelError}</FormError> : null}
      </Form>
    </Modal>
  );
}
