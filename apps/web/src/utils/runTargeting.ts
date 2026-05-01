/** Run target subset that's enough to decide whether one eval is targeted. */
type EvalRunTargetLike = { mode: string; evalKeys?: string[] };

/**
 * Returns whether a run's target includes a specific eval key. `mode: 'all'`
 * always matches; `mode: 'evalIds'` matches when the eval's key is in the
 * `evalKeys` list. Other modes match nothing for now.
 */
export function runTargetsEval(
  target: EvalRunTargetLike,
  evalKey: string,
): boolean {
  return (
    target.mode === 'all' ||
    (target.mode === 'evalIds' && (target.evalKeys?.includes(evalKey) ?? false))
  );
}
