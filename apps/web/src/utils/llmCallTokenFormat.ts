import type { NumberDisplayOptions } from '@agent-evals/shared';

export const LLM_CALL_EM_DASH = '—';

export const LLM_CALL_USD_COST_NUMBER_FORMAT = {
  prefix: '$',
  maxDecimalPlaces: 4,
} satisfies NumberDisplayOptions;

const compactTokenFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

const exactTokenFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

/** Compact `Intl.NumberFormat` rendering used for header token chips (e.g. `1.2M`). */
export function formatCompactTokens(value: number): string {
  return compactTokenFormatter.format(value);
}

/**
 * Locale-aware exact token rendering used inside the breakdown table and
 * tooltips so users can read precise counts with thousand separators.
 */
export function formatExactTokens(value: number): string {
  return exactTokenFormatter.format(value);
}
