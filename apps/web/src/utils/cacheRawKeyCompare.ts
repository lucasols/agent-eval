import type {
  CacheActivityEntry,
  CaseRow,
  RunManifest,
} from '@agent-evals/shared';
import { getCaseRowCaseKey } from '@agent-evals/shared';

export type CacheCompareRun = { manifest: RunManifest; cases: CaseRow[] };

function runStartedAtMs(run: CacheCompareRun): number {
  const parsed = Date.parse(run.manifest.startedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function caseMatchesEval(caseRow: CaseRow, evalKey: string): boolean {
  return caseRow.evalKey === evalKey || caseRow.evalId === evalKey;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getSameEvalRuns<T extends CacheCompareRun>(
  runs: T[],
  evalKey: string,
): T[] {
  return runs
    .filter((run) =>
      run.cases.some((caseRow) => caseMatchesEval(caseRow, evalKey)),
    )
    .toSorted((a, b) => runStartedAtMs(b) - runStartedAtMs(a));
}

export function getSameEvalCases(
  run: CacheCompareRun | undefined,
  evalKey: string,
): CaseRow[] {
  if (run === undefined) return [];
  return run.cases.filter((caseRow) => caseMatchesEval(caseRow, evalKey));
}

export function selectDefaultComparisonRunId(params: {
  runs: CacheCompareRun[];
  currentRunId: string;
}): string | null {
  const currentIndex = params.runs.findIndex(
    (run) => run.manifest.id === params.currentRunId,
  );
  if (currentIndex >= 0) {
    return params.runs[currentIndex + 1]?.manifest.id ?? null;
  }

  return (
    params.runs.find((run) => run.manifest.id !== params.currentRunId)?.manifest
      .id ?? null
  );
}

export function selectDefaultComparisonCaseKey(params: {
  cases: CaseRow[];
  currentCaseKey: string;
}): string | null {
  const matchingCase = params.cases.find(
    (caseRow) => getCaseRowCaseKey(caseRow) === params.currentCaseKey,
  );
  const defaultCase = matchingCase ?? params.cases[0];
  return defaultCase === undefined ? null : getCaseRowCaseKey(defaultCase);
}

export function selectDefaultComparisonCacheEntry(params: {
  entries: CacheActivityEntry[];
  currentCacheIndex: number;
}): CacheActivityEntry | null {
  const sameIndexEntry = params.entries[params.currentCacheIndex];
  if (sameIndexEntry?.stored === true) return sameIndexEntry;
  return params.entries.find((entry) => entry.stored) ?? null;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return 'NaN';
    return value > 0 ? 'Infinity' : '-Infinity';
  }
  if (typeof value === 'bigint') {
    return {
      __agentEvalsUnsupportedJsonValue: 'bigint',
      value: value.toString(),
    };
  }
  if (typeof value === 'undefined') {
    return { __agentEvalsUnsupportedJsonValue: 'undefined' };
  }
  if (typeof value === 'symbol') {
    return {
      __agentEvalsUnsupportedJsonValue: 'symbol',
      value: value.description ?? null,
    };
  }
  if (typeof value === 'function') {
    return {
      __agentEvalsUnsupportedJsonValue: 'function',
      value: value.name.length > 0 ? value.name : null,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }

  if (isRecordLike(value)) {
    const canonicalObject: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      canonicalObject[key] = canonicalizeJsonValue(value[key]);
    }
    return canonicalObject;
  }

  return null;
}

export function stringifyCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value), null, 2);
}
