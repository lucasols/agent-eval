import {
  defineEval,
  evalSpan,
  evalTracer,
  setEvalOutput,
} from '@ls-stack/agent-eval';

type DeepTraceInput = {
  orderId: string;
  message: string;
  customerTier: 'standard' | 'priority';
};

type DeepTraceStage = {
  kind: string;
  name: string;
  action: string;
  delayMs: number;
};

const deepTraceStages: readonly DeepTraceStage[] = [
  {
    kind: 'agent',
    name: 'refund-review.intake-envelope',
    action: 'Normalize inbound refund request',
    delayMs: 2,
  },
  {
    kind: 'tool',
    name: 'parse-customer-message-and-order-reference',
    action: 'Extract the requested order and complaint reason',
    delayMs: 2,
  },
  {
    kind: 'api',
    name: 'GET /customers/:id/orders/:orderId',
    action: 'Load order, shipment, and payment metadata',
    delayMs: 3,
  },
  {
    kind: 'agent',
    name: 'eligibility-policy-router',
    action: 'Route the case through refund policy checks',
    delayMs: 2,
  },
  {
    kind: 'tool',
    name: 'inspect-delivery-window-and-return-deadline',
    action: 'Compare delivery date against return window',
    delayMs: 2,
  },
  {
    kind: 'model-risk-screening',
    name: 'model.check-account-risk-signals-and-prior-claims',
    action: 'Score repeat-claim and account risk signals',
    delayMs: 3,
  },
  {
    kind: 'api',
    name: 'POST /warehouse/evidence/image-quality-check',
    action: 'Check whether attached evidence is usable',
    delayMs: 2,
  },
  {
    kind: 'agent',
    name: 'policy.exception-review.damage-category',
    action: 'Evaluate damage category exception handling',
    delayMs: 2,
  },
  {
    kind: 'llm',
    name: 'compose-policy-grounded-refund-recommendation',
    action: 'Draft a policy-grounded refund recommendation',
    delayMs: 4,
  },
  {
    kind: 'model_step',
    name: 'reason-about-customer-tone-and-resolution-risk',
    action: 'Assess tone, urgency, and escalation risk',
    delayMs: 2,
  },
  {
    kind: 'tool',
    name: 'calculate-refund-options-restock-and-shipping-fees',
    action: 'Calculate refund amount and fee treatment',
    delayMs: 2,
  },
  {
    kind: 'api',
    name: 'POST /payments/refunds/dry-run',
    action: 'Dry-run the refund before committing',
    delayMs: 3,
  },
  {
    kind: 'agent',
    name: 'resolution-plan.supervisor-approval-gate',
    action: 'Decide whether supervisor approval is required',
    delayMs: 2,
  },
  {
    kind: 'tool',
    name: 'persist-case-resolution-and-audit-trail',
    action: 'Persist final case notes and audit trail',
    delayMs: 2,
  },
  {
    kind: 'api',
    name: 'POST /notifications/customer-resolution-message',
    action: 'Queue the customer resolution message',
    delayMs: 3,
  },
];

const auditBranchNames = [
  'ledger-adjustment-sanity-check-with-very-long-span-label',
  'warehouse-return-history-cross-check-with-very-long-span-label',
] as const;

const fanoutDepths = new Set([2, 5, 8, 11]);

async function waitForDelay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getDeepTraceStage(depth: number): DeepTraceStage {
  const stage = deepTraceStages[depth];
  if (stage !== undefined) return stage;
  return {
    kind: 'agent',
    name: 'refund-review.terminal-summary',
    action: 'Summarize the terminal review decision',
    delayMs: 2,
  };
}

async function runAuditFanout(depth: number, path: string): Promise<number> {
  let spanCount = 0;

  for (const branchName of auditBranchNames) {
    const branchCount = await evalTracer.span(
      {
        kind: 'tool',
        name: `${branchName}.${path}`,
        attributes: { depth, fanout: true, path },
      },
      async () => {
        await waitForDelay(2);
        evalSpan.setAttribute('output', {
          branchName,
          decision: depth % 2 === 0 ? 'clear' : 'reviewed',
        });

        await evalTracer.span(
          {
            kind: 'api',
            name: `GET /audit/${branchName}/supporting-records`,
            attributes: { depth: depth + 1, path: `${path}.${branchName}` },
          },
          async () => {
            await waitForDelay(1);
            evalSpan.setAttribute('output', {
              recordCount: depth + branchName.length,
            });
          },
        );

        await evalTracer.span(
          {
            kind: 'model_step',
            name: `summarize-${branchName}-risk-signal`,
            attributes: {
              depth: depth + 1,
              path: `${path}.${branchName}.summary`,
            },
          },
          async () => {
            await waitForDelay(1);
            evalSpan.setAttribute('output', {
              summary: 'No blocker found for the refund path.',
            });
          },
        );

        return 3;
      },
    );

    spanCount += branchCount;
  }

  return spanCount;
}

async function runDeepRefundReview(
  input: DeepTraceInput,
  depth: number,
  maxDepth: number,
  path: string,
): Promise<number> {
  const stage = getDeepTraceStage(depth);

  return await evalTracer.span(
    {
      kind: stage.kind,
      name: `${stage.name}.${path}`,
      attributes: {
        action: stage.action,
        customerTier: input.customerTier,
        depth,
        orderId: input.orderId,
        path,
      },
    },
    async () => {
      await waitForDelay(stage.delayMs);

      if (depth >= maxDepth) {
        const checkpointName = `deep-trace-terminal-decision-${path}`;
        evalTracer.checkpoint(checkpointName, {
          approved: true,
          orderId: input.orderId,
          path,
          reason: 'Evidence, policy, and payment dry-run all cleared.',
        });

        evalSpan.setAttribute('output', {
          approved: true,
          checkpointName,
          maxDepth,
        });

        return 2;
      }

      const fanoutSpanCount = fanoutDepths.has(depth)
        ? await runAuditFanout(depth, path)
        : 0;
      const childSpanCount = await runDeepRefundReview(
        input,
        depth + 1,
        maxDepth,
        `${path}.${String(depth + 1)}`,
      );
      const totalSpanCount = 1 + fanoutSpanCount + childSpanCount;

      evalSpan.setAttribute('output', {
        childSpanCount,
        fanoutSpanCount,
        totalSpanCount,
      });

      return totalSpanCount;
    },
  );
}

defineEval<DeepTraceInput>({
  id: 'deep-trace-tree-demo',
  title: 'Deep Trace Tree Demo',
  tags: ['playground'],
  removeTags: ['example'],
  cache: { read: false, store: false },
  cases: [
    {
      id: 'deep-refund-review',
      input: {
        orderId: 'ORDER-DEEP-1739',
        message:
          'Customer reports a damaged item and asks for a priority refund review.',
        customerTier: 'priority',
      },
    },
  ],
  columns: {
    response: { label: 'Response', format: 'markdown' },
    maxDepth: { label: 'Max Depth', format: 'number' },
    spanCount: { label: 'Spans', format: 'number' },
  },
  execute: async ({ input }) => {
    const maxDepth = deepTraceStages.length - 1;

    const spanCount = await evalTracer.span(
      {
        kind: 'agent',
        name: 'deep-refund-review.root-orchestrator-with-long-label',
        attributes: { message: input.message, orderId: input.orderId },
      },
      async () => {
        const nestedSpanCount = await runDeepRefundReview(
          input,
          0,
          maxDepth,
          '0',
        );
        const totalSpanCount = nestedSpanCount + 1;

        evalSpan.setAttribute('output', { maxDepth, totalSpanCount });

        return totalSpanCount;
      },
    );

    setEvalOutput(
      'response',
      [
        `Deep refund review completed for ${input.orderId}.`,
        '',
        `Recorded ${String(spanCount)} spans across ${String(maxDepth + 1)} nested stages.`,
      ].join('\n'),
    );
    setEvalOutput('maxDepth', maxDepth + 1);
    setEvalOutput('spanCount', spanCount);
  },
  scores: {
    deepTraceRecorded: {
      label: 'Deep Trace Recorded',
      passThreshold: 1,
      compute: ({ outputs }) =>
        typeof outputs.spanCount === 'number' && outputs.spanCount >= 40
          ? 1
          : 0,
    },
  },
});
