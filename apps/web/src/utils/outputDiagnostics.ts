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

export function findDiagnosticOutputKey(
  value: unknown,
  rootKey?: string,
): string | undefined {
  const rootSignal =
    rootKey === undefined ? undefined : getOutputDiagnosticSignal(rootKey);
  if (rootSignal !== undefined) return rootSignal;
  return findDiagnosticKeyInValue(value, 0);
}

export function formatDiagnosticOutputTooltip(
  key: string,
  label: string,
): string {
  return `Output "${label}" may contain a diagnostic key: "${key}".`;
}

function findDiagnosticKeyInValue(
  value: unknown,
  depth: number,
): string | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const signal = findDiagnosticKeyInValue(item, depth + 1);
      if (signal !== undefined) return signal;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    const signal = getOutputDiagnosticSignal(key);
    if (signal !== undefined) return signal;
    const childSignal = findDiagnosticKeyInValue(child, depth + 1);
    if (childSignal !== undefined) return childSignal;
  }
  return undefined;
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
