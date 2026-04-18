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
    'receipt-fraud-review',
    'Receipt Fraud Review',
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
  createEvalSummary(
    'score-threshold-demo',
    'Score Threshold Demo',
    `${exampleWorkspace}/evals/support/quality/outcome-behavior.eval.ts`,
  ),
  createEvalSummary(
    'assertion-failure-demo',
    'Assertion Failure Demo',
    `${exampleWorkspace}/evals/support/quality/outcome-behavior.eval.ts`,
  ),
  createEvalSummary(
    'silent-pass-demo',
    'Silent Pass Demo',
    `${exampleWorkspace}/evals/support/quality/outcome-behavior.eval.ts`,
  ),
  createEvalSummary(
    'silent-assertion-demo',
    'Silent Assertion Demo',
    `${exampleWorkspace}/evals/support/quality/outcome-behavior.eval.ts`,
  ),
  createEvalSummary(
    'randomized-lab',
    'Randomized Lab',
    `${exampleWorkspace}/evals/support/playground/randomized-lab.eval.ts`,
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
                  "id": "randomized-lab",
                  "kind": "leaf",
                  "title": "Randomized Lab",
                },
              ],
              "kind": "folder",
              "name": "playground",
              "path": "support/playground",
            },
            {
              "children": [
                {
                  "id": "assertion-failure-demo",
                  "kind": "leaf",
                  "title": "Assertion Failure Demo",
                },
                {
                  "id": "score-threshold-demo",
                  "kind": "leaf",
                  "title": "Score Threshold Demo",
                },
                {
                  "id": "silent-assertion-demo",
                  "kind": "leaf",
                  "title": "Silent Assertion Demo",
                },
                {
                  "id": "silent-pass-demo",
                  "kind": "leaf",
                  "title": "Silent Pass Demo",
                },
              ],
              "kind": "folder",
              "name": "quality",
              "path": "support/quality",
            },
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
                {
                  "id": "receipt-fraud-review",
                  "kind": "leaf",
                  "title": "Receipt Fraud Review",
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
    ).toEqual([
      'high-value-refund',
      'receipt-audit',
      'receipt-fraud-review',
    ]);

    expect(
      collectEvalsInFolder(exampleEvals, 'support')
        .map((ev) => ev.id)
        .sort(),
    ).toEqual([
      'assertion-failure-demo',
      'high-value-refund',
      'randomized-lab',
      'receipt-audit',
      'receipt-fraud-review',
      'score-threshold-demo',
      'silent-assertion-demo',
      'silent-pass-demo',
      'voice-return-follow-up',
    ]);
  });

  test('creates unique leaf paths for multiple evals in one file', () => {
    const tree = buildEvalTree(exampleEvals);
    const leafPaths = collectLeafPaths(tree);

    expect(new Set(leafPaths).size).toBe(leafPaths.length);
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

function collectLeafPaths(nodes: TreeNode[]): string[] {
  const result: string[] = [];

  for (const node of nodes) {
    if (node.kind === 'folder') {
      result.push(...collectLeafPaths(node.children));
      continue;
    }

    result.push(node.path);
  }

  return result;
}
