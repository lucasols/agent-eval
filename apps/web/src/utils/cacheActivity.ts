import {
  extractCacheEntries,
  type CacheActivityEntry,
  type CaseDetail,
} from '@agent-evals/shared';

export type ScopedCacheActivityPhase =
  | { kind: 'case' }
  | { kind: 'scoring'; scoreKey: string; scoreLabel: string };

export type ScopedCacheActivityEntry = {
  id: string;
  entry: CacheActivityEntry;
  phase: ScopedCacheActivityPhase;
};

type ScoreLabel = { key: string; label: string | undefined };

function getScoreLabel(scoreLabels: ScoreLabel[], scoreKey: string): string {
  return (
    scoreLabels.find((scoreLabel) => scoreLabel.key === scoreKey)?.label ??
    scoreKey
  );
}

function scopeEntryId(params: {
  phase: ScopedCacheActivityPhase;
  entry: CacheActivityEntry;
}): string {
  if (params.phase.kind === 'case') return `case:${params.entry.id}`;
  return `scoring:${params.phase.scoreKey}:${params.entry.id}`;
}

export function getScopedCacheActivityEntries(params: {
  caseDetail: Pick<CaseDetail, 'trace' | 'cacheRefs' | 'scoringTraces'>;
  scoreLabels?: ScoreLabel[];
}): ScopedCacheActivityEntry[] {
  const entries: ScopedCacheActivityEntry[] = [];
  const casePhase: ScopedCacheActivityPhase = { kind: 'case' };

  for (const entry of extractCacheEntries(
    params.caseDetail.trace,
    params.caseDetail.cacheRefs,
  )) {
    entries.push({
      id: scopeEntryId({ phase: casePhase, entry }),
      entry,
      phase: casePhase,
    });
  }

  for (const [scoreKey, scoreTrace] of Object.entries(
    params.caseDetail.scoringTraces ?? {},
  )) {
    const phase: ScopedCacheActivityPhase = {
      kind: 'scoring',
      scoreKey,
      scoreLabel: getScoreLabel(params.scoreLabels ?? [], scoreKey),
    };

    for (const entry of extractCacheEntries(
      scoreTrace.trace,
      scoreTrace.cacheRefs,
    )) {
      entries.push({ id: scopeEntryId({ phase, entry }), entry, phase });
    }
  }

  return entries;
}
