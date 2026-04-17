import { describe, expect, test } from 'vitest';
import type { EvalSummary } from '@agent-evals/shared';
import {
  buildEvalTree,
  collectEvalsInFolder,
  type TreeNode,
} from '../../../apps/web/src/utils/buildEvalTree.ts';

const exampleWorkspace = '/tmp/agent-evals-example';

const exampleEvals: EvalSummary[] = [
  createEvalSummary(
    'refund-workflow',
    'Refund Workflow',
    `${exampleWorkspace}/evals/refund-workflow.eval.ts`,
  ),
  createEvalSummary(
    'receipt-audit',
    'Receipt Audit',
    `${exampleWorkspace}/evals/support/refunds/receipt-audit.eval.ts`,
  ),
  createEvalSummary(
    'high-value-refund',
    'High Value Refund',
    `${exampleWorkspace}/evals/support/refunds/escalations/high-value-refund.eval.ts`,
  ),
  createEvalSummary(
    'voice-return-follow-up',
    'Voice Return Follow-up',
    `${exampleWorkspace}/evals/support/returns/voice-follow-up.eval.ts`,
  ),
];

describe('app tree ui', () => {
  test('builds nested folders from example eval paths', () => {
    expect(simplifyTree(buildEvalTree(exampleEvals))).toMatchInlineSnapshot(`
      [
        {
          "children": [
            {
              "children": [
                {
                  "children": [
                    {
                      "id": "high-value-refund",
                      "kind": "leaf",
                      "title": "High Value Refund",
                    },
                  ],
                  "kind": "folder",
                  "name": "escalations",
                  "path": "support/refunds/escalations",
                },
                {
                  "id": "receipt-audit",
                  "kind": "leaf",
                  "title": "Receipt Audit",
                },
              ],
              "kind": "folder",
              "name": "refunds",
              "path": "support/refunds",
            },
            {
              "children": [
                {
                  "id": "voice-return-follow-up",
                  "kind": "leaf",
                  "title": "Voice Return Follow-up",
                },
              ],
              "kind": "folder",
              "name": "returns",
              "path": "support/returns",
            },
          ],
          "kind": "folder",
          "name": "support",
          "path": "support",
        },
        {
          "id": "refund-workflow",
          "kind": "leaf",
          "title": "Refund Workflow",
        },
      ]
    `);
  });

  test('collects evals beneath the selected folder', () => {
    expect(
      collectEvalsInFolder(exampleEvals, 'support/refunds')
        .map((ev) => ev.id)
        .sort(),
    ).toEqual(['high-value-refund', 'receipt-audit']);

    expect(
      collectEvalsInFolder(exampleEvals, 'support')
        .map((ev) => ev.id)
        .sort(),
    ).toEqual([
      'high-value-refund',
      'receipt-audit',
      'voice-return-follow-up',
    ]);
  });
});

function createEvalSummary(
  id: string,
  title: string,
  filePath: string,
): EvalSummary {
  return {
    id,
    title,
    description: `${title} example eval`,
    filePath,
    stale: false,
    columnDefs: [],
    caseCount: 1,
    lastRunStatus: null,
  };
}

function simplifyTree(nodes: TreeNode[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === 'folder') {
      return {
        kind: 'folder',
        name: node.name,
        path: node.path,
        children: simplifyTree(node.children),
      };
    }

    return {
      kind: 'leaf',
      id: node.evalSummary.id,
      title: node.evalSummary.title,
    };
  });
}
