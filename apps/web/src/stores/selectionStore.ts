import { Store } from 't-state';
import {
  getCurrentSearchParams,
  updateSearchParams,
} from '../hooks/useSearchParams.ts';

export type Selection =
  | { kind: 'none' }
  | { kind: 'eval'; id: string }
  | { kind: 'folder'; path: string };

type SelectionState = { selection: Selection; collapsedFolders: Set<string> };

function readSelectionFromSearchParams(
  searchParams: URLSearchParams,
): Selection {
  const evalId = searchParams.get('eval');
  if (evalId) return { kind: 'eval', id: evalId };
  const folder = searchParams.get('folder');
  if (folder) return { kind: 'folder', path: folder };
  return { kind: 'none' };
}

const initialSelection = readSelectionFromSearchParams(
  getCurrentSearchParams(),
);

export const selectionStore = new Store<SelectionState>({
  state: { selection: initialSelection, collapsedFolders: new Set<string>() },
});

export function isFolderExpanded(
  collapsedFolders: Set<string>,
  path: string,
): boolean {
  return !collapsedFolders.has(path);
}

function sameSelection(left: Selection, right: Selection): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'none') return true;
  if (left.kind === 'eval' && right.kind === 'eval') {
    return left.id === right.id;
  }
  if (left.kind === 'folder' && right.kind === 'folder') {
    return left.path === right.path;
  }
  return false;
}

function applySelectionFromUrl(selection: Selection): void {
  selectionStore.setState((prev) => {
    if (selection.kind !== 'folder') {
      if (sameSelection(prev.selection, selection)) return prev;
      return { ...prev, selection };
    }

    const collapsed = new Set(prev.collapsedFolders);
    const parts = selection.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      collapsed.delete(parts.slice(0, i).join('/'));
    }

    const collapsedUnchanged =
      collapsed.size === prev.collapsedFolders.size &&
      [...collapsed].every((path) => prev.collapsedFolders.has(path));
    if (sameSelection(prev.selection, selection) && collapsedUnchanged) {
      return prev;
    }

    return { ...prev, selection, collapsedFolders: collapsed };
  });
}

function setSelection(selection: Selection): void {
  selectionStore.setPartialState({ selection });
  updateSearchParams((searchParams) => {
    searchParams.delete('eval');
    searchParams.delete('folder');
    searchParams.delete('run');
    searchParams.delete('caseRun');
    searchParams.delete('case');
    searchParams.delete('caseTab');
    searchParams.delete('span');
    if (selection.kind === 'eval') searchParams.set('eval', selection.id);
    else if (selection.kind === 'folder') {
      searchParams.set('folder', selection.path);
    }
  });
}

export function selectEval(id: string): void {
  setSelection({ kind: 'eval', id });
}

export function selectFolder(path: string): void {
  setSelection({ kind: 'folder', path });
}

export function clearSelection(): void {
  setSelection({ kind: 'none' });
}

export function toggleFolder(path: string): void {
  selectionStore.setState((prev) => {
    const next = new Set(prev.collapsedFolders);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    return { ...prev, collapsedFolders: next };
  });
}

export function expandFolder(path: string): void {
  selectionStore.setState((prev) => {
    if (!prev.collapsedFolders.has(path)) return prev;
    const next = new Set(prev.collapsedFolders);
    next.delete(path);
    return { ...prev, collapsedFolders: next };
  });
}

export function expandAllFolders(): void {
  selectionStore.setState((prev) => {
    if (prev.collapsedFolders.size === 0) return prev;
    return { ...prev, collapsedFolders: new Set<string>() };
  });
}

export function collapseAllFolders(paths: string[]): void {
  selectionStore.setState((prev) => ({
    ...prev,
    collapsedFolders: new Set(paths),
  }));
}

export function syncSelectionFromSearchParams(
  searchParams: URLSearchParams,
): void {
  const selection = readSelectionFromSearchParams(searchParams);
  applySelectionFromUrl(selection);
}
