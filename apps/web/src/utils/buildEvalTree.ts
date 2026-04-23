import {
  getEvalDisplayStatus,
  getEvalTitle,
  type EvalDisplayStatus,
  type EvalSummary,
} from '@agent-evals/shared';

export type TreeFolder = {
  kind: 'folder';
  path: string;
  name: string;
  evalCount: number;
  children: TreeNode[];
};

export type TreeFile = {
  kind: 'file';
  path: string;
  name: string;
  filePath: string;
  evals: EvalSummary[];
};

export type TreeLeaf = {
  kind: 'leaf';
  path: string;
  filePath: string;
  fileName: string;
  evalSummary: EvalSummary;
};

export type TreeNode = TreeFolder | TreeFile | TreeLeaf;

function getDirSegments(filePath: string): string[] {
  const parts = filePath.split('/').filter((p) => p.length > 0);
  return parts.slice(0, -1);
}

function getFilename(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

const EVAL_EXT_REGEX = /\.eval\.ts$/i;

function stripEvalExt(fileName: string): string {
  return fileName.replace(EVAL_EXT_REGEX, '');
}

function commonPrefixLength(all: string[][]): number {
  if (all.length === 0) return 0;
  const [first, ...rest] = all;
  if (!first) return 0;
  let len = first.length;
  for (const segs of rest) {
    let i = 0;
    while (i < len && i < segs.length && segs[i] === first[i]) i++;
    len = i;
  }
  return len;
}

function getTreePrefixLength(evals: EvalSummary[]): number {
  const allDirs = evals.map((ev) => getDirSegments(ev.filePath));
  return commonPrefixLength(allDirs);
}

export function getDisplayFolderSegments(
  evals: EvalSummary[],
  filePath: string,
): string[] {
  return getDirSegments(filePath).slice(getTreePrefixLength(evals));
}

function groupByFilePath(
  evals: EvalSummary[],
): { filePath: string; evals: EvalSummary[] }[] {
  const byPath = new Map<string, EvalSummary[]>();
  for (const ev of evals) {
    const existing = byPath.get(ev.filePath);
    if (existing) {
      existing.push(ev);
    } else {
      byPath.set(ev.filePath, [ev]);
    }
  }
  return Array.from(byPath, ([filePath, fileEvals]) => ({
    filePath,
    evals: fileEvals,
  }));
}

export function buildEvalTree(evals: EvalSummary[]): TreeNode[] {
  const root: TreeFolder = {
    kind: 'folder',
    path: '',
    name: '',
    evalCount: 0,
    children: [],
  };

  const folderIndex = new Map<string, TreeFolder>();
  folderIndex.set('', root);

  function ensureFolder(segments: string[]): TreeFolder {
    let currentPath = '';
    let parent = root;
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = folderIndex.get(currentPath);
      if (existing) {
        parent = existing;
        continue;
      }
      const folder: TreeFolder = {
        kind: 'folder',
        path: currentPath,
        name: segment,
        evalCount: 0,
        children: [],
      };
      folderIndex.set(currentPath, folder);
      parent.children.push(folder);
      parent = folder;
    }
    return parent;
  }

  const prefixLen = getTreePrefixLength(evals);
  const groups = groupByFilePath(evals);

  for (const group of groups) {
    const segments = getDirSegments(group.filePath).slice(prefixLen);
    const parent = ensureFolder(segments);
    const fileName = getFilename(group.filePath);
    const displayName = stripEvalExt(fileName);

    if (group.evals.length === 1) {
      const ev = group.evals[0];
      if (!ev) continue;
      parent.children.push({
        kind: 'leaf',
        path: `${ev.filePath}#${ev.id}`,
        filePath: ev.filePath,
        fileName: displayName,
        evalSummary: ev,
      });
    } else {
      const sortedEvals = [...group.evals].sort((a, b) => {
        const aName = getEvalTitle(a);
        const bName = getEvalTitle(b);
        return aName.localeCompare(bName);
      });
      parent.children.push({
        kind: 'file',
        path: group.filePath,
        name: displayName,
        filePath: group.filePath,
        evals: sortedEvals,
      });
    }
  }

  sortTree(root);
  annotateEvalCounts(root);

  return root.children;
}

function nodeSortName(node: TreeNode): string {
  if (node.kind === 'folder') return node.name;
  if (node.kind === 'file') return node.name;
  return getEvalTitle(node.evalSummary);
}

function nodeKindRank(node: TreeNode): number {
  if (node.kind === 'folder') return 0;
  if (node.kind === 'file') return 1;
  return 2;
}

function sortTree(folder: TreeFolder): void {
  folder.children.sort((a, b) => {
    const kindDiff = nodeKindRank(a) - nodeKindRank(b);
    if (kindDiff !== 0) return kindDiff;
    return nodeSortName(a).localeCompare(nodeSortName(b));
  });
  for (const child of folder.children) {
    if (child.kind === 'folder') sortTree(child);
  }
}

function annotateEvalCounts(folder: TreeFolder): number {
  let total = 0;
  for (const child of folder.children) {
    if (child.kind === 'folder') {
      total += annotateEvalCounts(child);
    } else if (child.kind === 'file') {
      total += child.evals.length;
    } else {
      total += 1;
    }
  }
  folder.evalCount = total;
  return total;
}

export function collectCollapsiblePaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  function walk(node: TreeNode): void {
    if (node.kind === 'folder') {
      paths.push(node.path);
      for (const child of node.children) walk(child);
      return;
    }
    if (node.kind === 'file') {
      paths.push(node.path);
    }
  }
  for (const node of nodes) walk(node);
  return paths;
}

export function collectNodeEvals(node: TreeNode): EvalSummary[] {
  if (node.kind === 'leaf') return [node.evalSummary];
  if (node.kind === 'file') return node.evals;
  const out: EvalSummary[] = [];
  for (const child of node.children) {
    out.push(...collectNodeEvals(child));
  }
  return out;
}

export type CombinedStatus = EvalDisplayStatus;

export function getEvalSummaryDisplayStatus(
  ev: EvalSummary,
  isEvalRunning: (evalId: string) => boolean,
): EvalDisplayStatus {
  return getEvalDisplayStatus({
    freshnessStatus: ev.freshnessStatus,
    stale: ev.stale,
    outdated: ev.outdated,
    lastRunStatus: ev.lastRunStatus,
    isRunning: isEvalRunning(ev.id),
  });
}

export function filterEvalsByStatuses(
  evals: EvalSummary[],
  statuses: Set<EvalDisplayStatus>,
  isEvalRunning: (evalId: string) => boolean,
): EvalSummary[] {
  if (statuses.size === 0) return evals;
  return evals.filter((ev) =>
    statuses.has(getEvalSummaryDisplayStatus(ev, isEvalRunning)),
  );
}

export type StatusBreakdown = {
  running: number;
  stale: number;
  outdated: number;
  pass: number;
  fail: number;
  error: number;
  cancelled: number;
  unscored: number;
  pending: number;
  total: number;
};

export function getStatusBreakdown(
  evals: EvalSummary[],
  isEvalRunning: (evalId: string) => boolean,
): StatusBreakdown {
  const counts: StatusBreakdown = {
    running: 0,
    stale: 0,
    outdated: 0,
    pass: 0,
    fail: 0,
    error: 0,
    cancelled: 0,
    unscored: 0,
    pending: 0,
    total: evals.length,
  };
  for (const ev of evals) {
    const status = getEvalSummaryDisplayStatus(ev, isEvalRunning);
    if (status === 'running') {
      counts.running += 1;
    } else if (status === 'stale') {
      counts.stale += 1;
    } else if (status === 'outdated') {
      counts.outdated += 1;
    } else if (status === 'pass') {
      counts.pass += 1;
    } else if (status === 'fail') {
      counts.fail += 1;
    } else if (status === 'error') {
      counts.error += 1;
    } else if (status === 'cancelled') {
      counts.cancelled += 1;
    } else if (status === 'unscored') {
      counts.unscored += 1;
    } else {
      counts.pending += 1;
    }
  }
  return counts;
}

export function formatStatusBreakdown(breakdown: StatusBreakdown): string {
  const parts: string[] = [];
  if (breakdown.running > 0) parts.push(`${breakdown.running} running`);
  if (breakdown.stale > 0) parts.push(`${breakdown.stale} stale`);
  if (breakdown.outdated > 0) parts.push(`${breakdown.outdated} outdated`);
  if (breakdown.pass > 0) parts.push(`${breakdown.pass} pass`);
  if (breakdown.fail > 0) parts.push(`${breakdown.fail} fail`);
  if (breakdown.error > 0) parts.push(`${breakdown.error} error`);
  if (breakdown.cancelled > 0) parts.push(`${breakdown.cancelled} cancelled`);
  if (breakdown.unscored > 0) parts.push(`${breakdown.unscored} unscored`);
  if (breakdown.pending > 0) parts.push(`${breakdown.pending} pending`);
  if (parts.length === 0) return `${breakdown.total} evals`;
  return parts.join(' · ');
}

export function deriveCombinedStatus(
  evals: EvalSummary[],
  isEvalRunning: (evalId: string) => boolean,
): CombinedStatus {
  if (evals.length === 0) return 'pending';
  let hasPass = false;
  let hasPending = false;
  let hasRunning = false;
  let hasCancelled = false;
  let hasError = false;
  let hasFail = false;
  let hasStale = false;
  let hasOutdated = false;
  let hasUnscored = false;

  for (const ev of evals) {
    const status = getEvalSummaryDisplayStatus(ev, isEvalRunning);
    if (status === 'running') hasRunning = true;
    else if (status === 'error') hasError = true;
    else if (status === 'fail') hasFail = true;
    else if (status === 'stale') hasStale = true;
    else if (status === 'outdated') hasOutdated = true;
    else if (status === 'unscored') hasUnscored = true;
    else if (status === 'cancelled') hasCancelled = true;
    else if (status === 'pass') hasPass = true;
    else hasPending = true;
  }

  if (hasRunning) return 'running';
  if (hasError) return 'error';
  if (hasFail) return 'fail';
  if (hasStale) return 'stale';
  if (hasOutdated) return 'outdated';
  if (hasUnscored) return 'unscored';
  if (hasCancelled) return 'cancelled';
  if (hasPending || !hasPass) return 'pending';
  return 'pass';
}

export function collectEvalsInFolder(
  evals: EvalSummary[],
  folderPath: string,
): EvalSummary[] {
  const inFile = evals.filter((ev) => ev.filePath === folderPath);
  if (inFile.length > 0) return inFile;

  const prefixLen = getTreePrefixLength(evals);
  const prefix = folderPath ? `${folderPath}/` : '';
  return evals.filter((ev) => {
    const dir = getDirSegments(ev.filePath).slice(prefixLen).join('/');
    return dir === folderPath || dir.startsWith(prefix);
  });
}
