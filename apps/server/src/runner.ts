import type { EvalRunner } from '@ls-stack/agent-eval';
import { createRunner } from '@ls-stack/agent-eval';

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
