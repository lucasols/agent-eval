import type { CSSProperties } from 'react';
import { colors } from '#src/style/colors';

export type TraceKindColors = {
  badgeBg: string;
  badgeText: string;
  barBg: string;
  runningStrong: string;
  runningSoft: string;
};

export type TraceKindStyle = CSSProperties & {
  '--trace-kind-badge-bg': string;
  '--trace-kind-badge-text': string;
  '--trace-kind-bar-bg': string;
  '--trace-kind-running-strong': string;
  '--trace-kind-running-soft': string;
};

const traceKindColorAssignments = new Map<string, TraceKindColors>();

function mixColor(first: string, second: string, firstPercent: number): string {
  return `color-mix(in oklab, ${first} ${String(firstPercent)}%, ${second})`;
}

function colorAlpha(value: string, percent: number): string {
  return mixColor(value, 'transparent', percent);
}

function traceKindColor(value: string): TraceKindColors {
  return {
    badgeBg: colorAlpha(value, 14),
    badgeText: value,
    barBg: colorAlpha(value, 58),
    runningStrong: colorAlpha(value, 48),
    runningSoft: colorAlpha(value, 18),
  };
}

const TRACE_KIND_COLOR_PALETTE: TraceKindColors[] = [
  traceKindColor(colors.accentDim.var),
  traceKindColor(colors.warning.var),
  traceKindColor(colors.success.var),
  traceKindColor(colors.error.var),
  traceKindColor(colors.cost.var),
  traceKindColor(mixColor(colors.accent.var, colors.warning.var, 55)),
  traceKindColor(mixColor(colors.accent.var, colors.success.var, 55)),
  traceKindColor(mixColor(colors.warning.var, colors.success.var, 50)),
  traceKindColor(mixColor(colors.error.var, colors.accent.var, 58)),
  traceKindColor(mixColor(colors.cost.var, colors.accent.var, 55)),
  traceKindColor(mixColor(colors.error.var, colors.warning.var, 50)),
  traceKindColor(mixColor(colors.success.var, colors.cost.var, 55)),
];

function getTraceKindPaletteColor(index: number): TraceKindColors {
  return (
    TRACE_KIND_COLOR_PALETTE[index % TRACE_KIND_COLOR_PALETTE.length] ??
    traceKindColor(colors.accentDim.var)
  );
}

/**
 * Resolve the color set for a span kind, assigning the next palette entry on
 * first use. Assignments persist for the page session so a given kind keeps
 * the same color across re-renders and across spans.
 */
export function getTraceKindColors(kind: string): TraceKindColors {
  const assigned = traceKindColorAssignments.get(kind);
  if (assigned !== undefined) return assigned;

  const next = getTraceKindPaletteColor(traceKindColorAssignments.size);
  traceKindColorAssignments.set(kind, next);
  return next;
}

/**
 * Build the inline style object that publishes the kind colors as CSS custom
 * properties consumed by `KindBadge`, `WaterfallBar`, and `CheckpointMarker`.
 */
export function getTraceKindStyle(kindColors: TraceKindColors): TraceKindStyle {
  return {
    '--trace-kind-badge-bg': kindColors.badgeBg,
    '--trace-kind-badge-text': kindColors.badgeText,
    '--trace-kind-bar-bg': kindColors.barBg,
    '--trace-kind-running-strong': kindColors.runningStrong,
    '--trace-kind-running-soft': kindColors.runningSoft,
  };
}
