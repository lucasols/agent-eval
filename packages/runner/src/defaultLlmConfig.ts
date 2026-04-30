import type {
  EvalColumnOverride,
  EvalColumns,
  EvalDefinition,
  EvalOutputs,
} from '@agent-evals/sdk';
import {
  extractLlmCalls,
  type DefaultLLMConfigKey,
  type EvalChartsConfig,
  type EvalStatsConfig,
  type EvalTraceSpan,
  type ResolvedLlmCallsConfig,
} from '@agent-evals/shared';

export const DEFAULT_LLM_CONFIG_KEYS: readonly DefaultLLMConfigKey[] = [
  'costUsd',
  'llmTurns',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'reasoningTokens',
  'llmLatencyMs',
];

type RemoveDefaultLlmConfig = true | DefaultLLMConfigKey[] | undefined;

const tokenNumberFormat = {
  notation: 'compact',
  decimalPlaces: 1,
} satisfies NonNullable<EvalColumnOverride['numberFormat']>;

const countNumberFormat = { decimalPlaces: 0 } satisfies NonNullable<
  EvalColumnOverride['numberFormat']
>;

export const DEFAULT_LLM_COLUMNS: Record<
  DefaultLLMConfigKey,
  EvalColumnOverride
> = {
  costUsd: {
    label: 'Cost',
    format: 'number',
    numberFormat: { prefix: '$', decimalPlaces: 4 },
    align: 'right',
    sortable: true,
  },
  llmTurns: {
    label: 'LLM Turns',
    format: 'number',
    numberFormat: countNumberFormat,
    align: 'right',
    sortable: true,
  },
  inputTokens: {
    label: 'Input Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    sortable: true,
  },
  outputTokens: {
    label: 'Output Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    sortable: true,
  },
  totalTokens: {
    label: 'Total Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    sortable: true,
  },
  cachedInputTokens: {
    label: 'Cached Input Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    sortable: true,
  },
  cacheCreationInputTokens: {
    label: 'Cache Write Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    sortable: true,
  },
  reasoningTokens: {
    label: 'Reasoning Tokens',
    format: 'number',
    numberFormat: tokenNumberFormat,
    align: 'right',
    sortable: true,
  },
  llmLatencyMs: {
    label: 'LLM Latency',
    format: 'duration',
    align: 'right',
    sortable: true,
  },
};

function resolveRemovedKeys(
  globalRemove: RemoveDefaultLlmConfig,
  evalRemove: RemoveDefaultLlmConfig,
): Set<DefaultLLMConfigKey> {
  if (globalRemove === true || evalRemove === true) {
    return new Set(DEFAULT_LLM_CONFIG_KEYS);
  }
  return new Set([...(globalRemove ?? []), ...(evalRemove ?? [])]);
}

export function getActiveDefaultLlmConfigKeys(params: {
  globalRemove: RemoveDefaultLlmConfig;
  evalRemove: RemoveDefaultLlmConfig;
}): DefaultLLMConfigKey[] {
  const removed = resolveRemovedKeys(params.globalRemove, params.evalRemove);
  return DEFAULT_LLM_CONFIG_KEYS.filter((key) => !removed.has(key));
}

export function mergeDefaultLlmColumns(params: {
  columns: EvalColumns | undefined;
  globalRemove: RemoveDefaultLlmConfig;
  evalRemove: RemoveDefaultLlmConfig;
}): EvalColumns | undefined {
  const activeKeys = getActiveDefaultLlmConfigKeys(params);
  if (activeKeys.length === 0) return params.columns;

  const defaults = Object.fromEntries(
    activeKeys.map((key) => [key, DEFAULT_LLM_COLUMNS[key]]),
  ) satisfies EvalColumns;
  return { ...defaults, ...params.columns };
}

export function appendDefaultLlmStats(params: {
  stats: EvalStatsConfig | undefined;
  globalRemove: RemoveDefaultLlmConfig;
  evalRemove: RemoveDefaultLlmConfig;
}): EvalStatsConfig | undefined {
  const activeKeys = new Set(getActiveDefaultLlmConfigKeys(params));
  const defaults: EvalStatsConfig = [];

  if (activeKeys.has('costUsd')) {
    defaults.push({
      kind: 'column',
      key: 'costUsd',
      label: 'LLM Cost',
      aggregate: 'sum',
    });
  }
  if (activeKeys.has('totalTokens')) {
    defaults.push({
      kind: 'column',
      key: 'totalTokens',
      label: 'Tokens',
      aggregate: 'sum',
    });
  }
  if (activeKeys.has('llmTurns')) {
    defaults.push({
      kind: 'column',
      key: 'llmTurns',
      label: 'LLM Turns',
      aggregate: 'avg',
    });
  }
  if (activeKeys.has('llmLatencyMs')) {
    defaults.push({
      kind: 'column',
      key: 'llmLatencyMs',
      label: 'LLM Latency',
      aggregate: 'avg',
    });
  }

  const merged = [...(params.stats ?? []), ...defaults];
  return merged.length > 0 ? merged : undefined;
}

export function appendDefaultLlmCharts(params: {
  charts: EvalChartsConfig | undefined;
  globalRemove: RemoveDefaultLlmConfig;
  evalRemove: RemoveDefaultLlmConfig;
}): EvalChartsConfig | undefined {
  const activeKeys = new Set(getActiveDefaultLlmConfigKeys(params));
  const defaults: EvalChartsConfig = [];

  if (activeKeys.has('costUsd')) {
    defaults.push({
      heading: 'LLM Cost',
      type: 'area',
      metrics: [
        {
          source: 'column',
          key: 'costUsd',
          aggregate: 'sum',
          label: 'Cost',
          color: 'warning',
        },
      ],
    });
  }

  const tokenMetrics = [
    activeKeys.has('inputTokens')
      ? {
          source: 'column' as const,
          key: 'inputTokens',
          aggregate: 'sum' as const,
          label: 'Input',
          color: 'accent' as const,
        }
      : null,
    activeKeys.has('outputTokens')
      ? {
          source: 'column' as const,
          key: 'outputTokens',
          aggregate: 'sum' as const,
          label: 'Output',
          color: 'success' as const,
        }
      : null,
    activeKeys.has('reasoningTokens')
      ? {
          source: 'column' as const,
          key: 'reasoningTokens',
          aggregate: 'sum' as const,
          label: 'Reasoning',
          color: 'error' as const,
        }
      : null,
  ].filter((metric) => metric !== null);

  if (tokenMetrics.length > 0) {
    defaults.push({
      heading: 'LLM Tokens',
      type: 'bar',
      metrics: tokenMetrics,
      tooltipExtras: activeKeys.has('totalTokens')
        ? [
            {
              source: 'column',
              key: 'totalTokens',
              aggregate: 'sum',
              label: 'Total',
            },
          ]
        : undefined,
    });
  }

  const merged = [...(params.charts ?? []), ...defaults];
  return merged.length > 0 ? merged : undefined;
}

export function resolveEvalDefaultLlmConfig<
  TInput,
  TOutputs extends EvalOutputs,
>(params: {
  evalDef: EvalDefinition<TInput, TOutputs>;
  globalRemove: RemoveDefaultLlmConfig;
}): {
  columns: EvalColumns | undefined;
  stats: EvalStatsConfig | undefined;
  charts: EvalChartsConfig | undefined;
} {
  const evalRemove = params.evalDef.removeDefaultLLMConfig;
  return {
    columns: mergeDefaultLlmColumns({
      columns: params.evalDef.columns,
      globalRemove: params.globalRemove,
      evalRemove,
    }),
    stats: appendDefaultLlmStats({
      stats: params.evalDef.stats,
      globalRemove: params.globalRemove,
      evalRemove,
    }),
    charts: appendDefaultLlmCharts({
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

function assignIfMissing(params: {
  outputs: Record<string, unknown>;
  key: DefaultLLMConfigKey;
  value: number | undefined;
  activeKeys: Set<DefaultLLMConfigKey>;
}): void {
  if (!params.activeKeys.has(params.key)) return;
  if (params.key in params.outputs) return;
  if (params.value === undefined) return;
  params.outputs[params.key] = params.value;
}

export function addDefaultLlmOutputs(params: {
  outputs: Record<string, unknown>;
  spans: EvalTraceSpan[];
  llmCallsConfig: ResolvedLlmCallsConfig;
  globalRemove: RemoveDefaultLlmConfig;
  evalRemove: RemoveDefaultLlmConfig;
}): void {
  const activeKeys = new Set(getActiveDefaultLlmConfigKeys(params));
  if (activeKeys.size === 0) return;

  const calls = extractLlmCalls(params.spans, params.llmCallsConfig);
  if (calls.length === 0) return;

  assignIfMissing({
    outputs: params.outputs,
    key: 'llmTurns',
    value: calls.length,
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
    key: 'llmLatencyMs',
    value: sumNullable(calls.map((call) => call.latencyMs)),
    activeKeys,
  });
}
