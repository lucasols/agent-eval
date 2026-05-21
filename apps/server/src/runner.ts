import type { EvalRunner } from '@ls-stack/agent-eval';
import { createRunner } from '@ls-stack/agent-eval';

let runnerInstance: EvalRunner | null = null;

type InitRunnerOptions = { loadEnv?: boolean };

export function getRunnerInstance({
  loadEnv = true,
}: InitRunnerOptions = {}): EvalRunner {
  if (!runnerInstance) {
    runnerInstance = createRunner({ loadEnv });
  }
  return runnerInstance;
}

export async function initRunner(
  options: InitRunnerOptions = {},
): Promise<EvalRunner> {
  const runner = getRunnerInstance(options);
  await runner.init();
  return runner;
}
