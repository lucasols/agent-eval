import type { EvalColumnOverride, EvalScoreDef } from '@agent-evals/sdk';
import type {
  CellValue,
  ColumnDef,
  ColumnFormat,
  ColumnKind,
} from '@agent-evals/shared';
import { fileRefSchema, jsonCellSchema } from '@agent-evals/shared';

/**
 * Normalize a user-provided score definition (either a function or an
 * object literal with `compute`/`passThreshold`/`label`) to a common
 * shape used internally.
 */
export function normalizeScoreDef<TInput>(def: EvalScoreDef<TInput>): {
  compute: (ctx: {
    input: TInput;
    outputs: Record<string, unknown>;
    case: { id: string; input: TInput; tags?: string[] };
  }) => number | Promise<number>;
  passThreshold: number | undefined;
  label: string | undefined;
} {
  if (typeof def === 'function') {
    return { compute: def, passThreshold: undefined, label: undefined };
  }
  return {
    compute: def.compute,
    passThreshold: def.passThreshold,
    label: def.label,
  };
}

/**
 * Populate `target` with `ColumnDef` entries for any keys in `columns`
 * that aren't already present, applying user-supplied `overrides` and
 * flagging score columns declared via `scores`.
 */
export function mergeColumnDefs<TInput>(
  target: Map<string, ColumnDef>,
  columns: Record<string, CellValue>,
  overrides: Record<string, EvalColumnOverride> | undefined,
  scores: Record<string, EvalScoreDef<TInput>> | undefined,
): void {
  const scoreKeys = new Set(Object.keys(scores ?? {}));
  const overrideMap = overrides ?? {};

  for (const [key, value] of Object.entries(columns)) {
    if (target.has(key)) continue;
    const override = overrideMap[key];
    target.set(
      key,
      createColumnDef({
        key,
        override,
        scoreDef: scores?.[key],
        inferredKind: inferKind(value),
        isScore: scoreKeys.has(key),
      }),
    );
  }
}

/**
 * Build the column definitions declared directly on an eval before any runtime
 * output values exist. This lets discovery metadata describe authored rich
 * output columns even for runs created by another process.
 */
export function buildDeclaredColumnDefs<TInput>(
  overrides: Record<string, EvalColumnOverride> | undefined,
  scores: Record<string, EvalScoreDef<TInput>> | undefined,
): ColumnDef[] {
  const declaredDefs = new Map<string, ColumnDef>();

  for (const [key, override] of Object.entries(overrides ?? {})) {
    declaredDefs.set(
      key,
      createColumnDef({
        key,
        override,
        scoreDef: scores?.[key],
        inferredKind:
          inferKindFromFormat(override.format) ??
          (override.numberFormat === undefined ? undefined : 'number'),
        isScore: scores?.[key] !== undefined,
      }),
    );
  }

  for (const [key, scoreDef] of Object.entries(scores ?? {})) {
    if (declaredDefs.has(key)) continue;
    declaredDefs.set(
      key,
      createColumnDef({ key, scoreDef, inferredKind: 'number', isScore: true }),
    );
  }

  return [...declaredDefs.values()];
}

/** Infer a `ColumnKind` from a runtime value when no override is set. */
export function inferKind(value: unknown): ColumnKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Coerce an arbitrary runtime value into a serializable `CellValue`.
 * Non-primitive values fall back to `JSON.stringify`.
 */
export function toCellValue(
  value: unknown,
  override: EvalColumnOverride | undefined = undefined,
): CellValue | undefined {
  if (value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value === undefined) return undefined;
  if (
    override?.format === 'image' ||
    override?.format === 'audio' ||
    override?.format === 'video' ||
    override?.format === 'file'
  ) {
    const parsed = fileRefSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  if (override?.format === 'json') {
    const parsed = jsonCellSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return JSON.stringify(value);
}

function inferKindFromFormat(
  format: ColumnFormat | undefined,
): ColumnKind | undefined {
  if (format === 'boolean') {
    return 'boolean';
  }
  if (
    format === 'duration' ||
    format === 'percent' ||
    format === 'number'
  ) {
    return 'number';
  }
  if (format === undefined) return undefined;
  return 'string';
}

function createColumnDef<TInput>(params: {
  key: string;
  override?: EvalColumnOverride;
  scoreDef?: EvalScoreDef<TInput>;
  inferredKind: ColumnKind | undefined;
  isScore: boolean;
}): ColumnDef {
  const { key, override, scoreDef, inferredKind, isScore } = params;
  const kind = inferredKind ?? (isScore ? 'number' : 'string');
  const def: ColumnDef = { key, label: override?.label ?? key, kind };
  if (override?.format !== undefined) def.format = override.format;
  if (override?.numberFormat !== undefined) def.numberFormat = override.numberFormat;
  if (override?.hideInTable !== undefined) def.hideInTable = override.hideInTable;
  if (override?.sortable !== undefined) def.sortable = override.sortable;
  if (override?.align !== undefined) def.align = override.align;
  if (!isScore) return def;

  def.isScore = true;
  if (typeof scoreDef === 'function' || scoreDef === undefined) {
    return def;
  }
  if (scoreDef.passThreshold !== undefined) {
    def.passThreshold = scoreDef.passThreshold;
  }
  if (scoreDef.label !== undefined && override?.label === undefined) {
    def.label = scoreDef.label;
  }
  return def;
}
