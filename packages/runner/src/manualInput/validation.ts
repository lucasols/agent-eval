import type { EvalManualInputConfig } from '@agent-evals/sdk';
import type { CreateRunRequest } from '@agent-evals/shared';
import type { EvalMeta } from '../runOrchestration.ts';
import {
  parseManualInputValues,
  type ManualInputValidationIssue,
} from './walker.ts';

/** Per-eval failure shape returned by {@link validateManualInputsForRequest}. */
export type ManualInputValidationFailure = {
  /** Stable eval key (`filePath + evalId`) the issue applies to. */
  evalKey: string;
  /** Authored eval id, useful for human-readable messages. */
  evalId: string;
  /** Reason category. */
  reason: 'missing' | 'invalid';
  /** Field-keyed issues; `path` is empty for whole-eval issues. */
  issues: ManualInputValidationIssue[];
};

/** Discriminated union returned by {@link validateManualInputsForRequest}. */
export type ManualInputValidationResult =
  | { ok: true; parsed: Record<string, unknown> }
  | { ok: false; failures: ManualInputValidationFailure[] };

function evalIsTargeted(
  evalMeta: EvalMeta,
  target: CreateRunRequest['target'],
): boolean {
  if (target.evalKeys && target.evalKeys.length > 0) {
    if (!target.evalKeys.includes(evalMeta.key)) return false;
  }
  if (target.evalIds && target.evalIds.length > 0) {
    if (!target.evalIds.includes(evalMeta.id)) return false;
  }
  return true;
}

/**
 * Validate the `manualInputs` map carried by a `CreateRunRequest` against the
 * authored Zod schemas of every targeted eval that requires manual input.
 *
 * Pure: takes captured discovery state (eval metas + schema configs) and the
 * request, returns a structured result the server/CLI can format directly.
 */
export function validateManualInputsForRequest(params: {
  evalMetas: Iterable<EvalMeta>;
  manualInputConfigs: Map<string, EvalManualInputConfig<unknown>>;
  request: CreateRunRequest;
}): ManualInputValidationResult {
  const { evalMetas, manualInputConfigs, request } = params;
  const failures: ManualInputValidationFailure[] = [];
  const parsed: Record<string, unknown> = {};

  for (const evalMeta of evalMetas) {
    if (!evalMeta.requiresManualInput) continue;
    if (!evalIsTargeted(evalMeta, request.target)) continue;

    const rawValue = request.manualInputs?.[evalMeta.key];
    if (rawValue === undefined) {
      failures.push({
        evalKey: evalMeta.key,
        evalId: evalMeta.id,
        reason: 'missing',
        issues: [
          {
            path: '',
            message: `manualInputs is missing an entry for "${evalMeta.key}"`,
          },
        ],
      });
      continue;
    }
    const config = manualInputConfigs.get(evalMeta.key);
    if (!config) {
      failures.push({
        evalKey: evalMeta.key,
        evalId: evalMeta.id,
        reason: 'invalid',
        issues: [
          {
            path: '',
            message:
              'manualInput schema is unavailable; reload the workspace and try again',
          },
        ],
      });
      continue;
    }
    const result = parseManualInputValues(config, rawValue);
    if (result.error) {
      failures.push({
        evalKey: evalMeta.key,
        evalId: evalMeta.id,
        reason: 'invalid',
        issues: result.error.issues,
      });
      continue;
    }
    parsed[evalMeta.key] = result.value;
  }

  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, parsed };
}
