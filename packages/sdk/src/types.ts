import type {
  ColumnFormat,
  ColumnKind,
  EvalTraceSpan,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';

export type EvalCase<TInput> = {
  id: string;
  input: TInput;
  tags?: string[];
};

export type EvalColumnOverride = {
  label?: string;
  format?: ColumnFormat;
  primary?: boolean;
  defaultVisible?: boolean;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  kind?: ColumnKind;
};

export type EvalColumns = Record<string, EvalColumnOverride>;

export type EvalTraceTree = {
  spans: EvalTraceSpan[];
  rootSpans: EvalTraceSpan[];
  findSpan: (name: string) => EvalTraceSpan | undefined;
  findSpansByKind: (kind: EvalTraceSpan['kind']) => EvalTraceSpan[];
  flattenDfs: () => EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
};

export type EvalExecuteContext<TInput> = {
  input: TInput;
  signal: AbortSignal;
};

export type EvalDeriveContext<TInput> = {
  trace: EvalTraceTree;
  input: TInput;
  case: EvalCase<TInput>;
};

export type EvalScoreContext<TInput> = {
  input: TInput;
  outputs: Record<string, unknown>;
  case: EvalCase<TInput>;
};

export type EvalScoreFn<TInput> = (
  ctx: EvalScoreContext<TInput>,
) => number | Promise<number>;

export type EvalScoreDef<TInput> =
  | EvalScoreFn<TInput>
  | {
      compute: EvalScoreFn<TInput>;
      passThreshold?: number;
      label?: string;
    };

export type EvalDefinition<TInput = unknown> = {
  id: string;
  title?: string;
  description?: string;
  cases?: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>);
  columns?: EvalColumns;
  traceDisplay?: TraceDisplayInputConfig;
  execute: (ctx: EvalExecuteContext<TInput>) => Promise<void> | void;
  deriveFromTracing?: (
    ctx: EvalDeriveContext<TInput>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  scores?: Record<string, EvalScoreDef<TInput>>;
  passThreshold?: number | null;
};
