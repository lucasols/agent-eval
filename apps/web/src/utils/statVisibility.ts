import type { EvalStatItem } from '@agent-evals/shared';

export function shouldShowStatDisplay(
  stat: EvalStatItem,
  display: { hasValue: boolean },
): boolean {
  return stat.hideIfNoValue !== true || display.hasValue;
}
