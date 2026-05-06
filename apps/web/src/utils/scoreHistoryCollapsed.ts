const SCORE_HISTORY_COLLAPSED_STORAGE_KEY =
  'agent-evals.eval-card.score-history-collapsed.v2';

export function readScoreHistoryCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(
    SCORE_HISTORY_COLLAPSED_STORAGE_KEY,
  );
  return stored === null ? true : stored === '1';
}

export function writeScoreHistoryCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    SCORE_HISTORY_COLLAPSED_STORAGE_KEY,
    collapsed ? '1' : '0',
  );
}
