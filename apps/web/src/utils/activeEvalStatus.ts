import type { CaseRow, RunManifest } from '@agent-evals/shared';

export type ActiveEvalStatus = 'running' | 'enqueued' | null;

type ActiveRun = {
  manifest: Pick<RunManifest, 'status' | 'target'>;
  cases: CaseRow[];
};

export function targetIncludesEval(
  target: { mode: string; evalIds?: string[]; evalKeys?: string[] },
  evalKey: string,
): boolean {
  if (target.mode === 'all') return true;
  if (target.mode === 'evalIds') {
    return target.evalKeys?.includes(evalKey) ?? false;
  }
  return target.evalKeys?.includes(evalKey) ?? false;
}

export function getActiveEvalStatus(
  currentRun: ActiveRun | null,
  evalKey: string,
): ActiveEvalStatus {
  if (currentRun?.manifest.status !== 'running') return null;
  if (!targetIncludesEval(currentRun.manifest.target, evalKey)) return null;

  const cases = currentRun.cases.filter(
    (caseRow) => caseRow.evalKey === evalKey,
  );
  if (cases.some((caseRow) => caseRow.status === 'running')) return 'running';
  if (cases.length === 0) return 'enqueued';
  if (cases.some((caseRow) => caseRow.status === 'pending')) return 'enqueued';
  return null;
}
