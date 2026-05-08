import type { CaseDetail, EvalTraceSpan } from '@agent-evals/shared';
import { expect, test } from 'vitest';
import { getScopedCacheActivityEntries } from '#src/utils/cacheActivity';

function span(overrides: Partial<EvalTraceSpan>): EvalTraceSpan {
  return {
    id: overrides.id ?? 'span-1',
    parentId: overrides.parentId ?? null,
    caseId: overrides.caseId ?? 'case-1',
    kind: overrides.kind ?? 'custom',
    name: overrides.name ?? 'test-span',
    attributes: overrides.attributes,
    status: overrides.status ?? 'ok',
    startedAt: overrides.startedAt ?? '2026-05-08T00:00:00.000Z',
    endedAt: overrides.endedAt ?? '2026-05-08T00:00:00.100Z',
  };
}

test('scopes cache activity from case and scoring traces', () => {
  const caseDetail: Pick<CaseDetail, 'trace' | 'cacheRefs' | 'scoringTraces'> =
    {
      trace: [
        span({
          id: 'case-span',
          name: 'case-cache',
          attributes: {
            'cache.status': 'hit',
            'cache.key': 'case-key',
            'cache.namespace': 'eval.case',
          },
        }),
      ],
      cacheRefs: [],
      scoringTraces: {
        quality: {
          trace: [
            span({
              id: 'score-span',
              name: 'judge-cache',
              kind: 'scorer',
              attributes: {
                'cache.status': 'miss',
                'cache.key': 'score-key',
                'cache.namespace': 'eval.score',
              },
            }),
          ],
          traceDisplay: {},
          cacheRefs: [
            {
              type: 'value',
              name: 'judge-context',
              namespace: 'eval.score-context',
              key: 'score-ref-key',
              status: 'hit',
            },
          ],
        },
      },
    };

  expect(
    getScopedCacheActivityEntries({
      caseDetail,
      scoreLabels: [{ key: 'quality', label: 'Quality' }],
    }).map((entry) => ({
      id: entry.id,
      action: entry.entry.action,
      name: entry.entry.name,
      phase: entry.phase,
    })),
  ).toEqual([
    {
      id: 'case:case-span',
      action: 'hit',
      name: 'case-cache',
      phase: { kind: 'case' },
    },
    {
      id: 'scoring:quality:score-span',
      action: 'added',
      name: 'judge-cache',
      phase: { kind: 'scoring', scoreKey: 'quality', scoreLabel: 'Quality' },
    },
    {
      id: 'scoring:quality:case:value:0',
      action: 'hit',
      name: 'judge-context',
      phase: { kind: 'scoring', scoreKey: 'quality', scoreLabel: 'Quality' },
    },
  ]);
});
