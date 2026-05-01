import type { EvalManualInputConfig } from '@agent-evals/sdk';
import type {
  DiscoveryIssue,
  ManualInputDescriptor,
} from '@agent-evals/shared';
import { buildManualInputDescriptor } from './walker.ts';

/** Inputs needed to evaluate `manualInput` during workspace discovery. */
export type ResolveManualInputDiscoveryInput = {
  evalDef: { manualInput?: EvalManualInputConfig<unknown>; cases?: unknown };
  evalId: string;
  relativeFilePath: string;
};

/**
 * Result returned by {@link resolveManualInputDiscovery}: either a successful
 * descriptor + captured config (for runtime validation), a discovery issue
 * for the caller to surface, or `null` when the eval has no manualInput.
 */
export type ResolveManualInputDiscoveryResult =
  | { kind: 'none' }
  | { kind: 'issue'; issue: DiscoveryIssue }
  | {
      kind: 'ok';
      requiresManualInput: true;
      descriptor: ManualInputDescriptor;
      config: EvalManualInputConfig<unknown>;
    };

/**
 * Inspect an eval's `manualInput` config during discovery. Rejects evals that
 * declare both `cases` and `manualInput` and evals whose schema cannot be
 * walked into a wire descriptor.
 */
export function resolveManualInputDiscovery(
  params: ResolveManualInputDiscoveryInput,
): ResolveManualInputDiscoveryResult {
  const { evalDef, evalId, relativeFilePath } = params;
  if (!evalDef.manualInput) return { kind: 'none' };

  if (evalDef.cases !== undefined) {
    return {
      kind: 'issue',
      issue: {
        type: 'manual-input-with-cases',
        severity: 'error',
        filePath: relativeFilePath,
        evalId,
        message: `Eval "${evalId}" in ${relativeFilePath} declares both "cases" and "manualInput". Remove one of them.`,
      },
    };
  }

  const descriptorResult = buildManualInputDescriptor(evalDef.manualInput);
  if (descriptorResult.error) {
    return {
      kind: 'issue',
      issue: {
        type: 'manual-input-with-cases',
        severity: 'error',
        filePath: relativeFilePath,
        evalId,
        message: `Eval "${evalId}" in ${relativeFilePath} has an unsupported manualInput schema: ${descriptorResult.error.message}`,
      },
    };
  }

  return {
    kind: 'ok',
    requiresManualInput: true,
    descriptor: descriptorResult.value,
    config: evalDef.manualInput,
  };
}
