const outputDiagnosticSignals = [
  'error',
  'errors',
  'warning',
  'warnings',
  'failure',
  'failures',
  'failed',
  'fail',
  'exception',
  'exceptions',
  'issue',
  'issues',
  'problem',
  'problems',
] as const;

export type DiagnosticOutputMatch = {
  key: string;
  path: string;
  value: unknown;
  valueText: string;
};

export function findDiagnosticOutputKey(
  value: unknown,
  rootKey?: string,
): string | undefined {
  return findDiagnosticOutputMatch(value, rootKey)?.key;
}

export function findDiagnosticOutputMatch(
  value: unknown,
  rootKey?: string,
): DiagnosticOutputMatch | undefined {
  const rootSignal =
    rootKey === undefined ? undefined : getOutputDiagnosticSignal(rootKey);
  if (rootSignal !== undefined && hasMeaningfulDiagnosticValue(value)) {
    return toDiagnosticOutputMatch(rootSignal, rootSignal, value);
  }
  return findDiagnosticKeyInValue(value, 0, '');
}

export function formatDiagnosticOutputTooltip(
  match: DiagnosticOutputMatch,
  label: string,
): string {
  return `Output "${label}" may contain a diagnostic key at "${match.path}": ${match.valueText}.`;
}

function findDiagnosticKeyInValue(
  value: unknown,
  depth: number,
  path: string,
): DiagnosticOutputMatch | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const signal = findDiagnosticKeyInValue(
        item,
        depth + 1,
        `${path}[${String(index)}]`,
      );
      if (signal !== undefined) return signal;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    const signal = getOutputDiagnosticSignal(key);
    if (signal !== undefined && hasMeaningfulDiagnosticValue(child)) {
      return toDiagnosticOutputMatch(signal, childPath, child);
    }
    const childSignal = findDiagnosticKeyInValue(child, depth + 1, childPath);
    if (childSignal !== undefined) return childSignal;
  }
  return undefined;
}

export function formatDiagnosticOutputMessage(
  match: DiagnosticOutputMatch,
): string {
  return `Output may contain a diagnostic key at "${match.path}" with value ${match.valueText}.`;
}

function getOutputDiagnosticSignal(key: string): string | undefined {
  const normalized = key.toLowerCase().replaceAll(/[^a-z]/g, '');
  const hasDiagnosticSignal = outputDiagnosticSignals.some((signal) =>
    normalized.includes(signal),
  );
  return hasDiagnosticSignal ? key : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMeaningfulDiagnosticValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulDiagnosticValue);
  if (isRecord(value)) {
    return Object.values(value).some(hasMeaningfulDiagnosticValue);
  }
  return Boolean(value);
}

function toDiagnosticOutputMatch(
  key: string,
  path: string,
  value: unknown,
): DiagnosticOutputMatch {
  return { key, path, value, valueText: stringifyDiagnosticValue(value) };
}

function stringifyDiagnosticValue(value: unknown): string {
  if (typeof value === 'function') {
    return value.name ? `[function ${value.name}]` : '[function]';
  }
  if (typeof value === 'symbol') return String(value);
  return JSON.stringify(value);
}
