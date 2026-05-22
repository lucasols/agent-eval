import {
  getCaseRowCaseKey,
  type CaseDetail,
  type CaseRow,
} from '@agent-evals/shared';
import { resultify } from 't-result';

type CaseDetailLookupRun = {
  cases: CaseRow[];
  caseDetails: Map<string, CaseDetail>;
};

function getCaseLookupIds(caseId: string): string[] {
  const decodedResult = resultify(() => decodeURIComponent(caseId));
  const decodedCaseId = decodedResult.error ? caseId : decodedResult.value;
  const lookupIds = new Set([caseId, decodedCaseId]);

  for (const lookupId of [...lookupIds]) {
    const segments = lookupId.split('#');
    if (segments.length < 3) continue;
    lookupIds.add(
      segments.map((segment) => encodeURIComponent(segment)).join('#'),
    );
  }

  return [...lookupIds];
}

export function resolveCaseDetailLookup(
  run: CaseDetailLookupRun,
  caseId: string,
): CaseDetail | undefined {
  const lookupIds = new Set(getCaseLookupIds(caseId));
  for (const lookupId of lookupIds) {
    const caseDetail = run.caseDetails.get(lookupId);
    if (caseDetail) return caseDetail;
  }

  const matchingCaseRow = resolveCaseRowForCaseDetailLookup(run, caseId);
  if (matchingCaseRow === undefined) return undefined;

  return run.caseDetails.get(getCaseRowCaseKey(matchingCaseRow));
}

export function resolveCaseRowForCaseDetailLookup(
  run: Pick<CaseDetailLookupRun, 'cases'>,
  caseId: string,
): CaseRow | undefined {
  const lookupIds = new Set(getCaseLookupIds(caseId));
  return run.cases.find(
    (caseRow) =>
      lookupIds.has(getCaseRowCaseKey(caseRow)) ||
      lookupIds.has(caseRow.caseId),
  );
}
