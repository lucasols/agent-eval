import { readFile } from 'node:fs/promises';
import {
  isManualInputFileValue,
  stageManualInputFileFromPath,
  type EvalRunner,
} from '@agent-evals/runner';
import type { EvalSummary } from '@agent-evals/shared';
import { resultify } from 't-result';

/** CLI flags consumed by the manual-input collector. */
export type ManualInputCliArgs = {
  evalIds: string[];
  files: string[];
  caseIds: string[];
  inputJson: string | undefined;
  inputFilePath: string | undefined;
};

/**
 * Discriminated result from {@link collectManualInputs}: either a
 * resolved map (or `undefined` when no manual-input evals are targeted) or
 * a human-readable error message that the CLI surfaces and exits on.
 */
export type CollectManualInputsResult =
  | { error: null; value: Record<string, unknown> | undefined }
  | { error: string; value: null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPathInputObject(
  value: unknown,
): value is { path: string; name?: string; mimeType?: string } {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.path === 'string' &&
    (value.name === undefined || typeof value.name === 'string') &&
    (value.mimeType === undefined || typeof value.mimeType === 'string')
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replaceAll('\\', '/');
  let regex = '^';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      i++;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegex(char ?? '');
    }
  }
  regex += '$';
  return new RegExp(regex);
}

function fileMatches(pattern: string, filePath: string): boolean {
  const normalizedPattern = pattern.replaceAll('\\', '/');
  if (normalizedPattern === filePath) return true;
  return globToRegex(normalizedPattern).test(filePath);
}

function isManualInputEvalTargeted(params: {
  evalSummary: EvalSummary;
  args: ManualInputCliArgs;
}): boolean {
  const { evalSummary, args } = params;
  const hasEvalIds = args.evalIds.length > 0;
  const hasFiles = args.files.length > 0;
  const hasCaseIds = args.caseIds.length > 0;

  if (hasEvalIds && !args.evalIds.includes(evalSummary.id)) return false;
  if (hasFiles) {
    const matched = args.files.some((file) =>
      fileMatches(file, evalSummary.filePath),
    );
    if (!matched) return false;
  }
  if (!hasEvalIds && !hasFiles) {
    if (hasCaseIds) return false;
    return true;
  }
  return true;
}

async function readInputFileMap(
  inputFilePath: string,
): Promise<{ error: string; value: null } | { error: null; value: unknown }> {
  const readResult = await resultify(() => readFile(inputFilePath, 'utf-8'));
  if (readResult.error) {
    return {
      error: `Failed to read --input-file at ${inputFilePath}: ${readResult.error.message}`,
      value: null,
    };
  }
  const parseResult = resultify((): unknown => JSON.parse(readResult.value));
  if (parseResult.error) {
    return {
      error: `Failed to parse --input-file at ${inputFilePath} as JSON: ${parseResult.error.message}`,
      value: null,
    };
  }
  return { error: null, value: parseResult.value };
}

async function normalizeManualInputFileValue(params: {
  workspaceRoot: string;
  evalId: string;
  fieldKey: string;
  value: unknown;
}): Promise<{ error: string; value: null } | { error: null; value: unknown }> {
  if (isManualInputFileValue(params.value)) {
    return { error: null, value: params.value };
  }
  if (!isPathInputObject(params.value)) {
    return { error: null, value: params.value };
  }
  const pathInput = params.value;

  const staged = await resultify(() =>
    stageManualInputFileFromPath({
      workspaceRoot: params.workspaceRoot,
      path: pathInput.path,
      name: pathInput.name,
      mimeType: pathInput.mimeType,
    }),
  );
  if (staged.error) {
    return {
      error: `Failed to stage file input "${params.fieldKey}" for eval "${params.evalId}": ${staged.error.message}`,
      value: null,
    };
  }
  return { error: null, value: staged.value };
}

async function normalizeManualInputValue(params: {
  workspaceRoot: string;
  evalSummary: EvalSummary;
  value: unknown;
}): Promise<{ error: string; value: null } | { error: null; value: unknown }> {
  const descriptor = params.evalSummary.manualInput;
  if (!descriptor || !isPlainObject(params.value)) {
    return { error: null, value: params.value };
  }

  const next: Record<string, unknown> = { ...params.value };
  for (const field of descriptor.fields) {
    if (field.kind !== 'file') continue;
    const normalized = await normalizeManualInputFileValue({
      workspaceRoot: params.workspaceRoot,
      evalId: params.evalSummary.id,
      fieldKey: field.key,
      value: next[field.key],
    });
    if (normalized.error !== null) {
      return { error: normalized.error, value: null };
    }
    next[field.key] = normalized.value;
  }
  return { error: null, value: next };
}

/**
 * Resolve the `manualInputs` payload to send with `runner.startRun`.
 *
 * Inspects every discovered eval that declares `manualInput`, filters them to
 * the run target, and either returns the typed map (single eval via `--input`,
 * multiple via `--input-file`) or a structured error to display and exit on.
 */
export async function collectManualInputs(params: {
  runner: EvalRunner;
  args: ManualInputCliArgs;
}): Promise<CollectManualInputsResult> {
  const { runner, args } = params;
  const workspaceRoot = runner.getWorkspaceRoot();

  const targetedManualInputEvals = runner
    .getEvals()
    .filter((evalSummary) => evalSummary.manualInput !== undefined)
    .filter((evalSummary) => isManualInputEvalTargeted({ evalSummary, args }));

  if (targetedManualInputEvals.length === 0) {
    if (args.inputJson !== undefined || args.inputFilePath !== undefined) {
      return {
        error:
          '--input/--input-file was provided but no targeted eval requires manual input.',
        value: null,
      };
    }
    return { error: null, value: undefined };
  }

  if (args.inputJson !== undefined && args.inputFilePath !== undefined) {
    return {
      error: 'Cannot use --input and --input-file together; choose one.',
      value: null,
    };
  }

  if (args.inputJson !== undefined) {
    if (targetedManualInputEvals.length > 1) {
      const ids = targetedManualInputEvals
        .map((evalSummary) => evalSummary.id)
        .join(', ');
      return {
        error: `--input only works for one targeted manual-input eval at a time; got ${String(targetedManualInputEvals.length)} (${ids}). Use --input-file with a JSON object keyed by eval key.`,
        value: null,
      };
    }
    const parsedResult = resultify((): unknown =>
      JSON.parse(args.inputJson ?? ''),
    );
    if (parsedResult.error) {
      return {
        error: `Failed to parse --input as JSON: ${parsedResult.error.message}`,
        value: null,
      };
    }
    const [onlyEval] = targetedManualInputEvals;
    if (onlyEval === undefined) {
      return { error: null, value: undefined };
    }
    const normalized = await normalizeManualInputValue({
      workspaceRoot,
      evalSummary: onlyEval,
      value: parsedResult.value,
    });
    if (normalized.error !== null) {
      return { error: normalized.error, value: null };
    }
    return { error: null, value: { [onlyEval.key]: normalized.value } };
  }

  if (args.inputFilePath !== undefined) {
    const fileResult = await readInputFileMap(args.inputFilePath);
    if (fileResult.error !== null) {
      return { error: fileResult.error, value: null };
    }
    if (!isPlainObject(fileResult.value)) {
      return {
        error: `--input-file must contain a JSON object keyed by eval key (got ${typeof fileResult.value}).`,
        value: null,
      };
    }
    const map: Record<string, unknown> = {};
    for (const evalSummary of targetedManualInputEvals) {
      const byKey = fileResult.value[evalSummary.key];
      const byId = fileResult.value[evalSummary.id];
      const value = byKey !== undefined ? byKey : byId;
      if (value === undefined) {
        return {
          error: `--input-file is missing manual input for eval "${evalSummary.id}" (key "${evalSummary.key}").`,
          value: null,
        };
      }
      const normalized = await normalizeManualInputValue({
        workspaceRoot,
        evalSummary,
        value,
      });
      if (normalized.error !== null) {
        return { error: normalized.error, value: null };
      }
      map[evalSummary.key] = normalized.value;
    }
    return { error: null, value: map };
  }

  const missing = targetedManualInputEvals
    .map((evalSummary) => evalSummary.id)
    .join(', ');
  return {
    error: `Eval(s) require manual input but no --input/--input-file was provided: ${missing}`,
    value: null,
  };
}
