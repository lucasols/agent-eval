import { Store } from 't-state';

export type Selection =
  | { kind: 'none' }
  | { kind: 'eval'; id: string }
  | { kind: 'folder'; path: string };

type SelectionState = { selection: Selection; collapsedFolders: Set<string> };

function readSelectionFromUrl(): Selection {
  if (typeof window === 'undefined') return { kind: 'none' };
  const params = new URLSearchParams(window.location.search);
  const evalId = params.get('eval');
  if (evalId) return { kind: 'eval', id: evalId };
  const folder = params.get('folder');
  if (folder) return { kind: 'folder', path: folder };
  return { kind: 'none' };
}

const initialSelection = readSelectionFromUrl();

export const selectionStore = new Store<SelectionState>({
  state: { selection: initialSelection, collapsedFolders: new Set<string>() },
});

export function isFolderExpanded(
  collapsedFolders: Set<string>,
  path: string,
): boolean {
  return !collapsedFolders.has(path);
}

function selectionToSearch(selection: Selection): string {
  const params = new URLSearchParams(window.location.search);
  params.delete('eval');
  params.delete('folder');
  if (selection.kind === 'eval') params.set('eval', selection.id);
  else if (selection.kind === 'folder') params.set('folder', selection.path);
  const str = params.toString();
  return str ? `?${str}` : '';
}

function syncUrl(selection: Selection): void {
  if (typeof window === 'undefined') return;
  const search = selectionToSearch(selection);
  const next = `${window.location.pathname}${search}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history.pushState(null, '', next);
}

function setSelection(selection: Selection): void {
  selectionStore.setPartialState({ selection });
  syncUrl(selection);
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

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const selection = readSelectionFromUrl();
    selectionStore.setState((prev) => {
      if (selection.kind !== 'folder') return { ...prev, selection };
      const collapsed = new Set(prev.collapsedFolders);
      const parts = selection.path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        collapsed.delete(parts.slice(0, i).join('/'));
      }
      return { ...prev, selection, collapsedFolders: collapsed };
    });
  });
}
