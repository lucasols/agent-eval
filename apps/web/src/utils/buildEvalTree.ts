import type { EvalSummary } from '@agent-evals/shared';

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
        const aName = a.title ?? a.id;
        const bName = b.title ?? b.id;
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
  return node.evalSummary.title ?? node.evalSummary.id;
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
