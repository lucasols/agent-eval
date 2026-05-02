import type { ManualInputFieldDescriptor } from '@agent-evals/shared';
import { useId, useRef, useState, type DragEvent } from 'react';
import { css, styled } from 'vindur';
import { colors } from '#src/style/colors';
import { centerContent, stack, inline, transition } from '#src/style/helpers';
import {
  formatFileSize,
  getManualInputFileUrl,
  isManualInputFileValue,
  uploadFileAsManualInputValue,
  type ManualInputFileValue,
} from '#src/utils/manualInputFile';

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

const HiddenFileInput = styled.input`
  display: none;
`;

const Dropzone = styled.div<{ isActive: boolean }>`
  ${stack({ gap: 8, align: 'stretch' })}
  ${centerContent};
  padding: 16px;
  border: 1px dashed ${colors.borderStrong.var};
  border-radius: 8px;
  background: ${colors.bgElevated.var};
  color: ${colors.textMuted.var};
  cursor: pointer;
  text-align: center;
  ${transition({ property: 'background, border-color' })}

  &:hover {
    background: ${colors.surfaceHover.var};
    border-color: ${colors.accent.var};
  }

  &.isActive {
    background: ${colors.accent.alpha(0.08)};
    border-color: ${colors.accent.var};
    color: ${colors.text.var};
  }
`;

const DropzoneHint = styled.span`
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const FilePreview = styled.div`
  ${stack({ gap: 8 })}
  padding: 12px;
  border: 1px solid ${colors.border.var};
  border-radius: 8px;
  background: ${colors.bg.var};
`;

const FilePreviewHeader = styled.div`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
`;

const FilePreviewMeta = styled.div`
  ${stack({ gap: 2 })}
  min-width: 0;
`;

const FilePreviewName = styled.span`
  font-weight: 500;
  color: ${colors.text.var};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FilePreviewSub = styled.span`
  font-size: 12px;
  color: ${colors.textMuted.var};
`;

const FilePreviewActions = styled.div`
  ${inline({ align: 'center', gap: 8 })}
`;

const FilePreviewButton = styled.button`
  border: none;
  background: transparent;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: ${colors.textMuted.var};
  cursor: pointer;
  ${transition({ property: 'background, color' })}

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }
`;

const ImageThumb = styled.img`
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  object-fit: contain;
  background: ${colors.surface.var};
`;

type FieldProps = {
  descriptor: ManualInputFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  errors: string[];
  onFieldError?: (message: string | null) => void;
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

function asFileValue(value: unknown): ManualInputFileValue | null {
  return isManualInputFileValue(value) ? value : null;
}

type FileFieldDescriptor = Extract<
  ManualInputFieldDescriptor,
  { kind: 'file' }
>;

type FileFieldProps = {
  descriptor: FileFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  onError: (message: string | null) => void;
};

function FileFieldInput({
  descriptor,
  value,
  onChange,
  onError,
}: FileFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropzoneId = useId();
  const fileValue = asFileValue(value);
  const [isDragging, setIsDragging] = useState(false);

  function reportError(message: string | null) {
    onError(message);
  }

  async function applyFile(file: File) {
    if (
      typeof descriptor.maxSizeBytes === 'number' &&
      file.size > descriptor.maxSizeBytes
    ) {
      reportError(
        `File is too large (${formatFileSize(file.size)}). Max allowed is ${formatFileSize(descriptor.maxSizeBytes)}.`,
      );
      return;
    }
    const result = await uploadFileAsManualInputValue(file);
    if (result.error) {
      reportError(`Could not read file: ${result.error.message}`);
      return;
    }
    reportError(null);
    onChange(result.value);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    void applyFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const items = event.clipboardData.files;
    if (items.length === 0) return;
    const file = items[0];
    if (!file) return;
    event.preventDefault();
    void applyFile(file);
  }

  function openPicker() {
    inputRef.current?.click();
  }

  function clearFile() {
    onChange(null);
    reportError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const acceptHint = descriptor.accept ? ` (${descriptor.accept})` : '';

  if (fileValue) {
    const isImage = fileValue.mimeType.startsWith('image/');
    return (
      <FilePreview>
        <FilePreviewHeader>
          <FilePreviewMeta>
            <FilePreviewName title={fileValue.name}>
              {fileValue.name || 'Pasted file'}
            </FilePreviewName>
            <FilePreviewSub>
              {fileValue.mimeType || 'application/octet-stream'} ·{' '}
              {formatFileSize(fileValue.sizeBytes)}
            </FilePreviewSub>
          </FilePreviewMeta>
          <FilePreviewActions>
            <FilePreviewButton
              type="button"
              onClick={openPicker}
            >
              Replace
            </FilePreviewButton>
            <FilePreviewButton
              type="button"
              onClick={clearFile}
            >
              Remove
            </FilePreviewButton>
          </FilePreviewActions>
        </FilePreviewHeader>
        {isImage ? (
          <ImageThumb
            src={getManualInputFileUrl(fileValue)}
            alt={fileValue.name}
          />
        ) : null}
        <HiddenFileInput
          ref={inputRef}
          type="file"
          accept={descriptor.accept}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void applyFile(file);
          }}
        />
      </FilePreview>
    );
  }

  return (
    <Dropzone
      isActive={isDragging}
      id={dropzoneId}
      role="button"
      tabIndex={0}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicker();
        }
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
    >
      <span>
        Click to upload, drop a file here, or paste an image
        {acceptHint}
      </span>
      <DropzoneHint>
        {descriptor.maxSizeBytes
          ? `Max size: ${formatFileSize(descriptor.maxSizeBytes)}`
          : ''}
      </DropzoneHint>
      <HiddenFileInput
        ref={inputRef}
        type="file"
        accept={descriptor.accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void applyFile(file);
        }}
      />
    </Dropzone>
  );
}

/** Render one descriptor field as the matching widget. */
export function ManualInputField({
  descriptor,
  value,
  onChange,
  errors,
  onFieldError,
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
  if (descriptor.kind === 'file') {
    return (
      <FieldShell
        descriptor={descriptor}
        errors={errors}
      >
        <FileFieldInput
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          onError={(message) => onFieldError?.(message)}
        />
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
