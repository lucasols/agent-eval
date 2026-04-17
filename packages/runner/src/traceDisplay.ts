import type {
  EvalTraceSpan,
  TraceAttributeDisplay,
  TraceAttributeDisplayInput,
  TraceDisplayConfig,
  TraceDisplayInputConfig,
} from '@agent-evals/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getNestedAttribute(
  value: unknown,
  path: string,
): unknown {
  const parts = path.split('.');
  let current = value;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function mergeNestedAttribute(
  value: Record<string, unknown> | undefined,
  path: string,
  attributeValue: unknown,
): Record<string, unknown> {
  const root = value === undefined ? {} : { ...value };
  const parts = path.split('.');
  let current: Record<string, unknown> = root;

  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      current[part] = attributeValue;
      continue;
    }

    const nextValue = current[part];
    const nextRecord = isRecord(nextValue) ? { ...nextValue } : {};
    current[part] = nextRecord;
    current = nextRecord;
  }

  return root;
}

export function resolveTracePresentation(
  spans: EvalTraceSpan[],
  globalTraceDisplay: TraceDisplayInputConfig | undefined,
  evalTraceDisplay: TraceDisplayInputConfig | undefined,
): {
  trace: EvalTraceSpan[];
  traceDisplay: TraceDisplayConfig;
} {
  const merged = new Map<string, TraceAttributeDisplayInput>();

  for (const attribute of globalTraceDisplay?.attributes ?? []) {
    merged.set(attribute.key ?? attribute.path, attribute);
  }

  for (const attribute of evalTraceDisplay?.attributes ?? []) {
    merged.set(attribute.key ?? attribute.path, attribute);
  }

  const resolvedAttributes: TraceAttributeDisplay[] = [];
  const transformedTrace = spans.map((span) => ({
    ...span,
    attributes: span.attributes === undefined ? undefined : { ...span.attributes },
  }));

  for (const attribute of merged.values()) {
    const resolvedPath = attribute.transform ?
      `__display.${attribute.key ?? attribute.path}`
    : attribute.path;

    resolvedAttributes.push({
      key: attribute.key,
      path: resolvedPath,
      label: attribute.label,
      format: attribute.format,
      placements: attribute.placements,
      scope: attribute.scope,
      mode: attribute.mode,
    });

    if (!attribute.transform) continue;

    for (const span of transformedTrace) {
      const sourceValue = getNestedAttribute(span.attributes, attribute.path);
      if (sourceValue === undefined) continue;

      const transformedValue = attribute.transform({
        value: sourceValue,
        span,
      });

      if (transformedValue === undefined) continue;

      span.attributes = mergeNestedAttribute(
        span.attributes,
        resolvedPath,
        transformedValue,
      );
    }
  }

  return {
    trace: transformedTrace,
    traceDisplay: {
      attributes: resolvedAttributes,
    },
  };
}

export function getSpanCacheStatus(
  span: EvalTraceSpan,
): 'hit' | 'miss' | 'write' | 'bypass' | undefined {
  const nestedStatus = getNestedAttribute(span.attributes, 'cache.status');
  if (
    nestedStatus === 'hit' ||
    nestedStatus === 'miss' ||
    nestedStatus === 'write' ||
    nestedStatus === 'bypass'
  ) {
    return nestedStatus;
  }

  const flatStatus = getNestedAttribute(span.attributes, 'cacheStatus');
  if (
    flatStatus === 'hit' ||
    flatStatus === 'miss' ||
    flatStatus === 'write' ||
    flatStatus === 'bypass'
  ) {
    return flatStatus;
  }

  return undefined;
}
