import type { EvalRunner } from '@agent-evals/runner';
import { createRunner } from '@agent-evals/runner';

let runnerInstance: EvalRunner | null = null;

export function getRunnerInstance(): EvalRunner {
  if (!runnerInstance) {
    runnerInstance = createRunner();
  }
  return runnerInstance;
}

export async function initRunner(): Promise<EvalRunner> {
  const runner = getRunnerInstance();
  await runner.init();
  return runner;
}
