import type { CreateRunRequest } from '@agent-evals/shared';
import type { EvalMeta } from './runOrchestration.ts';

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

function matchesFiles(
  evalMeta: EvalMeta,
  files: string[] | undefined,
): boolean {
  if (files === undefined || files.length === 0) return true;
  return files.some((file) => fileMatches(file, evalMeta.filePath));
}

function matchesEvalIds(
  evalMeta: EvalMeta,
  evalIds: string[] | undefined,
): boolean {
  if (evalIds === undefined || evalIds.length === 0) return true;
  return evalIds.includes(evalMeta.id);
}

function matchesEvalKeys(
  evalMeta: EvalMeta,
  evalKeys: string[] | undefined,
): boolean {
  if (evalKeys === undefined || evalKeys.length === 0) return true;
  return evalKeys.includes(evalMeta.key);
}

/** Return the discovered evals selected by a run target. */
export function getTargetEvals(params: {
  evals: Iterable<EvalMeta>;
  request: CreateRunRequest;
}): EvalMeta[] {
  const { target } = params.request;
  return [...params.evals]
    .filter((evalMeta) => matchesEvalKeys(evalMeta, target.evalKeys))
    .filter((evalMeta) => matchesEvalIds(evalMeta, target.evalIds))
    .filter((evalMeta) => matchesFiles(evalMeta, target.files))
    .toSorted((a, b) => a.filePath.localeCompare(b.filePath));
}

/** Resolve which exact eval keys a run request can affect. */
export function getTargetEvalKeys(params: {
  request: CreateRunRequest;
  sortedEvals: EvalMeta[];
}): string[] {
  return getTargetEvals({
    evals: params.sortedEvals,
    request: params.request,
  }).map((evalMeta) => evalMeta.key);
}
