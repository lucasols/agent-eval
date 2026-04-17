import type { EvalSummary } from '@agent-evals/shared';

export type TreeFolder = {
  kind: 'folder';
  path: string;
  name: string;
  children: TreeNode[];
};

export type TreeLeaf = {
  kind: 'leaf';
  path: string;
  filePath: string;
  evalSummary: EvalSummary;
};

export type TreeNode = TreeFolder | TreeLeaf;

function getDirSegments(filePath: string): string[] {
  const parts = filePath.split('/').filter((p) => p.length > 0);
  return parts.slice(0, -1);
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

export function buildEvalTree(evals: EvalSummary[]): TreeNode[] {
  const root: TreeFolder = {
    kind: 'folder',
    path: '',
    name: '',
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
        children: [],
      };
      folderIndex.set(currentPath, folder);
      parent.children.push(folder);
      parent = folder;
    }
    return parent;
  }

  const allDirs = evals.map((ev) => getDirSegments(ev.filePath));
  const prefixLen = commonPrefixLength(allDirs);

  for (const ev of evals) {
    const segments = getDirSegments(ev.filePath).slice(prefixLen);
    const parent = ensureFolder(segments);
    parent.children.push({
      kind: 'leaf',
      path: `${ev.filePath}#${ev.id}`,
      filePath: ev.filePath,
      evalSummary: ev,
    });
  }

  sortTree(root);

  return root.children;
}

function sortTree(folder: TreeFolder): void {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const aName = a.kind === 'folder' ? a.name : (a.evalSummary.title ?? a.evalSummary.id);
    const bName = b.kind === 'folder' ? b.name : (b.evalSummary.title ?? b.evalSummary.id);
    return aName.localeCompare(bName);
  });
  for (const child of folder.children) {
    if (child.kind === 'folder') sortTree(child);
  }
}

export function collectEvalsInFolder(
  evals: EvalSummary[],
  folderPath: string,
): EvalSummary[] {
  const allDirs = evals.map((ev) => getDirSegments(ev.filePath));
  const prefixLen = commonPrefixLength(allDirs);
  const prefix = folderPath ? `${folderPath}/` : '';
  return evals.filter((ev) => {
    const dir = getDirSegments(ev.filePath).slice(prefixLen).join('/');
    return dir === folderPath || dir.startsWith(prefix);
  });
}
