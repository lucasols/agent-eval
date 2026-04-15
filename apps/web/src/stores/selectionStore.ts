import { Store } from 't-state';

export type Selection =
  | { kind: 'none' }
  | { kind: 'eval'; id: string }
  | { kind: 'folder'; path: string };

type SelectionState = {
  selection: Selection;
  expandedFolders: Set<string>;
};

export const selectionStore = new Store<SelectionState>({
  state: {
    selection: { kind: 'none' },
    expandedFolders: new Set<string>(),
  },
});

export function selectEval(id: string): void {
  selectionStore.setPartialState({ selection: { kind: 'eval', id } });
}

export function selectFolder(path: string): void {
  selectionStore.setPartialState({ selection: { kind: 'folder', path } });
}

export function clearSelection(): void {
  selectionStore.setPartialState({ selection: { kind: 'none' } });
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
