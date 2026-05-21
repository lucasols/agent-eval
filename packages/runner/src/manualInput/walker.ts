import type {
  EvalManualInputConfig,
  ManualInputFieldOverride,
} from '@agent-evals/sdk';
import type {
  ManualInputDescriptor,
  ManualInputFieldDescriptor,
  ManualInputSelectOption,
} from '@agent-evals/shared';
import { Result } from 't-result';
import type { z } from 'zod';

type ZodDef = Record<string, unknown> & { type: string };

type ZodCheck = Record<string, unknown> & { check: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getZodDef(schema: unknown): ZodDef | null {
  if (!isObject(schema)) return null;
  const zodHolder = schema._zod;
  if (!isObject(zodHolder)) return null;
  const def = zodHolder.def;
  if (!isObject(def)) return null;
  if (typeof def.type !== 'string') return null;
  return { ...def, type: def.type };
}

function getDescription(schema: unknown): string | undefined {
  if (!isObject(schema)) return undefined;
  const description = schema.description;
  return typeof description === 'string' ? description : undefined;
}

function getInnerSchema(def: ZodDef): unknown {
  return def.innerType;
}

function getChecks(def: ZodDef): ZodCheck[] {
  const checks = def.checks;
  if (!Array.isArray(checks)) return [];
  const out: ZodCheck[] = [];
  for (const check of checks) {
    if (!isObject(check)) continue;
    const zodHolder = check._zod;
    if (!isObject(zodHolder)) continue;
    const checkDef = zodHolder.def;
    if (!isObject(checkDef)) continue;
    if (typeof checkDef.check !== 'string') continue;
    out.push({ ...checkDef, check: checkDef.check });
  }
  return out;
}

function findCheck(checks: ZodCheck[], name: string): ZodCheck | undefined {
  return checks.find((check) => check.check === name);
}

type Unwrapped = {
  schema: unknown;
  def: ZodDef;
  required: boolean;
  defaultValue: unknown;
};

function unwrap(schema: unknown): Unwrapped | null {
  let current = schema;
  let required = true;
  let defaultValue: unknown = undefined;
  for (let depth = 0; depth < 8; depth += 1) {
    const def = getZodDef(current);
    if (!def) return null;
    if (def.type === 'optional' || def.type === 'nullable') {
      required = false;
      current = getInnerSchema(def);
      continue;
    }
    if (def.type === 'nullish') {
      required = false;
      current = getInnerSchema(def);
      continue;
    }
    if (def.type === 'default' || def.type === 'prefault') {
      const raw = def.defaultValue;
      if (typeof raw === 'function') {
        defaultValue = Reflect.apply(raw, undefined, []);
      } else {
        defaultValue = raw;
      }
      current = getInnerSchema(def);
      continue;
    }
    if (def.type === 'readonly' || def.type === 'pipe') {
      current = getInnerSchema(def) ?? def.in;
      continue;
    }
    return { schema: current, def, required, defaultValue };
  }
  return null;
}

function humaniseKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return key;
  const lowered = spaced.toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

function normaliseSelectOptions(
  raw: ManualInputFieldOverride['options'],
): ManualInputSelectOption[] | undefined {
  if (!raw) return undefined;
  return raw.map((entry) => {
    if (typeof entry === 'string') return { value: entry, label: entry };
    return { value: entry.value, label: entry.label ?? entry.value };
  });
}

function enumOptionsFromEntries(def: ZodDef): ManualInputSelectOption[] | null {
  const entries = def.entries;
  if (!isObject(entries)) return null;
  const out: ManualInputSelectOption[] = [];
  for (const [label, value] of Object.entries(entries)) {
    if (typeof value === 'string') {
      out.push({ value, label });
    } else if (typeof value === 'number') {
      out.push({ value: String(value), label });
    } else {
      return null;
    }
  }
  return out;
}

function literalUnionOptions(def: ZodDef): ManualInputSelectOption[] | null {
  const options = def.options;
  if (!Array.isArray(options)) return null;
  const out: ManualInputSelectOption[] = [];
  for (const option of options) {
    const optDef = getZodDef(option);
    if (optDef?.type !== 'literal') return null;
    const values = optDef.values;
    if (!Array.isArray(values) || values.length !== 1) return null;
    const value: unknown = values[0];
    if (typeof value === 'string') {
      out.push({ value, label: value });
    } else if (typeof value === 'number') {
      const stringValue = String(value);
      out.push({ value: stringValue, label: stringValue });
    } else {
      return null;
    }
  }
  return out.length > 0 ? out : null;
}

function literalSelectOptions(def: ZodDef): ManualInputSelectOption[] | null {
  const values = def.values;
  if (!Array.isArray(values)) return null;
  const out: ManualInputSelectOption[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      out.push({ value, label: value });
    } else if (typeof value === 'number') {
      const stringValue = String(value);
      out.push({ value: stringValue, label: stringValue });
    } else {
      return null;
    }
  }
  return out;
}

type StringChecks = { minLength?: number; maxLength?: number };

function readStringChecks(def: ZodDef): StringChecks {
  const checks = getChecks(def);
  const out: StringChecks = {};
  const min = findCheck(checks, 'min_length');
  if (min && typeof min.minimum === 'number') out.minLength = min.minimum;
  const max = findCheck(checks, 'max_length');
  if (max && typeof max.maximum === 'number') out.maxLength = max.maximum;
  return out;
}

type NumberChecks = { min?: number; max?: number; integer?: boolean };

const integerNumberFormats = new Set([
  'int',
  'safeint',
  'int32',
  'uint32',
  'int64',
  'uint64',
]);

function readNumberChecks(def: ZodDef): NumberChecks {
  const checks = getChecks(def);
  const out: NumberChecks = {};
  const gt = findCheck(checks, 'greater_than');
  if (gt && typeof gt.value === 'number' && gt.inclusive === true) {
    out.min = gt.value;
  }
  const lt = findCheck(checks, 'less_than');
  if (lt && typeof lt.value === 'number' && lt.inclusive === true) {
    out.max = lt.value;
  }
  const format = findCheck(checks, 'number_format');
  if (
    format &&
    typeof format.format === 'string' &&
    integerNumberFormats.has(format.format)
  ) {
    out.integer = true;
  }
  return out;
}

function buildField(
  key: string,
  fieldSchema: unknown,
  override: ManualInputFieldOverride | undefined,
): Result<ManualInputFieldDescriptor, Error> {
  const unwrapped = unwrap(fieldSchema);
  if (!unwrapped) {
    return Result.err(
      new Error(
        `manualInput: field "${key}" uses an unsupported Zod schema (could not introspect)`,
      ),
    );
  }

  const inner = unwrapped.def;
  const description = override?.description ?? getDescription(unwrapped.schema);
  const label = override?.label ?? humaniseKey(key);
  const placeholder = override?.placeholder;
  const required = unwrapped.required;
  const defaultValue =
    override?.defaultValue !== undefined
      ? override.defaultValue
      : unwrapped.defaultValue;

  const base = {
    key,
    label,
    description,
    placeholder,
    required,
    defaultValue,
  } satisfies Omit<ManualInputFieldDescriptor, 'kind'>;

  if (override?.asJson === true) {
    const rows = override.rows;
    return Result.ok({ ...base, kind: 'json', rows });
  }

  if (override?.asFile === true) {
    return Result.ok({
      ...base,
      kind: 'file',
      accept: override.accept,
      maxSizeBytes: override.maxSizeBytes,
    });
  }

  const overrideOptions = normaliseSelectOptions(override?.options);
  if (overrideOptions) {
    return Result.ok({ ...base, kind: 'select', options: overrideOptions });
  }

  switch (inner.type) {
    case 'string': {
      const checks = readStringChecks(inner);
      if (override?.multiline === true) {
        return Result.ok({
          ...base,
          kind: 'multiline',
          rows: override.rows,
          minLength: checks.minLength,
          maxLength: checks.maxLength,
        });
      }
      return Result.ok({
        ...base,
        kind: 'text',
        minLength: checks.minLength,
        maxLength: checks.maxLength,
      });
    }
    case 'number':
    case 'int':
    case 'bigint': {
      const checks = readNumberChecks(inner);
      return Result.ok({
        ...base,
        kind: 'number',
        min: checks.min,
        max: checks.max,
        integer: checks.integer,
      });
    }
    case 'boolean':
      return Result.ok({ ...base, kind: 'boolean' });
    case 'enum': {
      const options = enumOptionsFromEntries(inner);
      if (options) return Result.ok({ ...base, kind: 'select', options });
      return Result.ok({ ...base, kind: 'json', rows: override?.rows });
    }
    case 'literal': {
      const options = literalSelectOptions(inner);
      if (options && options.length > 0) {
        return Result.ok({ ...base, kind: 'select', options });
      }
      return Result.ok({ ...base, kind: 'json', rows: override?.rows });
    }
    case 'union': {
      const options = literalUnionOptions(inner);
      if (options) return Result.ok({ ...base, kind: 'select', options });
      return Result.ok({ ...base, kind: 'json', rows: override?.rows });
    }
    default:
      return Result.ok({ ...base, kind: 'json', rows: override?.rows });
  }
}

function getObjectShape(schema: unknown): Record<string, unknown> | null {
  const def = getZodDef(schema);
  if (!def) return null;
  if (def.type !== 'object') return null;
  const shape = def.shape;
  if (!isObject(shape)) return null;
  return shape;
}

/**
 * Walk an eval's `manualInput` configuration and produce the wire-format
 * descriptor consumed by the web UI. The schema must resolve to a top-level
 * `z.object(...)`; nested objects, arrays, unions, and other unsupported
 * shapes inside fields fall back to the JSON textarea widget.
 *
 * Returns a `Result` so the caller (eval discovery) can surface a discovery
 * issue without throwing when the schema is incompatible.
 */
export function buildManualInputDescriptor<TInput>(
  config: EvalManualInputConfig<TInput>,
): Result<ManualInputDescriptor, Error> {
  const shape = getObjectShape(config.schema);
  if (!shape) {
    return Result.err(
      new Error(
        'manualInput.schema must be a top-level z.object(...). Wrap nested types in an object schema.',
      ),
    );
  }

  const overrides: Record<string, ManualInputFieldOverride> = {};
  const rawOverrides = config.fields;
  if (rawOverrides) {
    for (const [key, override] of Object.entries(rawOverrides)) {
      if (override) overrides[key] = override;
    }
  }
  const fields: ManualInputFieldDescriptor[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const fieldResult = buildField(key, fieldSchema, overrides[key]);
    if (fieldResult.error) return fieldResult.errorResult();
    fields.push(fieldResult.value);
  }

  return Result.ok({
    title: config.title,
    description: config.description,
    submitLabel: config.submitLabel,
    fields,
  });
}

/**
 * Resolve an eval's `manualInput` Zod schema against a raw user submission.
 * Returns the parsed value typed against the eval's `TInput` generic, or a
 * structured `Error` carrying the Zod issues for the caller to surface.
 */
export function parseManualInputValues<TInput>(
  config: EvalManualInputConfig<TInput>,
  raw: unknown,
): Result<TInput, ManualInputValidationError> {
  const parsed = config.schema.safeParse(raw);
  if (!parsed.success) {
    return Result.err(
      new ManualInputValidationError(parsed.error.issues.map(formatIssue)),
    );
  }
  return Result.ok(parsed.data);
}

/** One field-level validation issue surfaced by `parseManualInputValues`. */
export type ManualInputValidationIssue = {
  /** Dot-separated path into the input object, empty when the issue is global. */
  path: string;
  /** Human-readable message describing what went wrong. */
  message: string;
};

/**
 * Error thrown / returned when manual-input values fail validation against
 * the eval's `manualInput.schema`. Carries the structured Zod issues so the
 * CLI and HTTP layers can surface them per-field.
 */
export class ManualInputValidationError extends Error {
  readonly issues: ManualInputValidationIssue[];

  constructor(issues: ManualInputValidationIssue[]) {
    super(
      issues.length === 0
        ? 'manualInput validation failed'
        : `manualInput validation failed: ${issues
            .map((issue) =>
              issue.path ? `${issue.path}: ${issue.message}` : issue.message,
            )
            .join('; ')}`,
    );
    this.name = 'ManualInputValidationError';
    this.issues = issues;
  }
}

function formatIssue(issue: z.core.$ZodIssue): ManualInputValidationIssue {
  const path = issue.path
    .map((segment) =>
      typeof segment === 'string' || typeof segment === 'number'
        ? String(segment)
        : '',
    )
    .filter((segment) => segment !== '')
    .join('.');
  return { path, message: issue.message };
}
