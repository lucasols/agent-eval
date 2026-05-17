import type {
  EvalColumnOverride,
  EvalColumns,
  EvalDefinition,
  EvalOutputs,
} from '@agent-evals/sdk';
import {
  extractApiCalls,
  extractLlmCalls,
  type DefaultConfigKey,
  type EvalChartsConfig,
  type EvalStatAggregate,
  type EvalStatsConfig,
  type EvalTraceSpan,
  type ResolvedApiCallsConfig,
  type ResolvedLlmCallsConfig,
} from '@agent-evals/shared';

export const DEFAULT_CONFIG_KEYS: readonly DefaultConfigKey[] = [
  'apiCalls',
  'costUsd',
  'llmTurns',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'reasoningTokens',
  'llmDurationMs',
];

type RemoveDefaultConfig = true | DefaultConfigKey[] | undefined;

const tokenNumberFormat = { notation: 'compact' } satisfies NonNullable<
  EvalColumnOverride['numberFormat']
>;

const countNumberFormat = {
  minDecimalPlaces: 0,
  maxDecimalPlaces: 0,
} satisfies NonNullable<EvalColumnOverride['numberFormat']>;

const costNumberFormat = {
  prefix: '$',
  maxDecimalPlaces: 4,
} satisfies NonNullable<EvalColumnOverride['numberFormat']>;

export const DEFAULT_COLUMNS: Record<DefaultConfigKey, EvalColumnOverride> = {
  apiCalls: {
    label: 'API Calls',
    format: 'number',
    numberFormat: countNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  costUsd: {
    label: 'Cost',
    format: 'number',
    numberFormat: costNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  llmTurns: {
    label: 'LLM Turns',
    format: 'number',
    numberFormat: countNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  inputTokens: {
    label: 'Input Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  outputTokens: {
    label: 'Output Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  totalTokens: {
    label: 'Total Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  cachedInputTokens: {
    label: 'Cached Input Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  cacheCreationInputTokens: {
    label: 'Cache Write Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  reasoningTokens: {
    label: 'Reasoning Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    hideIfNoValue: true,
  },
  llmDurationMs: {
    label: 'LLM Duration',
    format: 'duration',
    align: 'right',
    hideIfNoValue: true,
  },
};

function resolveRemovedKeys(
  globalRemove: RemoveDefaultConfig,
  evalRemove: RemoveDefaultConfig,
): Set<DefaultConfigKey> {
  if (globalRemove === true || evalRemove === true) {
    return new Set(DEFAULT_CONFIG_KEYS);
  }
  return new Set([...(globalRemove ?? []), ...(evalRemove ?? [])]);
}

export function getActiveDefaultConfigKeys(params: {
  globalRemove: RemoveDefaultConfig;
  evalRemove: RemoveDefaultConfig;
}): DefaultConfigKey[] {
  const removed = resolveRemovedKeys(params.globalRemove, params.evalRemove);
  return DEFAULT_CONFIG_KEYS.filter((key) => !removed.has(key));
}

export function mergeDefaultColumns(params: {
  globalColumns: EvalColumns | undefined;
  columns: EvalColumns | undefined;
  globalRemove: RemoveDefaultConfig;
  evalRemove: RemoveDefaultConfig;
}): EvalColumns | undefined {
  const activeKeys = getActiveDefaultConfigKeys(params);
  if (activeKeys.length === 0) {
    const merged = { ...params.globalColumns, ...params.columns };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  const defaults = Object.fromEntries(
    activeKeys.map((key) => [key, DEFAULT_COLUMNS[key]]),
  ) satisfies EvalColumns;
  return { ...defaults, ...params.globalColumns, ...params.columns };
}

export function appendDefaultStats(params: {
  globalStats: EvalStatsConfig | undefined;
  stats: EvalStatsConfig | undefined;
  globalRemove: RemoveDefaultConfig;
  evalRemove: RemoveDefaultConfig;
}): EvalStatsConfig | undefined {
  const activeKeys = new Set(getActiveDefaultConfigKeys(params));
  const defaults: EvalStatsConfig = [];

  if (activeKeys.has('apiCalls')) {
    defaults.push({
      kind: 'column',
      key: 'apiCalls',
      label: 'API Calls',
      aggregate: 'avg',
      numberFormat: countNumberFormat,
      hideIfNoValue: true,
    });
  }
  if (activeKeys.has('costUsd')) {
    defaults.push({
      kind: 'column',
      key: 'costUsd',
      label: 'LLM Cost',
      aggregate: 'avg',
      numberFormat: costNumberFormat,
      hideIfNoValue: true,
    });
  }
  if (activeKeys.has('totalTokens')) {
    defaults.push({
      kind: 'column',
      key: 'totalTokens',
      label: 'Tokens',
      aggregate: 'avg',
      numberFormat: tokenNumberFormat,
      hideIfNoValue: true,
    });
  }
  if (activeKeys.has('llmTurns')) {
    defaults.push({
      kind: 'column',
      key: 'llmTurns',
      label: 'LLM Turns',
      aggregate: 'avg',
      numberFormat: countNumberFormat,
      hideIfNoValue: true,
    });
  }

  const merged = [
    ...(params.globalStats ?? []),
    ...(params.stats ?? []),
    ...defaults,
  ];
  return merged.length > 0 ? merged : undefined;
}

export function appendDefaultCharts(params: {
  charts: EvalChartsConfig | undefined;
  globalRemove: RemoveDefaultConfig;
  evalRemove: RemoveDefaultConfig;
}): EvalChartsConfig | undefined {
  const activeKeys = new Set(getActiveDefaultConfigKeys(params));
  const defaults: EvalChartsConfig = [];

  if (activeKeys.has('costUsd')) {
    defaults.push({
      heading: 'LLM Cost',
      hideIfNoValue: true,
      dedupeConsecutiveValues: true,
      type: 'area',
      metrics: [
        {
          source: 'column',
          key: 'costUsd',
          aggregate: 'avg',
          label: 'Cost',
          color: 'warning',
        },
      ],
    });
  }

  const inputTokenMetrics = [
    activeKeys.has('inputTokens')
      ? {
          source: 'column' as const,
          key: 'inputTokens',
          aggregate: 'avg' as const,
          label: 'Input',
          color: 'accent' as const,
        }
      : null,
    activeKeys.has('cachedInputTokens')
      ? {
          source: 'column' as const,
          key: 'cachedInputTokens',
          aggregate: 'avg' as const,
          label: 'Cached Input',
          color: 'error' as const,
        }
      : null,
    activeKeys.has('cacheCreationInputTokens')
      ? {
          source: 'column' as const,
          key: 'cacheCreationInputTokens',
          aggregate: 'avg' as const,
          label: 'Cache Write',
          color: 'warning' as const,
        }
      : null,
  ].filter((metric) => metric !== null);

  if (inputTokenMetrics.length > 0) {
    defaults.push({
      heading: 'LLM Input Tokens',
      hideIfNoValue: true,
      dedupeConsecutiveValues: true,
      type: 'bar',
      metrics: inputTokenMetrics,
    });
  }

  if (activeKeys.has('outputTokens')) {
    defaults.push({
      heading: 'LLM Output Tokens',
      hideIfNoValue: true,
      dedupeConsecutiveValues: true,
      type: 'bar',
      metrics: [
        {
          source: 'column',
          key: 'outputTokens',
          aggregate: 'avg',
          label: 'Output',
          color: 'success',
        },
      ],
    });
  }

  const merged = [...(params.charts ?? []), ...defaults];
  return merged.length > 0 ? merged : undefined;
}

export function resolveEvalDefaultConfig<
  TInput,
  TOutputs extends EvalOutputs,
>(params: {
  evalDef: EvalDefinition<TInput, TOutputs>;
  globalColumns: EvalColumns | undefined;
  globalStats: EvalStatsConfig | undefined;
  globalDefaultStatAggregate: EvalStatAggregate | undefined;
  globalRemove: RemoveDefaultConfig;
}): {
  columns: EvalColumns | undefined;
  stats: EvalStatsConfig | undefined;
  defaultStatAggregate: EvalStatAggregate | undefined;
  charts: EvalChartsConfig | undefined;
} {
  const evalRemove = params.evalDef.removeDefaultConfig;
  return {
    columns: mergeDefaultColumns({
      globalColumns: params.globalColumns,
      columns: params.evalDef.columns,
      globalRemove: params.globalRemove,
      evalRemove,
    }),
    stats: appendDefaultStats({
      globalStats: params.globalStats,
      stats: params.evalDef.stats,
      globalRemove: params.globalRemove,
      evalRemove,
    }),
    defaultStatAggregate:
      params.evalDef.defaultStatAggregate ?? params.globalDefaultStatAggregate,
    charts: appendDefaultCharts({
      charts: params.evalDef.charts,
      globalRemove: params.globalRemove,
      evalRemove,
    }),
  };
}

function sumNullable(values: readonly (number | null)[]): number | undefined {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    hasValue = true;
  }
  return hasValue ? total : undefined;
}

function getMaxLlmTurns(
  calls: ReturnType<typeof extractLlmCalls>,
): number | undefined {
  if (calls.length === 0) return undefined;
  return Math.max(...calls.map((call) => Math.max(call.stepCount ?? 1, 1)));
}

function assignIfMissing(params: {
  outputs: Record<string, unknown>;
  key: DefaultConfigKey;
  value: number | undefined;
  activeKeys: Set<DefaultConfigKey>;
}): void {
  if (!params.activeKeys.has(params.key)) return;
  if (params.key in params.outputs) return;
  if (params.value === undefined) return;
  params.outputs[params.key] = params.value;
}

export function addDefaultOutputs(params: {
  outputs: Record<string, unknown>;
  spans: EvalTraceSpan[];
  llmCallsConfig: ResolvedLlmCallsConfig;
  apiCallsConfig: ResolvedApiCallsConfig;
  globalRemove: RemoveDefaultConfig;
  evalRemove: RemoveDefaultConfig;
}): void {
  const activeKeys = new Set(getActiveDefaultConfigKeys(params));
  if (activeKeys.size === 0) return;

  const calls = extractLlmCalls(params.spans, params.llmCallsConfig);
  const apiCalls = extractApiCalls(params.spans, params.apiCallsConfig);

  assignIfMissing({
    outputs: params.outputs,
    key: 'apiCalls',
    value: apiCalls.length > 0 ? apiCalls.length : undefined,
    activeKeys,
  });

  if (calls.length === 0) return;

  assignIfMissing({
    outputs: params.outputs,
    key: 'llmTurns',
    value: getMaxLlmTurns(calls),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'costUsd',
    value: sumNullable(calls.map((call) => call.costUsd)),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'inputTokens',
    value: sumNullable(calls.map((call) => call.inputTokens)),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'outputTokens',
    value: sumNullable(calls.map((call) => call.outputTokens)),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'totalTokens',
    value: sumNullable(calls.map((call) => call.totalTokens)),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'cachedInputTokens',
    value: sumNullable(calls.map((call) => call.cachedInputTokens)),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'cacheCreationInputTokens',
    value: sumNullable(calls.map((call) => call.cacheCreationInputTokens)),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'reasoningTokens',
    value: sumNullable(calls.map((call) => call.reasoningTokens)),
    activeKeys,
  });
  assignIfMissing({
    outputs: params.outputs,
    key: 'llmDurationMs',
    value: sumNullable(calls.map((call) => call.durationMs)),
    activeKeys,
  });
}
