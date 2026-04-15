import { Store } from 't-state';

export type Selection =
  | { kind: 'none' }
  | { kind: 'eval'; id: string }
  | { kind: 'folder'; path: string };

type SelectionState = {
  selection: Selection;
  expandedFolders: Set<string>;
};

function readSelectionFromUrl(): Selection {
  if (typeof window === 'undefined') return { kind: 'none' };
  const params = new URLSearchParams(window.location.search);
  const evalId = params.get('eval');
  if (evalId) return { kind: 'eval', id: evalId };
  const folder = params.get('folder');
  if (folder) return { kind: 'folder', path: folder };
  return { kind: 'none' };
}

function expandedFoldersForSelection(selection: Selection): Set<string> {
  const expanded = new Set<string>();
  if (selection.kind !== 'folder') return expanded;
  const parts = selection.path.split('/');
  for (let i = 1; i <= parts.length; i++) {
    expanded.add(parts.slice(0, i).join('/'));
  }
  return expanded;
}

const initialSelection = readSelectionFromUrl();

export const selectionStore = new Store<SelectionState>({
  state: {
    selection: initialSelection,
    expandedFolders: expandedFoldersForSelection(initialSelection),
  },
});

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
    const next = new Set(prev.expandedFolders);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    return { ...prev, expandedFolders: next };
  });
}

export function expandFolder(path: string): void {
  selectionStore.setState((prev) => {
    if (prev.expandedFolders.has(path)) return prev;
    const next = new Set(prev.expandedFolders);
    next.add(path);
    return { ...prev, expandedFolders: next };
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const selection = readSelectionFromUrl();
    selectionStore.setState((prev) => ({
      ...prev,
      selection,
      expandedFolders: new Set([
        ...prev.expandedFolders,
        ...expandedFoldersForSelection(selection),
      ]),
    }));
  });
}
