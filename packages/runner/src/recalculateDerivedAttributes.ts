import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getEvalRegistry } from '@agent-evals/sdk';
import {
  applyDerivedCallAttributes,
  getCaseRowCaseKey,
  getCaseRowEvalKey,
  type CaseDetail,
  type CaseRow,
  type ResolvedApiCallsConfig,
  type ResolvedLlmCallsConfig,
  type TraceDisplayInputConfig,
} from '@agent-evals/shared';
import type { RunnerRunState } from './runChildManager.ts';
import type { EvalMeta } from './runOrchestration.ts';
import { resolveTracePresentation } from './traceDisplay.ts';

export type RecalculateDerivedAttributesResult =
  | { updated: true; caseDetail: CaseDetail }
  | { updated: false; reason: string };

function getCaseArtifactFileIdForExistingRun(
  runState: RunnerRunState,
  caseRow: CaseRow,
): string {
  const caseKey = getCaseRowCaseKey(caseRow);
  const collides = runState.cases.some(
    (existing) =>
      existing.caseId === caseRow.caseId &&
      getCaseRowCaseKey(existing) !== caseKey,
  );
  return collides ? caseKey : caseRow.caseId;
}

export async function recalculateDerivedAttributesForCase(params: {
  run: RunnerRunState;
  caseId: string;
  llmCallsConfig: ResolvedLlmCallsConfig;
  apiCallsConfig: ResolvedApiCallsConfig;
  traceDisplayConfig: TraceDisplayInputConfig | undefined;
  evals: ReadonlyMap<string, EvalMeta>;
  persistCaseDetail: (
    runDir: string,
    caseDetail: CaseDetail,
    fileId?: string,
  ) => Promise<void>;
}): Promise<RecalculateDerivedAttributesResult> {
  const { run, caseId } = params;
  if (run.manifest.status === 'running') {
    return { updated: false, reason: 'Run is still running' };
  }

  const caseRow = run.cases.find(
    (row) => getCaseRowCaseKey(row) === caseId || row.caseId === caseId,
  );
  if (!caseRow) return { updated: false, reason: 'Case not found' };

  const caseKey = getCaseRowCaseKey(caseRow);
  const caseDetail = run.caseDetails.get(caseKey);
  if (!caseDetail) return { updated: false, reason: 'Case detail not found' };

  const spansWithDerivedAttributes = applyDerivedCallAttributes({
    spans: caseDetail.trace,
    llmCallsConfig: params.llmCallsConfig,
    apiCallsConfig: params.apiCallsConfig,
  });

  let nextTrace = spansWithDerivedAttributes;
  let nextTraceDisplay = caseDetail.traceDisplay;
  const evalMeta = params.evals.get(getCaseRowEvalKey(caseRow));
  const entry =
    evalMeta === undefined ? undefined : getEvalRegistry().get(evalMeta.id);
  if (entry !== undefined) {
    entry.use((evalDef) => {
      const resolved = resolveTracePresentation(
        spansWithDerivedAttributes,
        params.traceDisplayConfig,
        evalDef.traceDisplay,
      );
      nextTrace = resolved.trace;
      nextTraceDisplay = resolved.traceDisplay;
    });
  }

  const nextCaseDetail: CaseDetail = {
    ...caseDetail,
    trace: nextTrace,
    traceDisplay: nextTraceDisplay,
  };
  run.caseDetails.set(caseKey, nextCaseDetail);

  const artifactFileId = getCaseArtifactFileIdForExistingRun(run, caseRow);
  await writeFile(
    join(run.runDir, 'traces', `${encodeURIComponent(artifactFileId)}.json`),
    JSON.stringify(nextCaseDetail.trace, null, 2),
  );
  await params.persistCaseDetail(run.runDir, nextCaseDetail, artifactFileId);

  return { updated: true, caseDetail: nextCaseDetail };
}
