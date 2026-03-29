import type {
  CacheMode,
  ColumnDef,
  DisplayBlock,
  EvalCostSummary,
  EvalTraceSpan,
  ScalarCell,
  RunArtifactRef,
} from '@agent-evals/shared';

export type EvalCase<TInput> = {
  id: string;
  input: TInput;
  displayInput: DisplayBlock[];
  columns?: Record<string, ScalarCell>;
  tags?: string[];
};

export type EvalTaskResult<TOutput> = {
  output: TOutput;
  displayOutput?: DisplayBlock[];
  columns?: Record<string, ScalarCell>;
  meta?: Record<string, ScalarCell>;
};

export type ScoreResult = {
  id: string;
  label?: string;
  score: number;
  pass?: boolean;
  reason?: string;
  display?: DisplayBlock[];
  columns?: Record<string, ScalarCell>;
};

export type EvalTraceTree = {
  spans: EvalTraceSpan[];
  rootSpans: EvalTraceSpan[];
  findSpan: (name: string) => EvalTraceSpan | undefined;
  findSpansByKind: (kind: string) => EvalTraceSpan[];
  flattenDfs: () => EvalTraceSpan[];
  checkpoints: Map<string, unknown>;
};

export type EvalTraceActiveSpan = {
  setInput(value: unknown): void;
  setOutput(value: unknown): void;
  setDisplay(blocks: DisplayBlock[]): void;
  setAttributes(value: Record<string, unknown>): void;
  setUsage(value: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): void;
  setCostUsd(value: number | null): void;
  setCache(value: {
    mode: CacheMode;
    status: 'hit' | 'miss' | 'write' | 'bypass';
    key?: string;
  }): void;
  addArtifact(params: {
    filePath: string;
    mimeType: string;
    fileName?: string;
  }): RunArtifactRef;
};

export type EvalTraceRecorder = {
  span<T>(
    info: {
      kind: EvalTraceSpan['kind'];
      name: string;
      attributes?: Record<string, unknown>;
    },
    fn: (span: EvalTraceActiveSpan) => Promise<T>,
  ): Promise<T>;
  checkpoint(name: string, data: unknown): void;
};

export type CacheRuntime = {
  getOrSet<T>(params: {
    namespace: string;
    keyParts: unknown;
    metadata?: Record<string, unknown>;
    producer: () => Promise<T>;
  }): Promise<{
    value: T;
    status: 'hit' | 'miss';
    key: string;
  }>;
};

export type EvalRuntimeContext = {
  cacheMode: CacheMode;
  cache: CacheRuntime;
  runId: string;
  workspaceRoot: string;
  artifactsDir: string;
};

export type EvalTaskContext<TInput> = {
  case: EvalCase<TInput>;
  input: TInput;
  signal: AbortSignal;
  trace: EvalTraceRecorder;
  runtime: EvalRuntimeContext;
};

export type EvalAssertContext<TInput, TOutput> = {
  case: EvalCase<TInput>;
  input: TInput;
  output: TOutput;
  trace: EvalTraceTree;
  scores: ScoreResult[];
  cost: EvalCostSummary;
  columns: Record<string, ScalarCell>;
};

export type EvalDefinition<TInput = unknown, TOutput = unknown> = {
  id: string;
  title?: string;
  description?: string;
  data: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>);
  columnDefs?: ColumnDef[];
  task: (ctx: EvalTaskContext<TInput>) => Promise<EvalTaskResult<TOutput>>;
  scorers?: Array<
    (ctx: {
      case: EvalCase<TInput>;
      input: TInput;
      output: TOutput;
      trace: EvalTraceTree;
      runtime: EvalRuntimeContext;
    }) => Promise<ScoreResult> | ScoreResult
  >;
  assert?: (ctx: EvalAssertContext<TInput, TOutput>) => void | Promise<void>;
  passThreshold?: number | null;
};
