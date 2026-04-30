export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const shellSafeTextRegex = /^[A-Za-z0-9_./:-]+$/;

function shellQuote(value: string): string {
  if (shellSafeTextRegex.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function getAgentEvalsCommandPrefix(packageManager: PackageManager): string {
  if (packageManager === 'pnpm') return 'pnpm exec agent-evals';
  if (packageManager === 'yarn') return 'yarn agent-evals';
  if (packageManager === 'bun') return 'bunx agent-evals';
  return 'npm exec agent-evals --';
}

export function buildEvalRunCliCommand(params: {
  packageManager: PackageManager;
  evalId: string;
  filePath?: string;
}): string {
  const fileArg =
    params.filePath === undefined
      ? ''
      : ` --file ${shellQuote(params.filePath)}`;
  return `${getAgentEvalsCommandPrefix(params.packageManager)} run${fileArg} --eval ${shellQuote(params.evalId)}`;
}

export function buildEvalDebugCliCommand(params: {
  packageManager: PackageManager;
  evalId: string;
  filePath?: string;
}): string {
  const fileArg =
    params.filePath === undefined
      ? ''
      : ` --file ${shellQuote(params.filePath)}`;
  return `${getAgentEvalsCommandPrefix(params.packageManager)} run --inspect${fileArg} --eval ${shellQuote(params.evalId)}`;
}
