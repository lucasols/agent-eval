/** Build the stable identity for one eval inside a workspace. */
export function buildEvalKey(params: { filePath: string; evalId: string }) {
  return `${encodeURIComponent(params.filePath)}#${encodeURIComponent(params.evalId)}`;
}

/** Build the stable identity for one eval case inside a workspace. */
export function buildCaseKey(params: {
  filePath: string;
  evalId: string;
  caseId: string;
}) {
  return [
    encodeURIComponent(params.filePath),
    encodeURIComponent(params.evalId),
    encodeURIComponent(params.caseId),
  ].join('#');
}

/** Return the collision-safe eval key stored on a row, falling back for legacy data. */
export function getCaseRowEvalKey(row: { evalKey?: string; evalId: string }) {
  return row.evalKey ?? row.evalId;
}

/** Return the collision-safe case key stored on a row, falling back for legacy data. */
export function getCaseRowCaseKey(row: { caseKey?: string; caseId: string }) {
  return row.caseKey ?? row.caseId;
}
