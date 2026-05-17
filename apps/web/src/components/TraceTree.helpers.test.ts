import type { EvalTraceSpan } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  buildTraceChildrenByParent,
  flattenVisibleRows,
} from '#src/components/TraceTree.helpers';

function span(overrides: Partial<EvalTraceSpan>): EvalTraceSpan {
  return {
    id: overrides.id ?? 'span-1',
    parentId: overrides.parentId ?? null,
    caseId: overrides.caseId ?? 'case-1',
    kind: overrides.kind ?? 'agent',
    name: overrides.name ?? 'test-span',
    status: overrides.status ?? 'ok',
    startedAt: overrides.startedAt ?? '2026-05-17T18:45:42.000Z',
    endedAt: overrides.endedAt ?? '2026-05-17T18:45:42.100Z',
    attributes: overrides.attributes,
    error: overrides.error,
    errors: overrides.errors,
    warning: overrides.warning,
    warnings: overrides.warnings,
  };
}

describe('TraceTree helpers', () => {
  test('keeps filtered children visible when their parent is hidden', () => {
    const toolSpan = span({
      id: 'tool-span',
      parentId: 'agent-span',
      kind: 'tool',
      startedAt: '2026-05-17T18:45:42.010Z',
    });

    const childrenByParent = buildTraceChildrenByParent([toolSpan], 'parent');

    expect(flattenVisibleRows(childrenByParent, new Set())).toEqual([
      { span: toolSpan, depth: 0, hasChildren: false },
    ]);
  });
});
