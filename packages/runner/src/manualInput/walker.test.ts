import type { ManualInputFieldDescriptor } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import { z } from 'zod/v4';
import {
  buildManualInputDescriptor,
  ManualInputValidationError,
  parseManualInputValues,
} from './walker.ts';

function fieldsByKey(
  fields: ManualInputFieldDescriptor[],
): Record<string, ManualInputFieldDescriptor> {
  const out: Record<string, ManualInputFieldDescriptor> = {};
  for (const field of fields) out[field.key] = field;
  return out;
}

describe('buildManualInputDescriptor', () => {
  test('rejects non-object schemas', () => {
    const result = buildManualInputDescriptor({ schema: z.string() });
    if (!result.error) throw new Error('expected error');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toContain('top-level z.object');
  });

  test('derives a text field from z.string with min/max checks and description', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({
        title: z.string().min(2).max(80).describe('Issue title'),
      }),
    });
    if (result.error) throw result.error;
    expect(result.value.fields).toMatchInlineSnapshot(`
      [
        {
          "defaultValue": undefined,
          "description": "Issue title",
          "key": "title",
          "kind": "text",
          "label": "Title",
          "maxLength": 80,
          "minLength": 2,
          "placeholder": undefined,
          "required": true,
        },
      ]
    `);
  });

  test('upgrades a string field to multiline via override and reads default value', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({ notes: z.string().default('hi') }),
      fields: { notes: { multiline: true, rows: 6, label: 'Notes' } },
    });
    if (result.error) throw result.error;
    expect(result.value.fields[0]).toMatchInlineSnapshot(`
      {
        "defaultValue": "hi",
        "description": undefined,
        "key": "notes",
        "kind": "multiline",
        "label": "Notes",
        "maxLength": undefined,
        "minLength": undefined,
        "placeholder": undefined,
        "required": true,
        "rows": 6,
      }
    `);
  });

  test('marks optional fields as not required', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({
        nick: z.string().optional(),
        alias: z.string().nullable(),
      }),
    });
    if (result.error) throw result.error;
    const byKey = fieldsByKey(result.value.fields);
    expect(byKey.nick?.required).toBe(false);
    expect(byKey.alias?.required).toBe(false);
  });

  test('derives a number field with min, max, and integer flag', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({ age: z.number().int().min(0).max(120) }),
    });
    if (result.error) throw result.error;
    expect(result.value.fields[0]).toMatchInlineSnapshot(`
      {
        "defaultValue": undefined,
        "description": undefined,
        "integer": true,
        "key": "age",
        "kind": "number",
        "label": "Age",
        "max": 120,
        "min": 0,
        "placeholder": undefined,
        "required": true,
      }
    `);
  });

  test('derives a boolean field', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({ sendEmail: z.boolean().default(false) }),
    });
    if (result.error) throw result.error;
    expect(result.value.fields[0]).toMatchInlineSnapshot(`
      {
        "defaultValue": false,
        "description": undefined,
        "key": "sendEmail",
        "kind": "boolean",
        "label": "Send email",
        "placeholder": undefined,
        "required": true,
      }
    `);
  });

  test('derives a select field from z.enum', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({ tone: z.enum(['friendly', 'formal']) }),
    });
    if (result.error) throw result.error;
    expect(result.value.fields[0]).toMatchInlineSnapshot(`
      {
        "defaultValue": undefined,
        "description": undefined,
        "key": "tone",
        "kind": "select",
        "label": "Tone",
        "options": [
          {
            "label": "friendly",
            "value": "friendly",
          },
          {
            "label": "formal",
            "value": "formal",
          },
        ],
        "placeholder": undefined,
        "required": true,
      }
    `);
  });

  test('derives a select field from a union of string literals', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({ locale: z.union([z.literal('en'), z.literal('pt')]) }),
    });
    if (result.error) throw result.error;
    expect(result.value.fields[0]).toMatchObject({
      kind: 'select',
      options: [
        { value: 'en', label: 'en' },
        { value: 'pt', label: 'pt' },
      ],
    });
  });

  test('falls back to json widget for nested objects, arrays, and unsupported unions', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({
        meta: z.object({ tag: z.string() }),
        tags: z.array(z.string()),
        weird: z.union([z.string(), z.number()]),
      }),
    });
    if (result.error) throw result.error;
    const byKey = fieldsByKey(result.value.fields);
    expect(byKey.meta?.kind).toBe('json');
    expect(byKey.tags?.kind).toBe('json');
    expect(byKey.weird?.kind).toBe('json');
  });

  test('overrides take precedence: asJson, defaultValue, options', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({ size: z.string(), payload: z.string() }),
      fields: {
        size: {
          options: ['s', { value: 'm', label: 'Medium' }],
          defaultValue: 'm',
          label: 'Shirt size',
        },
        payload: { asJson: true, rows: 8 },
      },
    });
    if (result.error) throw result.error;
    const byKey = fieldsByKey(result.value.fields);
    expect(byKey.size).toMatchObject({
      kind: 'select',
      options: [
        { value: 's', label: 's' },
        { value: 'm', label: 'Medium' },
      ],
      defaultValue: 'm',
      label: 'Shirt size',
    });
    expect(byKey.payload).toMatchObject({ kind: 'json', rows: 8 });
  });

  test('preserves field ordering from the schema shape', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({
        first: z.string(),
        second: z.string(),
        third: z.string(),
      }),
    });
    if (result.error) throw result.error;
    expect(result.value.fields.map((field) => field.key)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  test('emits a file kind descriptor when override.asFile is true', () => {
    const fileSchema = z.object({
      name: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      sha256: z.string(),
      path: z.string(),
    });
    const result = buildManualInputDescriptor({
      schema: z.object({ image: fileSchema }),
      fields: {
        image: {
          asFile: true,
          accept: 'image/*',
          maxSizeBytes: 5_000_000,
          label: 'Upload image',
          description: 'Drop, paste, or click to upload',
        },
      },
    });
    if (result.error) throw result.error;
    expect(result.value.fields[0]).toMatchInlineSnapshot(`
      {
        "accept": "image/*",
        "defaultValue": undefined,
        "description": "Drop, paste, or click to upload",
        "key": "image",
        "kind": "file",
        "label": "Upload image",
        "maxSizeBytes": 5000000,
        "placeholder": undefined,
        "required": true,
      }
    `);
  });

  test('forwards modal-level title, description, and submitLabel', () => {
    const result = buildManualInputDescriptor({
      schema: z.object({ name: z.string() }),
      title: 'Greet a user',
      description: 'Type the name and we will greet them',
      submitLabel: 'Greet',
    });
    if (result.error) throw result.error;
    expect(result.value.title).toBe('Greet a user');
    expect(result.value.description).toBe(
      'Type the name and we will greet them',
    );
    expect(result.value.submitLabel).toBe('Greet');
  });
});

describe('parseManualInputValues', () => {
  const config = {
    schema: z.object({ name: z.string().min(1), age: z.number().int().min(0) }),
  };

  test('returns the parsed value when input is valid', () => {
    const result = parseManualInputValues(config, { name: 'Ada', age: 30 });
    if (result.error) throw result.error;
    expect(result.value).toEqual({ name: 'Ada', age: 30 });
  });

  test('returns a ManualInputValidationError with field-keyed issues on failure', () => {
    const result = parseManualInputValues(config, { name: '', age: -1 });
    if (!result.error) throw new Error('expected validation failure');
    expect(result.error).toBeInstanceOf(ManualInputValidationError);
    const paths = result.error.issues.map((issue) => issue.path).toSorted();
    expect(paths).toEqual(['age', 'name']);
  });
});
