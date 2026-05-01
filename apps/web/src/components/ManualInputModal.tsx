import type {
  EvalSummary,
  ManualInputDescriptor,
  ManualInputFieldDescriptor,
} from '@agent-evals/shared';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { styled } from 'vindur';
import { Button } from '#src/components/Button';
import { ManualInputField } from '#src/components/ManualInputFields';
import { Modal } from '#src/components/Modal';
import type { ManualInputStartRunFailure } from '#src/stores/runStore';
import { colors } from '#src/style/colors';
import { inline, stack } from '#src/style/helpers';
import {
  isManualInputFileValue,
  readFileAsManualInputValue,
} from '#src/utils/manualInputFile';

const Form = styled.form`
  ${stack({ gap: 14 })}
`;

const FooterActions = styled.div`
  ${inline({ align: 'center', gap: 8 })}
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
  if (descriptor.kind === 'file') return null;
  if (descriptor.kind === 'select' && descriptor.required) {
    // Required selects render without an empty option, so the browser shows
    // the first option even though our state would otherwise be `''`. Seed
    // the draft with that value so submitting unchanged passes validation.
    const firstOption = descriptor.options[0];
    if (firstOption) return firstOption.value;
  }
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
    } else if (field.kind === 'file') {
      if (isManualInputFileValue(raw)) {
        if (
          typeof field.maxSizeBytes === 'number' &&
          raw.size > field.maxSizeBytes
        ) {
          fieldErrors.push('File exceeds the maximum allowed size');
        } else {
          values[field.key] = raw;
        }
      } else if (field.required) {
        fieldErrors.push('Required');
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

  function setFieldError(key: string, message: string | null) {
    setClientErrors((prev) => {
      const next = { ...prev };
      if (message === null) {
        delete next[key];
      } else {
        next[key] = [message];
      }
      return next;
    });
  }

  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!isOpen) return;
    const fileFields = descriptor.fields.filter(
      (field): field is Extract<ManualInputFieldDescriptor, { kind: 'file' }> =>
        field.kind === 'file',
    );
    if (fileFields.length === 0) return;

    function isEditableElement(element: EventTarget | null): boolean {
      if (!(element instanceof HTMLElement)) return false;
      const tag = element.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
      }
      return element.isContentEditable;
    }

    async function handleDocumentPaste(event: ClipboardEvent) {
      if (isEditableElement(event.target)) return;
      const data = event.clipboardData;
      if (!data || data.files.length === 0) return;
      const file = data.files[0];
      if (!file) return;
      const target =
        fileFields.find(
          (field) => !isManualInputFileValue(draftRef.current[field.key]),
        ) ?? fileFields[0];
      if (!target) return;
      event.preventDefault();
      if (
        typeof target.maxSizeBytes === 'number' &&
        file.size > target.maxSizeBytes
      ) {
        setClientErrors((prev) => ({
          ...prev,
          [target.key]: ['File exceeds the maximum allowed size'],
        }));
        return;
      }
      const result = await readFileAsManualInputValue(file);
      if (result.error) {
        setClientErrors((prev) => ({
          ...prev,
          [target.key]: [`Could not read file: ${result.error.message}`],
        }));
        return;
      }
      setDraft((prev) => ({ ...prev, [target.key]: result.value }));
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[target.key];
        return next;
      });
    }

    const listener = (event: ClipboardEvent) => {
      void handleDocumentPaste(event);
    };
    document.addEventListener('paste', listener);
    return () => document.removeEventListener('paste', listener);
  }, [isOpen, descriptor.fields]);

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

  function handleClear() {
    setDraft(buildInitialValues(descriptor));
    setClientErrors({});
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
            onClick={handleClear}
            disabled={isSubmitting}
          >
            Clear
          </Button>
          <FooterActions>
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
          </FooterActions>
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
              onFieldError={(message) => setFieldError(field.key, message)}
            />
          );
        })}
        {formLevelError ? <FormError>{formLevelError}</FormError> : null}
      </Form>
    </Modal>
  );
}
