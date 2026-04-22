import type { EvalSummary } from '@agent-evals/shared';
import { describe, expect, test } from 'vitest';
import {
  buildEvalTree,
  collectEvalsInFolder,
  deriveCombinedStatus,
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
    'module-mock-demo',
    'Module Mock Demo',
    `${exampleWorkspace}/evals/support/playground/module-mock.eval.ts`,
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
                  "fileName": "module-mock",
                  "id": "module-mock-demo",
                  "kind": "leaf",
                  "title": "Module Mock Demo",
                },
                {
                  "fileName": "randomized-lab",
                  "id": "randomized-lab",
                  "kind": "leaf",
                  "title": "Randomized Lab",
                },
              ],
              "evalCount": 2,
              "kind": "folder",
              "name": "playground",
              "path": "support/playground",
            },
            {
              "children": [
                {
                  "evals": [
                    {
                      "id": "assertion-failure-demo",
                      "title": "Assertion Failure Demo",
                    },
                    {
                      "id": "score-threshold-demo",
                      "title": "Score Threshold Demo",
                    },
                    {
                      "id": "silent-assertion-demo",
                      "title": "Silent Assertion Demo",
                    },
                    {
                      "id": "silent-pass-demo",
                      "title": "Silent Pass Demo",
                    },
                  ],
                  "kind": "file",
                  "name": "outcome-behavior",
                  "path": "/tmp/agent-evals-example/evals/support/quality/outcome-behavior.eval.ts",
                },
              ],
              "evalCount": 4,
              "kind": "folder",
              "name": "quality",
              "path": "support/quality",
            },
            {
              "children": [
                {
                  "children": [
                    {
                      "fileName": "high-value-refund",
                      "id": "high-value-refund",
                      "kind": "leaf",
                      "title": "High Value Refund",
                    },
                  ],
                  "evalCount": 1,
                  "kind": "folder",
                  "name": "escalations",
                  "path": "support/refunds/escalations",
                },
                {
                  "evals": [
                    {
                      "id": "receipt-audit",
                      "title": "Receipt Audit",
                    },
                    {
                      "id": "receipt-fraud-review",
                      "title": "Receipt Fraud Review",
                    },
                  ],
                  "kind": "file",
                  "name": "receipt-audit",
                  "path": "/tmp/agent-evals-example/evals/support/refunds/receipt-audit.eval.ts",
                },
              ],
              "evalCount": 3,
              "kind": "folder",
              "name": "refunds",
              "path": "support/refunds",
            },
            {
              "children": [
                {
                  "fileName": "voice-follow-up",
                  "id": "voice-return-follow-up",
                  "kind": "leaf",
                  "title": "Voice Return Follow-up",
                },
              ],
              "evalCount": 1,
              "kind": "folder",
              "name": "returns",
              "path": "support/returns",
            },
          ],
          "evalCount": 10,
          "kind": "folder",
          "name": "support",
          "path": "support",
        },
        {
          "fileName": "refund-workflow",
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
    ).toEqual(['high-value-refund', 'receipt-audit', 'receipt-fraud-review']);

    expect(
      collectEvalsInFolder(exampleEvals, 'support')
        .map((ev) => ev.id)
        .sort(),
    ).toEqual([
      'assertion-failure-demo',
      'high-value-refund',
      'module-mock-demo',
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

  test('sorts evals by derived title when title is omitted', () => {
    expect(
      simplifyTree(
        buildEvalTree([
          createEvalSummary('zebra-case', undefined, '/tmp/demo.eval.ts'),
          createEvalSummary('alpha-case', undefined, '/tmp/demo.eval.ts'),
        ]),
      ),
    ).toEqual([
      {
        kind: 'file',
        name: 'demo',
        path: '/tmp/demo.eval.ts',
        evals: [
          { id: 'alpha-case', title: undefined },
          { id: 'zebra-case', title: undefined },
        ],
      },
    ]);
  });

  test('derives file and folder status from the latest eval result only', () => {
    expect(
      deriveCombinedStatus(
        [
          createEvalSummary('pass', 'Pass', '/tmp/pass.eval.ts', 'pass'),
          createEvalSummary('fail', 'Fail', '/tmp/fail.eval.ts', 'fail'),
        ],
        () => false,
      ),
    ).toBe('fail');

    expect(
      deriveCombinedStatus(
        [
          createEvalSummary('pass', 'Pass', '/tmp/pass.eval.ts', 'pass'),
          createEvalSummary('error', 'Error', '/tmp/error.eval.ts', 'error'),
        ],
        () => false,
      ),
    ).toBe('error');

    expect(
      deriveCombinedStatus(
        [
          createEvalSummary('pass', 'Pass', '/tmp/pass.eval.ts', 'pass'),
          createEvalSummary('running', 'Running', '/tmp/run.eval.ts', 'pass'),
        ],
        (evalId) => evalId === 'running',
      ),
    ).toBe('running');

    expect(
      deriveCombinedStatus(
        [
          createEvalSummary('pass', 'Pass', '/tmp/pass.eval.ts', 'pass', {
            stale: true,
            outdated: true,
            freshnessStatus: 'stale',
          }),
        ],
        () => false,
      ),
    ).toBe('stale');
  });
});

function createEvalSummary(
  id: string,
  title: string | undefined,
  filePath: string,
  lastRunStatus: EvalSummary['lastRunStatus'] = null,
  overrides: Partial<EvalSummary> = {},
): EvalSummary {
  return {
    id,
    title,
    filePath,
    stale: false,
    outdated: false,
    freshnessStatus: 'fresh',
    latestRunAt: null,
    latestRunCommitSha: null,
    currentCommitSha: null,
    columnDefs: [],
    caseCount: 1,
    lastRunStatus,
    ...overrides,
  };
}

function simplifyTree(nodes: TreeNode[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === 'folder') {
      return {
        kind: 'folder',
        name: node.name,
        path: node.path,
        evalCount: node.evalCount,
        children: simplifyTree(node.children),
      };
    }

    if (node.kind === 'file') {
      return {
        kind: 'file',
        name: node.name,
        path: node.path,
        evals: node.evals.map((ev) => ({ id: ev.id, title: ev.title })),
      };
    }

    return {
      kind: 'leaf',
      id: node.evalSummary.id,
      title: node.evalSummary.title,
      fileName: node.fileName,
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

    if (node.kind === 'file') {
      for (const ev of node.evals) {
        result.push(`${node.filePath}#${ev.id}`);
      }
      continue;
    }

    result.push(node.path);
  }

  return result;
}
