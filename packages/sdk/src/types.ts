import type {
  ColumnFormat,
  ColumnKind,
  EvalTraceSpan,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';

/** Single authored eval case with its stable identifier and input payload. */
export type EvalCase<TInput> = {
  id: string;
  input: TInput;
  tags?: string[];
};

/** UI overrides for a derived or scored column emitted by an eval. */
export type EvalColumnOverride = {
  label?: string;
  format?: ColumnFormat;
  primary?: boolean;
  defaultVisible?: boolean;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  kind?: ColumnKind;
};

/** Column override map keyed by output or score field name. */
export type EvalColumns = Record<string, EvalColumnOverride>;

/** Query helpers built from the flattened trace recorded for one eval case. */
export type EvalTraceTree = {
  spans: EvalTraceSpan[];
  rootSpans: EvalTraceSpan[];
  findSpan: (name: string) => EvalTraceSpan | undefined;
  findSpansByKind: (kind: EvalTraceSpan['kind']) => EvalTraceSpan[];
  flattenDfs: () => EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
};

/** Context passed to an eval's `execute` function for a single case run. */
export type EvalExecuteContext<TInput> = {
  input: TInput;
  signal: AbortSignal;
};

/** Context passed to `deriveFromTracing` after execution has completed. */
export type EvalDeriveContext<TInput> = {
  trace: EvalTraceTree;
  input: TInput;
  case: EvalCase<TInput>;
};

/** Context passed to score functions after outputs have been collected. */
export type EvalScoreContext<TInput> = {
  input: TInput;
  outputs: Record<string, unknown>;
  case: EvalCase<TInput>;
};

/** Score callback that computes a numeric result for one case. */
export type EvalScoreFn<TInput> = (
  ctx: EvalScoreContext<TInput>,
) => number | Promise<number>;

/** Score definition accepted by `defineEval`, with optional UI metadata. */
export type EvalScoreDef<TInput> =
  | EvalScoreFn<TInput>
  | {
      compute: EvalScoreFn<TInput>;
      passThreshold?: number;
      label?: string;
    };

/** Complete authored eval definition consumed by `defineEval`. */
export type EvalDefinition<TInput = unknown> = {
  id: string;
  title?: string;
  description?: string;
  cases?: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>);
  columns?: EvalColumns;
  /**
   * Per-eval trace attribute display rules for the UI.
   *
   * These are merged with the global `AgentEvalsConfig.traceDisplay` rules.
   * Matching entries override the global rule by `key`, or by `path` when no
   * `key` is provided.
   */
  traceDisplay?: TraceDisplayInputConfig;
  execute: (ctx: EvalExecuteContext<TInput>) => Promise<void> | void;
  deriveFromTracing?: (
    ctx: EvalDeriveContext<TInput>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  scores?: Record<string, EvalScoreDef<TInput>>;
  passThreshold?: number | null;
};
