import type { EvalDisplayStatus } from '@agent-evals/shared';
import { Store } from 't-state';
import {
  getCurrentSearchParams,
  updateSearchParams,
} from '../hooks/useSearchParams.ts';
import { clearDrawerSelectionState } from './runStore.ts';

export type Selection =
  | { kind: 'none' }
  | { kind: 'eval'; id: string }
  | { kind: 'folder'; path: string };

export const EVAL_STATUS_FILTER_OPTIONS = [
  'running',
  'pass',
  'fail',
  'error',
  'stale',
  'outdated',
  'unscored',
  'cancelled',
  'pending',
] satisfies EvalDisplayStatus[];

type SelectionState = {
  selection: Selection;
  collapsedFolders: Set<string>;
  statusFilters: Set<EvalDisplayStatus>;
};

function parseEvalDisplayStatus(value: string): EvalDisplayStatus | undefined {
  if (value === 'running') return 'running';
  if (value === 'pass') return 'pass';
  if (value === 'fail') return 'fail';
  if (value === 'error') return 'error';
  if (value === 'stale') return 'stale';
  if (value === 'outdated') return 'outdated';
  if (value === 'unscored') return 'unscored';
  if (value === 'cancelled') return 'cancelled';
  if (value === 'pending') return 'pending';
  return undefined;
}

function readStatusFiltersFromSearchParams(
  searchParams: URLSearchParams,
): Set<EvalDisplayStatus> {
  const statusFilters = new Set<EvalDisplayStatus>();
  for (const rawValue of searchParams.getAll('status')) {
    for (const value of rawValue.split(',')) {
      const status = parseEvalDisplayStatus(value);
      if (status) statusFilters.add(status);
    }
  }
  return statusFilters;
}

function sameStatusFilters(
  left: Set<EvalDisplayStatus>,
  right: Set<EvalDisplayStatus>,
): boolean {
  if (left.size !== right.size) return false;
  for (const status of left) {
    if (!right.has(status)) return false;
  }
  return true;
}

function writeStatusFiltersToSearchParams(
  searchParams: URLSearchParams,
  statusFilters: Set<EvalDisplayStatus>,
): void {
  searchParams.delete('status');
  for (const status of EVAL_STATUS_FILTER_OPTIONS) {
    if (statusFilters.has(status)) searchParams.append('status', status);
  }
}

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
const initialStatusFilters = readStatusFiltersFromSearchParams(
  getCurrentSearchParams(),
);

export const selectionStore = new Store<SelectionState>({
  state: {
    selection: initialSelection,
    collapsedFolders: new Set<string>(),
    statusFilters: initialStatusFilters,
  },
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

function applySelectionFromUrl(
  selection: Selection,
  statusFilters: Set<EvalDisplayStatus>,
): void {
  selectionStore.setState((prev) => {
    let collapsedFolders = prev.collapsedFolders;
    let collapsedChanged = false;

    if (selection.kind === 'folder') {
      const collapsed = new Set(prev.collapsedFolders);
      const parts = selection.path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        collapsed.delete(parts.slice(0, i).join('/'));
      }

      collapsedChanged =
        collapsed.size !== prev.collapsedFolders.size ||
        [...collapsed].some((path) => !prev.collapsedFolders.has(path));
      collapsedFolders = collapsed;
    }

    const selectionChanged = !sameSelection(prev.selection, selection);
    const statusFiltersChanged = !sameStatusFilters(
      prev.statusFilters,
      statusFilters,
    );

    if (!selectionChanged && !collapsedChanged && !statusFiltersChanged) {
      return prev;
    }

    return { ...prev, selection, collapsedFolders, statusFilters };
  });
}

function setSelection(selection: Selection): void {
  selectionStore.setPartialState({ selection });
  clearDrawerSelectionState();
  updateSearchParams((searchParams) => {
    searchParams.delete('eval');
    searchParams.delete('folder');
    searchParams.delete('run');
    searchParams.delete('runEval');
    searchParams.delete('runFolder');
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

export function toggleEvalStatusFilter(status: EvalDisplayStatus): void {
  const statusFilters = new Set(selectionStore.state.statusFilters);
  if (statusFilters.has(status)) {
    statusFilters.delete(status);
  } else {
    statusFilters.add(status);
  }

  selectionStore.setPartialState({ statusFilters });
  updateSearchParams((searchParams) => {
    writeStatusFiltersToSearchParams(searchParams, statusFilters);
  });
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
  const statusFilters = readStatusFiltersFromSearchParams(searchParams);
  applySelectionFromUrl(selection, statusFilters);
}
