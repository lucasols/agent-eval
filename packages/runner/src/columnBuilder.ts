import type { EvalColumnOverride, EvalScoreDef } from '@agent-evals/sdk';
import type { CellValue, ColumnDef, ColumnKind } from '@agent-evals/shared';
import { cellValueSchema } from '@agent-evals/shared';

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
    const kind: ColumnKind = override?.kind ?? inferKind(value);
    const def: ColumnDef = { key, label: override?.label ?? key, kind };
    if (override?.format !== undefined) def.format = override.format;
    if (override?.primary !== undefined) def.primary = override.primary;
    if (override?.defaultVisible !== undefined)
      def.defaultVisible = override.defaultVisible;
    if (override?.sortable !== undefined) def.sortable = override.sortable;
    if (override?.align !== undefined) def.align = override.align;
    if (scoreKeys.has(key)) {
      def.isScore = true;
      const scoreDef = scores?.[key];
      if (scoreDef && typeof scoreDef !== 'function') {
        if (scoreDef.passThreshold !== undefined) {
          def.passThreshold = scoreDef.passThreshold;
        }
        if (scoreDef.label !== undefined && override?.label === undefined) {
          def.label = scoreDef.label;
        }
      }
    }
    target.set(key, def);
  }
}

/** Infer a `ColumnKind` from a runtime value when no override is set. */
export function inferKind(value: unknown): ColumnKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'blocks';
  return 'string';
}

/**
 * Coerce an arbitrary runtime value into a serializable `CellValue`.
 * Non-primitive, non-array values fall back to `JSON.stringify`.
 */
export function toCellValue(value: unknown): CellValue | undefined {
  if (value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const parsed = cellValueSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    return JSON.stringify(value);
  }
  if (value === undefined) return undefined;
  return JSON.stringify(value);
}
