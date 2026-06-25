import type {
  EvalColumnOverride,
  EvalManualScoreDef,
  EvalOutputs,
  EvalScoreDef,
} from '@agent-evals/sdk';
import { serializeCacheValue } from '@agent-evals/sdk';
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
export function normalizeScoreDef<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
>(
  def: EvalScoreDef<TInput, TOutputs>,
): {
  compute: (ctx: {
    input: TInput;
    outputs: TOutputs;
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

function getScoreOverride<TInput, TOutputs extends EvalOutputs = EvalOutputs>(
  def: EvalScoreDef<TInput, TOutputs> | undefined,
): EvalColumnOverride | undefined {
  if (def === undefined || typeof def === 'function') return undefined;
  return {
    label: def.label,
    description: def.description,
    format: def.format,
    numberFormat: def.numberFormat,
    hideInTable: def.hideInTable,
    hideIfNoValue: def.hideIfNoValue,
    align: def.align,
    maxStars: def.maxStars,
  };
}

function mergeOverrides(
  base: EvalColumnOverride | undefined,
  override: EvalColumnOverride | undefined,
): EvalColumnOverride | undefined {
  if (base === undefined) return override;
  if (override === undefined) return base;
  return {
    label: override.label ?? base.label,
    description: override.description ?? base.description,
    format: override.format ?? base.format,
    numberFormat: override.numberFormat ?? base.numberFormat,
    hideInTable: override.hideInTable ?? base.hideInTable,
    hideIfNoValue: override.hideIfNoValue ?? base.hideIfNoValue,
    align: override.align ?? base.align,
    maxStars: override.maxStars ?? base.maxStars,
  };
}

/**
 * Populate `target` with `ColumnDef` entries for any keys in `columns`
 * that aren't already present, applying user-supplied `overrides` and
 * flagging score columns declared via `scores`.
 */
export function mergeColumnDefs<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
>(
  target: Map<string, ColumnDef>,
  columns: Record<string, CellValue>,
  overrides: Record<string, EvalColumnOverride> | undefined,
  scores: Record<string, EvalScoreDef<TInput, TOutputs>> | undefined,
  manualScores: Record<string, EvalManualScoreDef> | undefined,
): void {
  const scoreKeys = new Set(Object.keys(scores ?? {}));
  const manualScoreKeys = new Set(Object.keys(manualScores ?? {}));
  const overrideMap = overrides ?? {};

  for (const [key, value] of Object.entries(columns)) {
    if (target.has(key)) continue;
    const override = mergeOverrides(
      getScoreOverride(scores?.[key]) ?? manualScores?.[key],
      overrideMap[key],
    );
    const isScore = scoreKeys.has(key) || manualScoreKeys.has(key);
    target.set(
      key,
      createColumnDef({
        key,
        override,
        scoreDef: scores?.[key],
        manualScoreDef: manualScores?.[key],
        inferredKind: isScore ? 'number' : inferKind(value),
        isScore,
        isManualScore: manualScoreKeys.has(key),
      }),
    );
  }
}

/**
 * Build the column definitions declared directly on an eval before any runtime
 * output values exist. This lets discovery metadata describe authored rich
 * output columns even for runs created by another process.
 */
export function buildDeclaredColumnDefs<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
>(
  overrides: Record<string, EvalColumnOverride> | undefined,
  scores: Record<string, EvalScoreDef<TInput, TOutputs>> | undefined,
  manualScores: Record<string, EvalManualScoreDef> | undefined,
): ColumnDef[] {
  const declaredDefs = new Map<string, ColumnDef>();

  for (const [key, override] of Object.entries(overrides ?? {})) {
    const isScore =
      scores?.[key] !== undefined || manualScores?.[key] !== undefined;
    const mergedOverride = mergeOverrides(
      getScoreOverride(scores?.[key]) ?? manualScores?.[key],
      override,
    );
    declaredDefs.set(
      key,
      createColumnDef({
        key,
        override: mergedOverride,
        scoreDef: scores?.[key],
        manualScoreDef: manualScores?.[key],
        inferredKind:
          inferKindFromFormat(mergedOverride?.format) ??
          (mergedOverride?.numberFormat === undefined ? undefined : 'number'),
        isScore,
        isManualScore: manualScores?.[key] !== undefined,
      }),
    );
  }

  for (const [key, scoreDef] of Object.entries(scores ?? {})) {
    if (declaredDefs.has(key)) continue;
    declaredDefs.set(
      key,
      createColumnDef({
        key,
        override: getScoreOverride(scoreDef),
        scoreDef,
        inferredKind: 'number',
        isScore: true,
        isManualScore: false,
      }),
    );
  }

  for (const [key, manualScoreDef] of Object.entries(manualScores ?? {})) {
    if (declaredDefs.has(key)) continue;
    declaredDefs.set(
      key,
      createColumnDef({
        key,
        override: manualScoreDef,
        manualScoreDef,
        inferredKind: 'number',
        isScore: true,
        isManualScore: true,
      }),
    );
  }

  return [...declaredDefs.values()];
}

/**
 * Build runtime column definitions from output-level display overrides.
 *
 * These definitions are persisted on case rows/details so `setOutput(...)`
 * can format one-off outputs without adding them to eval discovery metadata.
 */
export function buildRuntimeOutputColumnDefs(
  columns: Record<string, CellValue>,
  overrides: Record<string, EvalColumnOverride>,
  configuredColumnKeys: ReadonlySet<string> = new Set(),
): ColumnDef[] {
  return Object.entries(overrides)
    .filter(
      ([key]) => columns[key] !== undefined && !configuredColumnKeys.has(key),
    )
    .map(([key, override]) =>
      createColumnDef({
        key,
        override,
        inferredKind:
          inferKindFromFormat(override.format) ??
          (override.numberFormat === undefined
            ? inferKind(columns[key])
            : 'number'),
        isScore: false,
        isManualScore: false,
      }),
    );
}

/** Build the display definition used for a highlighted input section. */
export function buildInputSectionDef(params: {
  key: string;
  value: CellValue;
  override: EvalColumnOverride | undefined;
}): ColumnDef {
  const { key, value, override } = params;
  return createColumnDef({
    key,
    override,
    inferredKind:
      inferKindFromFormat(override?.format) ??
      (override?.numberFormat === undefined ? inferKind(value) : 'number'),
    isScore: false,
    isManualScore: false,
  });
}

/** Infer a `ColumnKind` from a runtime value when no override is set. */
export function inferKind(value: unknown): ColumnKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Coerce an arbitrary runtime value into a serializable `CellValue`.
 * Runtime values use the SDK's tagged serializer so saved run artifacts keep
 * structured data instead of storing JSON strings. Native binary/file root
 * values are handled before this helper.
 */
export async function toCellValue(
  value: unknown,
): Promise<CellValue | undefined> {
  const fileRef = fileRefSchema.safeParse(value);
  if (fileRef.success) return fileRef.data;

  const serialized = await serializeCacheValue(value, { compress: false });
  const parsed = jsonCellSchema.safeParse(serialized);
  if (parsed.success) return parsed.data;

  return undefined;
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
    format === 'number' ||
    format === 'passFail' ||
    format === 'stars'
  ) {
    return 'number';
  }
  if (format === undefined) return undefined;
  return 'string';
}

function createColumnDef<
  TInput,
  TOutputs extends EvalOutputs = EvalOutputs,
>(params: {
  key: string;
  override?: EvalColumnOverride;
  scoreDef?: EvalScoreDef<TInput, TOutputs>;
  manualScoreDef?: EvalManualScoreDef;
  inferredKind: ColumnKind | undefined;
  isScore: boolean;
  isManualScore: boolean;
}): ColumnDef {
  const {
    key,
    override,
    scoreDef,
    manualScoreDef,
    inferredKind,
    isScore,
    isManualScore,
  } = params;
  const kind = inferredKind ?? (isScore ? 'number' : 'string');
  const def: ColumnDef = { key, label: override?.label ?? key, kind };
  if (override?.description !== undefined)
    def.description = override.description;
  if (override?.format !== undefined) def.format = override.format;
  if (override?.numberFormat !== undefined)
    def.numberFormat = override.numberFormat;
  if (override?.maxStars !== undefined) def.maxStars = override.maxStars;
  if (override?.hideInTable !== undefined)
    def.hideInTable = override.hideInTable;
  if (override?.hideIfNoValue !== undefined)
    def.hideIfNoValue = override.hideIfNoValue;
  if (override?.align !== undefined) def.align = override.align;
  if (!isScore) return def;

  def.isScore = true;
  if (isManualScore) {
    def.isManualScore = true;
    if (manualScoreDef?.passThreshold !== undefined) {
      def.passThreshold = manualScoreDef.passThreshold;
    }
    return def;
  }
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
