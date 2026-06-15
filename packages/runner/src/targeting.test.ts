import type { CreateRunRequest } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import type { EvalMeta } from './runOrchestration.ts';
import { getTargetEvals } from './targeting.ts';

function evalMeta(filePath: string, id: string): EvalMeta {
  return {
    key: `${filePath}#${id}`,
    id,
    filePath,
    tags: [],
    sourceFilePath: `/workspace/${filePath}`,
    sourceFingerprint: null,
    columnDefs: [],
    caseCount: null,
  };
}

function request(target: CreateRunRequest['target']): CreateRunRequest {
  return { target, trials: 1 };
}

describe('getTargetEvals', () => {
  test('orders selected evals round-robin by parent folder', () => {
    const evals = [
      evalMeta('evals/support/refunds/refund-b.eval.ts', 'refund-b'),
      evalMeta('evals/support/returns/return-a.eval.ts', 'return-a'),
      evalMeta('evals/support/refunds/refund-a.eval.ts', 'refund-a'),
      evalMeta('evals/support/quality/quality-a.eval.ts', 'quality-a'),
      evalMeta('evals/support/returns/return-b.eval.ts', 'return-b'),
      evalMeta('evals/support/refunds/refund-c.eval.ts', 'refund-c'),
    ];

    expect(
      getTargetEvals({
        evals,
        request: request({ mode: 'all' }),
      }).map((evalMeta_) => evalMeta_.id),
    ).toEqual([
      'quality-a',
      'refund-a',
      'return-a',
      'refund-b',
      'return-b',
      'refund-c',
    ]);
  });

  test('keeps file and id order within each folder pass after filtering', () => {
    const evals = [
      evalMeta('evals/beta/shared.eval.ts', 'zeta'),
      evalMeta('evals/alpha/second.eval.ts', 'second'),
      evalMeta('evals/beta/shared.eval.ts', 'alpha'),
      evalMeta('evals/alpha/first.eval.ts', 'first'),
      evalMeta('evals/beta/second.eval.ts', 'second-beta'),
    ];

    expect(
      getTargetEvals({
        evals,
        request: request({
          mode: 'evalIds',
          files: ['evals/alpha/*.eval.ts', 'evals/beta/*.eval.ts'],
        }),
      }).map((evalMeta_) => evalMeta_.id),
    ).toEqual(['first', 'second-beta', 'second', 'alpha', 'zeta']);
  });
});
