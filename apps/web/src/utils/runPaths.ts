const trailingPathSeparatorsRegex = /[\\/]+$/;

export function formatRunFolderPath(workspaceRoot: string, runId: string) {
  if (workspaceRoot.length === 0) return `.agent-evals/runs/${runId}`;
  const separator = workspaceRoot.includes('\\') ? '\\' : '/';
  const root = workspaceRoot.replace(trailingPathSeparatorsRegex, '');
  return `${root}${separator}.agent-evals${separator}runs${separator}${runId}`;
}

export function formatRunFolderDisplayPath(runId: string) {
  return `<root>/.agent-evals/runs/${runId}`;
}

export function formatCaseDetailPath(params: {
  runFolderPath: string;
  caseArtifactFileId: string;
}) {
  const separator = params.runFolderPath.includes('\\') ? '\\' : '/';
  const runFolderPath = params.runFolderPath.replace(
    trailingPathSeparatorsRegex,
    '',
  );
  return `${runFolderPath}${separator}case-details${separator}${encodeURIComponent(params.caseArtifactFileId)}.json`;
}

export function getCaseArtifactFileId(
  caseRows: Array<{ caseId: string; caseKey?: string; trial: number }>,
  targetCase: { caseId: string; caseKey?: string; trial: number },
) {
  const caseIdCounts = new Map<string, number>();
  for (const caseRow of caseRows) {
    caseIdCounts.set(
      caseRow.caseId,
      (caseIdCounts.get(caseRow.caseId) ?? 0) + 1,
    );
  }

  const targetKey = getCaseLookupKey(targetCase);
  const seenCaseIds = new Set<string>();
  for (const caseRow of caseRows) {
    const hasPreviousCaseWithId = seenCaseIds.has(caseRow.caseId);
    const duplicateCaseIdCount = caseIdCounts.get(caseRow.caseId) ?? 0;
    const fileId =
      duplicateCaseIdCount > 1 && hasPreviousCaseWithId
        ? (caseRow.caseKey ?? caseRow.caseId)
        : caseRow.caseId;
    seenCaseIds.add(caseRow.caseId);

    if (
      caseRow.trial === targetCase.trial &&
      getCaseLookupKey(caseRow) === targetKey
    ) {
      return fileId;
    }
  }

  return targetCase.caseId;
}

function getCaseLookupKey(caseRow: { caseId: string; caseKey?: string }) {
  return caseRow.caseKey ?? caseRow.caseId;
}
