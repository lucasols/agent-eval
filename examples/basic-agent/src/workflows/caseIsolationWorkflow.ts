export type CaseIsolationBackendMode = 'approval' | 'manual-review';

type CaseIsolationBackend = {
  mode: CaseIsolationBackendMode;
  decide: (request: string) => {
    mode: CaseIsolationBackendMode;
    response: string;
  };
};

const liveBackend: CaseIsolationBackend = {
  mode: 'manual-review',
  decide: (request) => ({
    mode: 'manual-review',
    response: `Live backend would review manually: ${request}`,
  }),
};

let activeBackend = liveBackend;

export function mockCaseIsolationBackend(mode: CaseIsolationBackendMode): void {
  activeBackend = {
    mode,
    decide: (request) => ({
      mode,
      response:
        mode === 'approval'
          ? `Mock backend approved: ${request}`
          : `Mock backend requested manual review: ${request}`,
    }),
  };
}

export async function runCaseIsolationWorkflow(input: {
  request: string;
  delayMs: number;
}): Promise<{ mode: CaseIsolationBackendMode; response: string }> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, input.delayMs);
  });

  return activeBackend.decide(input.request);
}
