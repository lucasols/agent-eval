import type {
  EvalTraceSpan,
  TraceAttributeDisplay,
  TraceAttributeDisplayPlacement,
  TraceDisplayConfig,
} from '@agent-evals/shared';
import { formatCost, formatDuration } from './formatters.ts';

type TraceAttributeItem = {
  config: TraceAttributeDisplay;
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPlacements(
  config: TraceAttributeDisplay,
): TraceAttributeDisplayPlacement[] {
  return config.placements ?? ['detail'];
}

function getScope(config: TraceAttributeDisplay): 'self' | 'subtree' {
  return config.scope ?? 'self';
}

function getMode(config: TraceAttributeDisplay): 'all' | 'last' | 'sum' {
  return config.mode ?? 'all';
}

export function getTraceAttributeValue(
  span: EvalTraceSpan,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = span.attributes;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function collectSubtreeSpans(
  span: EvalTraceSpan,
  spans: EvalTraceSpan[],
): EvalTraceSpan[] {
  const childrenByParentId = new Map<string | null, EvalTraceSpan[]>();

  for (const currentSpan of spans) {
    const siblings = childrenByParentId.get(currentSpan.parentId) ?? [];
    siblings.push(currentSpan);
    childrenByParentId.set(currentSpan.parentId, siblings);
  }

  const subtreeSpans: EvalTraceSpan[] = [];
  const stack = [span];

  while (stack.length > 0) {
    const currentSpan = stack.pop();
    if (!currentSpan) continue;
    subtreeSpans.push(currentSpan);

    for (const child of childrenByParentId.get(currentSpan.id) ?? []) {
      stack.push(child);
    }
  }

  return subtreeSpans;
}

function resolveTraceAttributeValue(
  span: EvalTraceSpan,
  spans: EvalTraceSpan[],
  config: TraceAttributeDisplay,
): unknown {
  const candidateSpans =
    getScope(config) === 'subtree' ? collectSubtreeSpans(span, spans) : [span];
  const values = candidateSpans
    .map((currentSpan) => getTraceAttributeValue(currentSpan, config.path))
    .filter((value) => value !== undefined);

  const mode = getMode(config);
  if (mode === 'last') {
    return values.at(-1);
  }

  if (mode === 'sum') {
    const numbers = values.filter(
      (value): value is number => typeof value === 'number',
    );
    if (numbers.length === 0) return undefined;
    return numbers.reduce((total, value) => total + value, 0);
  }

  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

export function getTraceAttributeItems(
  span: EvalTraceSpan,
  spans: EvalTraceSpan[],
  traceDisplay: TraceDisplayConfig,
  placement: TraceAttributeDisplayPlacement,
): TraceAttributeItem[] {
  const items: TraceAttributeItem[] = [];

  for (const config of traceDisplay.attributes ?? []) {
    if (!getPlacements(config).includes(placement)) continue;
    const value = resolveTraceAttributeValue(span, spans, config);
    if (value === undefined) continue;
    items.push({ config, value });
  }

  return items;
}

export function formatTraceAttributeValue(
  value: unknown,
  format: TraceAttributeDisplay['format'],
): string {
  if (value === undefined) return '';

  if (format === 'usd') {
    return formatCost(typeof value === 'number' ? value : null);
  }

  if (format === 'duration') {
    return formatDuration(typeof value === 'number' ? value : null);
  }

  if (format === 'number') {
    return typeof value === 'number' ? String(value) : JSON.stringify(value);
  }

  if (format === 'json') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => formatTraceAttributeValue(item, format))
      .join(', ');
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}
