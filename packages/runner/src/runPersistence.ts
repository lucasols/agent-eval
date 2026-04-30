import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CaseDetail,
  CaseRow,
  ColumnDef,
  EvalSummary,
  RunManifest,
  RunSummary,
} from '@agent-evals/shared';
import {
  caseDetailSchema,
  caseRowSchema,
  deriveStatusFromChildStatuses,
  deriveStatusFromCaseRows,
  getCaseRowEvalKey,
  runManifestSchema,
  runSummarySchema,
} from '@agent-evals/shared';
import { resultify } from 't-result';
import { getRunFreshnessTimestamp, type LatestRunInfo } from './freshness.ts';

export type EvalLatestRunInfo = LatestRunInfo & {
  status: EvalSummary['lastRunStatus'];
};

export type PersistedRunSnapshot = {
  runDir: string;
  manifest: RunManifest;
  summary: RunSummary;
  cases: CaseRow[];
  caseDetails: Map<string, CaseDetail>;
};

const SHORT_ID_PATTERN = /^r(\d+)$/;

/**
 * Generate a filesystem-safe, sortable run id combining a UTC timestamp
 * with a short random suffix.
 */
export function generateRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${String(now.getUTCFullYear())}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}Z`;
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${timestamp}_${suffix}`;
}

function parseShortIdNum(shortId: string | undefined): number | null {
  if (shortId === undefined) return null;
  const match = SHORT_ID_PATTERN.exec(shortId);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  return num;
}

/**
 * Return the next `shortId` number to assign based on the existing
 * loaded snapshots. Legacy runs that don't match the `r\d+` format are
 * ignored.
 */
export function nextShortIdFromSnapshots(
  snapshots: PersistedRunSnapshot[],
): number {
  let maxNum = -1;
  for (const snapshot of snapshots) {
    const num = parseShortIdNum(snapshot.manifest.shortId);
    if (num !== null && num > maxNum) maxNum = num;
  }
  return maxNum + 1;
}

export async function loadPersistedRunSnapshots(
  localStateDir: string,
): Promise<PersistedRunSnapshot[]> {
  const runsDir = join(localStateDir, 'runs');
  const entriesResult = await resultify(() =>
    readdir(runsDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return [];

  const snapshots: PersistedRunSnapshot[] = [];
  const runDirs = entriesResult.value
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runsDir, entry.name))
    .toSorted();

  for (const runDir of runDirs) {
    const snapshot = await loadPersistedRunSnapshot(runDir);
    if (!snapshot) continue;
    snapshots.push(snapshot);
  }

  return snapshots;
}

export async function persistCaseDetail(
  runDir: string,
  caseDetail: CaseDetail,
  fileId: string = caseDetail.caseId,
): Promise<void> {
  await writeFile(
    join(runDir, 'case-details', `${encodeCaseDetailFileName(fileId)}.json`),
    JSON.stringify(caseDetail, null, 2),
  );
}

export function getLastRunStatuses(params: {
  runs: Iterable<{ manifest: RunManifest; cases: CaseRow[] }>;
  knownEvals: Iterable<{ key: string; id: string; columnDefs: ColumnDef[] }>;
}): Map<string, EvalSummary['lastRunStatus']> {
  const latestRunInfos = getLatestRunInfos(params);
  return new Map(
    [...latestRunInfos].map(([evalId, info]) => [evalId, info.status]),
  );
}

/**
 * Return the latest scoped run metadata for each eval based on persisted and
 * in-memory runs.
 */
export function getLatestRunInfos(params: {
  runs: Iterable<{ manifest: RunManifest; cases: CaseRow[] }>;
  knownEvals: Iterable<{ key: string; id: string; columnDefs: ColumnDef[] }>;
}): Map<string, EvalLatestRunInfo> {
  const { runs, knownEvals } = params;
  const knownEvalMetas = [...knownEvals];
  const evalIdByKey = new Map(
    knownEvalMetas.map((evalMeta) => [evalMeta.key, evalMeta.id]),
  );
  const manualScoreKeysByEval = new Map(
    knownEvalMetas.map((evalMeta) => [
      evalMeta.key,
      evalMeta.columnDefs
        .filter((columnDef) => columnDef.isManualScore === true)
        .map((columnDef) => columnDef.key),
    ]),
  );
  const orderedRuns = [...runs].toSorted(
    (a, b) =>
      new Date(getRunFreshnessTimestamp(a.manifest)).getTime() -
      new Date(getRunFreshnessTimestamp(b.manifest)).getTime(),
  );
  const latestRunInfos = new Map<string, EvalLatestRunInfo>();

  for (const run of orderedRuns) {
    for (const evalKey of getRunEvalKeys(run, knownEvalMetas)) {
      latestRunInfos.set(evalKey, {
        status: getEvalStatusForRun(
          run,
          evalKey,
          evalIdByKey.get(evalKey),
          manualScoreKeysByEval.get(evalKey) ?? [],
        ),
        startedAt: getRunFreshnessTimestamp(run.manifest),
        commitSha: run.manifest.commitSha ?? null,
        evalSourceFingerprint:
          run.manifest.evalSourceFingerprints[evalKey] ??
          run.manifest.evalSourceFingerprints[evalIdByKey.get(evalKey) ?? ''] ??
          null,
      });
    }
  }

  return latestRunInfos;
}

function toLastRunStatus(
  status: ReturnType<typeof deriveStatusFromCaseRows>,
): EvalSummary['lastRunStatus'] {
  return status === 'pending' ? null : status;
}

export async function loadPersistedRunSnapshot(
  runDir: string,
): Promise<PersistedRunSnapshot | null> {
  const manifest = await readParsedJsonFile(join(runDir, 'run.json'), {
    safeParse: runManifestSchema.safeParse.bind(runManifestSchema),
  });
  if (!manifest) return null;

  const summary = await readParsedJsonFile(join(runDir, 'summary.json'), {
    safeParse: runSummarySchema.safeParse.bind(runSummarySchema),
  });
  if (!summary) return null;

  return {
    runDir,
    manifest,
    summary,
    cases: await readCaseRows(runDir),
    caseDetails: await readCaseDetails(runDir),
  };
}

async function readParsedJsonFile<T>(
  filePath: string,
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
): Promise<T | null> {
  const fileResult = await resultify(() => readFile(filePath, 'utf-8'));
  if (fileResult.error) return null;

  const jsonResult = resultify((): unknown => JSON.parse(fileResult.value));
  if (jsonResult.error) return null;

  const parsed = schema.safeParse(jsonResult.value);
  if (!parsed.success) return null;

  return parsed.data;
}

async function readCaseRows(runDir: string): Promise<CaseRow[]> {
  const fileResult = await resultify(() =>
    readFile(join(runDir, 'cases.jsonl'), 'utf-8'),
  );
  if (fileResult.error) return [];

  const rows: CaseRow[] = [];
  for (const rawLine of fileResult.value.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const jsonResult = resultify((): unknown => JSON.parse(line));
    if (jsonResult.error) continue;

    const parsed = caseRowSchema.safeParse(jsonResult.value);
    if (!parsed.success) continue;

    rows.push(parsed.data);
  }

  return rows;
}

async function readCaseDetails(
  runDir: string,
): Promise<Map<string, CaseDetail>> {
  const detailsDir = join(runDir, 'case-details');
  const entriesResult = await resultify(() =>
    readdir(detailsDir, { withFileTypes: true }),
  );
  if (entriesResult.error) return new Map();

  const caseDetails = new Map<string, CaseDetail>();
  for (const entry of entriesResult.value) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const detail = await readParsedJsonFile(join(detailsDir, entry.name), {
      safeParse: caseDetailSchema.safeParse.bind(caseDetailSchema),
    });
    if (!detail) continue;

    caseDetails.set(detail.caseKey ?? detail.caseId, detail);
  }

  return caseDetails;
}

function getRunEvalKeys(
  run: { manifest: RunManifest; cases: CaseRow[] },
  knownEvals: Iterable<{ key: string; id: string }>,
): string[] {
  const knownEvalMetas = [...knownEvals];
  const evalKeys = new Set(run.cases.map(getCaseRowEvalKey));
  for (const caseRow of run.cases) {
    if (caseRow.evalKey !== undefined) continue;
    for (const evalMeta of knownEvalMetas) {
      if (evalMeta.id === caseRow.evalId) evalKeys.add(evalMeta.key);
    }
  }

  if (run.manifest.target.mode === 'evalIds') {
    for (const evalKey of run.manifest.target.evalKeys ?? []) {
      evalKeys.add(evalKey);
    }
    for (const evalId of run.manifest.target.evalIds ?? []) {
      for (const evalMeta of knownEvalMetas) {
        if (evalMeta.id === evalId) evalKeys.add(evalMeta.key);
      }
    }
  } else if (run.manifest.target.mode === 'all' && evalKeys.size === 0) {
    for (const evalMeta of knownEvalMetas) {
      evalKeys.add(evalMeta.key);
    }
  }

  return [...evalKeys];
}

function getEvalStatusForRun(
  run: { manifest: RunManifest; cases: CaseRow[] },
  evalKey: string,
  evalId: string | undefined,
  manualScoreKeys: readonly string[],
): EvalSummary['lastRunStatus'] {
  const evalCases = run.cases.filter(
    (caseRow) =>
      getCaseRowEvalKey(caseRow) === evalKey ||
      (caseRow.evalKey === undefined && caseRow.evalId === evalId),
  );
  if (evalCases.length > 0) {
    if (hasPendingManualScores(evalCases, manualScoreKeys)) {
      return 'unscored';
    }
    return toLastRunStatus(deriveStatusFromCaseRows({ caseRows: evalCases }));
  }

  return toLastRunStatus(
    deriveStatusFromChildStatuses({
      statuses: [],
      lifecycleStatus: run.manifest.status,
    }),
  );
}

function hasPendingManualScores(
  caseRows: CaseRow[],
  manualScoreKeys: readonly string[],
): boolean {
  if (manualScoreKeys.length === 0) return false;
  return caseRows.some((caseRow) =>
    manualScoreKeys.some((key) => {
      const value = caseRow.columns[key];
      return typeof value !== 'number' || !Number.isFinite(value);
    }),
  );
}

function encodeCaseDetailFileName(caseId: string): string {
  return encodeURIComponent(caseId);
}
