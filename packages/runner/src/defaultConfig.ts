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
  'llmLatencyMs',
];

type RemoveDefaultConfig = true | DefaultConfigKey[] | undefined;

const tokenNumberFormat = {
  notation: 'compact',
  decimalPlaces: 1,
} satisfies NonNullable<EvalColumnOverride['numberFormat']>;

const countNumberFormat = { decimalPlaces: 0 } satisfies NonNullable<
  EvalColumnOverride['numberFormat']
>;

export const DEFAULT_COLUMNS: Record<DefaultConfigKey, EvalColumnOverride> = {
  apiCalls: {
    label: 'API Calls',
    format: 'number',
    numberFormat: countNumberFormat,
    align: 'right',
    sortable: true,
  },
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
  columns: EvalColumns | undefined;
  globalRemove: RemoveDefaultConfig;
  evalRemove: RemoveDefaultConfig;
}): EvalColumns | undefined {
  const activeKeys = getActiveDefaultConfigKeys(params);
  if (activeKeys.length === 0) return params.columns;

  const defaults = Object.fromEntries(
    activeKeys.map((key) => [key, DEFAULT_COLUMNS[key]]),
  ) satisfies EvalColumns;
  return { ...defaults, ...params.columns };
}

export function appendDefaultStats(params: {
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
    });
  }
  if (activeKeys.has('costUsd')) {
    defaults.push({
      kind: 'column',
      key: 'costUsd',
      label: 'LLM Cost',
      aggregate: 'avg',
    });
  }
  if (activeKeys.has('totalTokens')) {
    defaults.push({
      kind: 'column',
      key: 'totalTokens',
      label: 'Tokens',
      aggregate: 'avg',
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

  const merged = [...(params.stats ?? []), ...defaults];
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

export function resolveEvalDefaultConfig<
  TInput,
  TOutputs extends EvalOutputs,
>(params: {
  evalDef: EvalDefinition<TInput, TOutputs>;
  globalRemove: RemoveDefaultConfig;
}): {
  columns: EvalColumns | undefined;
  stats: EvalStatsConfig | undefined;
  charts: EvalChartsConfig | undefined;
} {
  const evalRemove = params.evalDef.removeDefaultConfig;
  return {
    columns: mergeDefaultColumns({
      columns: params.evalDef.columns,
      globalRemove: params.globalRemove,
      evalRemove,
    }),
    stats: appendDefaultStats({
      stats: params.evalDef.stats,
      globalRemove: params.globalRemove,
      evalRemove,
    }),
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
