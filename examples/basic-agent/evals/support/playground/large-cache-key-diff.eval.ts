import { defineEval, evalTracer, setEvalOutput, z } from '@ls-stack/agent-eval';

type LargeCacheKeyInput = { accountId: string; scenario: string };

type LargeCacheKeyOutputs = {
  response: string;
  keySectionCount: number;
  runNonce: string;
};

type CacheKeySection = {
  sectionId: string;
  policy: { version: string; thresholdUsd: number; flags: string[] };
  examples: Array<{ id: string; expectedAction: string; keywords: string[] }>;
};

function buildLargeStableSections(): CacheKeySection[] {
  return Array.from({ length: 48 }, (_section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    return {
      sectionId: `refund-policy-section-${String(sectionNumber).padStart(2, '0')}`,
      policy: {
        version: '2026.05',
        thresholdUsd: 25 + sectionNumber,
        flags: [
          'receipt-required',
          sectionNumber % 2 === 0 ? 'photo-evidence' : 'agent-review',
          sectionNumber % 3 === 0 ? 'expedite-vip' : 'standard-routing',
        ],
      },
      examples: Array.from({ length: 4 }, (_example, exampleIndex) => ({
        id: `example-${String(sectionNumber).padStart(2, '0')}-${String(exampleIndex + 1)}`,
        expectedAction:
          exampleIndex % 2 === 0 ? 'approve-refund' : 'request-more-context',
        keywords: [
          'damaged',
          'refund',
          `bucket-${String(sectionNumber % 8)}`,
          `signal-${String(exampleIndex + 1)}`,
        ],
      })),
    };
  });
}

function buildLargeCacheKey(input: LargeCacheKeyInput, runNonce: string) {
  return {
    accountId: input.accountId,
    scenario: input.scenario,
    promptBundle: {
      name: 'large-cache-key-diff-demo',
      model: 'gpt-4o-mini',
      locale: 'en-US',
      unchangedInstructions: [
        'Classify refund intent.',
        'Prefer concise explanations.',
        'Escalate ambiguous high-value claims.',
        'Keep customer-facing wording friendly.',
      ],
    },
    retrievalSnapshot: {
      corpus: 'refund-playbook',
      generatedBy: 'examples/basic-agent',
      sections: buildLargeStableSections(),
    },
    runSpecificProbe: { runNonce, generatedAt: new Date().toISOString() },
  };
}

defineEval<LargeCacheKeyInput, LargeCacheKeyOutputs>({
  id: 'large-cache-key-diff-demo',
  title: 'Large Cache Key Diff Demo',
  tags: ['playground'],
  cases: [
    {
      id: 'large-key-small-change',
      input: {
        accountId: 'acct-demo-428',
        scenario: 'Damaged mug refund with receipt attached',
      },
    },
  ],
  outputsSchema: z.object({
    response: z.string(),
    keySectionCount: z.number(),
    runNonce: z.string(),
  }),
  columns: {
    response: { label: 'Response', format: 'markdown' },
    keySectionCount: { label: 'Key Sections' },
    runNonce: { label: 'Run Nonce' },
  },
  execute: async ({ input }) => {
    const runNonce = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
    const largeCacheKey = buildLargeCacheKey(input, runNonce);

    const response = await evalTracer.cache(
      {
        name: 'large-raw-key-probe',
        namespace: 'playground.large-cache-key-diff-demo',
        key: largeCacheKey,
      },
      () => {
        return `Prepared large cache-key comparison payload for ${input.accountId}.`;
      },
    );

    setEvalOutput('response', response);
    setEvalOutput(
      'keySectionCount',
      largeCacheKey.retrievalSnapshot.sections.length,
    );
    setEvalOutput('runNonce', runNonce);
  },
  scores: {
    cacheKeyGenerated: {
      label: 'Cache Key Generated',
      passThreshold: 1,
      compute: ({ outputs }) => (outputs.keySectionCount === 48 ? 1 : 0),
    },
  },
});
