import {
  defineEval as defineSdkEval,
  matchesEvalTags as matchesSdkEvalTags,
} from '@agent-evals/sdk';
import type {
  EvalCase as SdkEvalCase,
  EvalDefinition as SdkEvalDefinition,
  EvalOutputs,
} from '@agent-evals/sdk';
import type { AgentEvalsConfig as SharedAgentEvalsConfig } from '@agent-evals/shared';

/**
 * Augment this interface to narrow accepted tag names for
 * `@ls-stack/agent-eval` imports.
 */
export interface AgentEvalTagRegistry {
  /** Internal marker so the interface can be safely augmented by users. */
  __agentEvalTagRegistry?: never;
}

/** Tag name accepted by eval definitions, config, cases, and runtime checks. */
export type EvalTag = AgentEvalTagRegistry extends { tags: infer T }
  ? Extract<T, string>
  : string;

/** Typed input accepted by {@link matchesEvalTags}. */
export type EvalTagMatchInput =
  | EvalTag
  | { all?: EvalTag[]; any?: EvalTag[]; not?: EvalTag[] };

/** Public config type with module-augmentable eval tags. */
export type AgentEvalsConfig = Omit<SharedAgentEvalsConfig, 'tags'> & {
  /** Workspace-wide tags inherited by every eval unless removed per eval. */
  tags?: EvalTag[];
};

/** Single authored eval case with module-augmentable tags. */
export type EvalCase<TInput = unknown> = Omit<SdkEvalCase<TInput>, 'tags'> & {
  /** Additional tags applied only to this case. */
  tags?: EvalTag[];
};

/** Complete authored eval definition with module-augmentable tags. */
export type EvalDefinition<
  TInput = unknown,
  TOutputs extends EvalOutputs = EvalOutputs,
> = SdkEvalDefinition<TInput, TOutputs> & {
  /** Tags applied to every case in this eval. */
  tags?: EvalTag[];
  /** Workspace tags this eval should not inherit. */
  removeTags?: EvalTag[];
  /** Authored cases for this eval. */
  cases?: EvalCase<TInput>[] | (() => Promise<EvalCase<TInput>[]>);
};

/** Register an eval definition with typed tag support. */
export function defineEval<
  TInput = unknown,
  TOutputs extends EvalOutputs = EvalOutputs,
>(definition: EvalDefinition<TInput, TOutputs>): void {
  defineSdkEval(definition);
}

/** Return whether the active eval case has tags matching the typed input. */
export function matchesEvalTags(input: EvalTagMatchInput): boolean {
  return matchesSdkEvalTags(input);
}

export {
  cleanupStagedManualInputFiles,
  createRunner,
  isManualInputFileValue,
  materializeManualInputFiles,
  stageManualInputFile,
  stageManualInputFileFromPath,
  type EvalRunner,
  type MaterializeManualInputFilesResult,
} from '@agent-evals/runner';
export {
  z,
  getEvalRegistry,
  manualInputFileValueSchema,
  readManualInputFile,
  repoFile,
  setEvalOutput,
  appendToEvalOutput,
  incrementEvalOutput,
  mergeEvalOutput,
  evalLog,
  evalAssert,
  evalExpect,
  getEvalCaseInput,
  evalTime,
  startEvalBackgroundJob,
  nextEvalId,
  EvalAssertionError,
  runInEvalRuntimeScope,
  runInExistingEvalScope,
  runInEvalScope,
  getCurrentScope,
  isInEvalScope,
  setScopeCacheContext,
  captureEvalSpanError,
  evalTracer,
  evalSpan,
  buildTraceTree,
  deserializeCacheRecording,
  deserializeCacheValue,
  hashCacheKey,
  hashCacheKeySync,
  serializeCacheRecording,
  serializeCacheValue,
  type CaptureEvalSpanErrorLevel,
  type CaptureEvalSpanErrorOptions,
  type EvalCaseScope,
  type EvalExpectation,
  type EvalRuntimeScope,
  type CacheAdapter,
  type CacheDebugKeyWrite,
  type CacheScopeContext,
  type CacheRecordingFrame,
  type RunInEvalScopeOptions,
  type EvalColumnOverride,
  type EvalColumns,
  type EvalTraceTree,
  type EvalExecuteContext,
  type EvalSetOutput,
  type EvalOutputs,
  type EvalOutputsSchema,
  type EvalDeriveConfig,
  type EvalDeriveContext,
  type EvalDeriveFn,
  type EvalDeriveMap,
  type EvalDeriveValueFn,
  type EvalScoreContext,
  type EvalScoreFn,
  type EvalScoreDef,
  type EvalManualScoreDef,
  type EvalManualInputConfig,
  type ManualInputFieldOverride,
  type ManualInputFieldsConfig,
  type ManualInputFileValue,
  type ReadManualInputFileResult,
  type EvalCacheConfig,
  type EvalStartTime,
  type DefaultConfigKey,
  type CacheSerializationOptions,
  type CacheKeyHashInput,
  type CacheKeyHashOptions,
  type SerializedCacheValue,
  type TraceActiveSpan,
  type TraceCacheInfo,
  type TraceCacheRef,
  type TraceSpanInfo,
} from '@agent-evals/sdk';
export {
  extractApiCalls,
  extractCacheEntries,
  extractCacheHits,
  extractLlmCalls,
  getNestedAttribute,
  simulateLlmCallCost,
  simulateTokenAllocation,
} from '@agent-evals/shared';
export type {
  ApiCallEntry,
  ApiCallMetric,
  ApiCallMetricFormat,
  ApiCallMetricPlacement,
  ApiCallMetricValue,
  ApiCallsConfigInput,
  AssertionFailure,
  CacheActivityEntry,
  CacheDebugKeyEntry,
  CacheDebugKeyFile,
  CacheEntry,
  CacheEntryWithDebugKey,
  CacheFile,
  CacheHitEntry,
  CacheListItem,
  CacheMode,
  CacheOperationType,
  CacheRepairSummary,
  CacheRecording,
  CacheRecordingOp,
  CacheStatus,
  CaseDetail,
  CaseRow,
  CellValue,
  CallDerivedAttribute,
  CallDerivedAttributeContext,
  CallDerivedAttributesConfig,
  CallDerivedAttributesFn,
  ColumnDef,
  ColumnFormat,
  ColumnKind,
  ConfigReloadState,
  ConfigReloadStatus,
  CreateRunRequest,
  DerivedStatus,
  DiscoveryIssue,
  EvalChartAggregate,
  EvalChartAxis,
  EvalChartBuiltinMetric,
  EvalChartColor,
  EvalChartConfig,
  EvalChartMetric,
  EvalChartsConfig,
  EvalChartTooltipExtra,
  EvalChartType,
  EvalDisplayStatus,
  EvalFreshnessStatus,
  EvalStatAggregate,
  EvalStatItem,
  EvalStatsConfig,
  EvalSummary,
  JsonCell,
  LlmCallCostBreakdown,
  LlmCallCostCurrency,
  LlmCallEntry,
  LlmCallMetric,
  LlmCallMetricFormat,
  LlmCallMetricPlacement,
  LlmCallMetricValue,
  LlmCallPricing,
  LlmCallPricingRate,
  LlmCallPricingRegistry,
  LlmCallSimulatedTokens,
  LlmCallsConfigInput,
  LlmCostScenario,
  ManualInputDescriptor,
  ManualInputFieldDescriptor,
  ManualInputFieldKind,
  ManualInputSelectOption,
  NumberDisplayOptions,
  RemoveDefaultConfig,
  ResolvedApiCallMetric,
  ResolvedApiCallsConfig,
  ResolvedCallDerivedAttribute,
  ResolvedLlmCallCostCurrency,
  ResolvedLlmCallMetric,
  ResolvedLlmCallPricing,
  ResolvedLlmCallsConfig,
  RunLogEntry,
  RunLogLevel,
  RunLogLocation,
  RunLogPhase,
  RunLogsConfigInput,
  RunManifest,
  RunSummary,
  ScalarCell,
  ScopedCaseSummary,
  ScoreTrace,
  SerializedCacheSpan,
  SpanCacheOptions,
  SseEnvelope,
  SseEventType,
  TraceAttributeDisplay,
  TraceAttributeDisplayFormat,
  TraceAttributeDisplayInput,
  TraceAttributeDisplayPlacement,
  TraceAttributeTransform,
  TraceAttributeTransformContext,
  TraceDisplayConfig,
  TraceDisplayInputConfig,
  TrialSelectionMode,
  UpdateManualScoreRequest,
} from '@agent-evals/shared';
export { runCli } from './cli.ts';
