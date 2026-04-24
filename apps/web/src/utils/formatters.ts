import type { ColumnDef, NumberDisplayOptions } from '@agent-evals/shared';

export function formatNumber(
  value: number | null | undefined,
  options: NumberDisplayOptions | undefined = undefined,
): string {
  if (value === null || value === undefined) return '\u2014';
  const rendered =
    options?.notation === 'compact'
      ? new Intl.NumberFormat(undefined, {
          notation: 'compact',
          compactDisplay: options.compactDisplay ?? 'short',
          ...(options.decimalPlaces === undefined
            ? {}
            : {
                maximumFractionDigits: options.decimalPlaces,
                minimumFractionDigits: options.decimalPlaces,
              }),
        }).format(value)
      : options?.decimalPlaces === undefined
        ? String(value)
        : value.toFixed(options.decimalPlaces);
  return `${options?.prefix ?? ''}${rendered}${options?.suffix ?? ''}`;
}

/**
 * Render a numeric cell value using the column's declared format. Falls back
 * to `formatScore` for score columns without a format, and `String(value)`
 * otherwise. Keeps stat/cell rendering visually consistent across the UI.
 */
export function formatNumericCellValue(c: ColumnDef, value: number): string {
  if (c.format === 'number') return formatNumber(value, c.numberFormat);
  if (c.format === 'duration') return formatDuration(value);
  if (c.format === 'percent') return formatPercent(value);
  if (c.format === 'passFail') return formatPassFail(value);
  if (c.format === 'stars') return formatStars(value, c.maxStars);
  if (c.isScore === true) return formatScore(value);
  return String(value);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '\u2014';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return value.toFixed(2);
}

export function formatPassFail(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return value >= 0.5 ? 'pass' : 'fail';
}

export function getMaxStars(maxStars: number | undefined): number {
  if (maxStars === undefined) return 5;
  if (!Number.isFinite(maxStars)) return 5;
  return Math.max(2, Math.floor(maxStars));
}

export function valueToStars(
  value: number | null | undefined,
  maxStars: number | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  return Math.max(
    0,
    Math.min(getMaxStars(maxStars), Math.round(value * getMaxStars(maxStars))),
  );
}

export function starsToValue(
  stars: number,
  maxStars: number | undefined,
): number {
  return Math.max(0, Math.min(1, stars / getMaxStars(maxStars)));
}

export function formatStars(
  value: number | null | undefined,
  maxStars: number | undefined,
): string {
  const stars = valueToStars(value, maxStars);
  if (stars === null) return '\u2014';
  return `${stars}/${String(getMaxStars(maxStars))}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return `${Math.round(value * 100)}%`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday ${time}`;
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${date} ${time}`;
}
