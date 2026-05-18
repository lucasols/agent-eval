import type { EvalDisplayStatus } from '@agent-evals/shared';
import { Store } from 't-state';
import {
  getCurrentSearchParams,
  updateSearchParams,
} from '#src/hooks/useSearchParams';
import { clearDrawerSelectionState } from '#src/stores/runStore';

export type Selection =
  | { kind: 'none' }
  | { kind: 'eval'; id: string }
  | { kind: 'folder'; path: string };

export const EVAL_STATUS_FILTER_OPTIONS = [
  'running',
  'enqueued',
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
  tagFilters: Set<string>;
  searchQuery: string;
};

function parseEvalDisplayStatus(value: string): EvalDisplayStatus | undefined {
  if (value === 'running') return 'running';
  if (value === 'enqueued') return 'enqueued';
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

function readTagFiltersFromSearchParams(
  searchParams: URLSearchParams,
): Set<string> {
  const tagFilters = new Set<string>();
  for (const rawValue of searchParams.getAll('tag')) {
    for (const value of rawValue.split(',')) {
      const trimmed = value.trim();
      if (trimmed.length > 0) tagFilters.add(trimmed);
    }
  }
  return tagFilters;
}

function sameTagFilters(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const tag of left) {
    if (!right.has(tag)) return false;
  }
  return true;
}

function writeTagFiltersToSearchParams(
  searchParams: URLSearchParams,
  tagFilters: Set<string>,
): void {
  searchParams.delete('tag');
  const sortedTags = [...tagFilters].toSorted();
  for (const tag of sortedTags) {
    searchParams.append('tag', tag);
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
const initialTagFilters = readTagFiltersFromSearchParams(
  getCurrentSearchParams(),
);

export const selectionStore = new Store<SelectionState>({
  state: {
    selection: initialSelection,
    collapsedFolders: new Set<string>(),
    statusFilters: initialStatusFilters,
    tagFilters: initialTagFilters,
    searchQuery: '',
  },
});

/** Update the eval search query used to filter the sidebar tree. */
export function setSearchQuery(query: string): void {
  selectionStore.setPartialState({ searchQuery: query });
}

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
  tagFilters: Set<string>,
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
    const tagFiltersChanged = !sameTagFilters(prev.tagFilters, tagFilters);

    if (
      !selectionChanged &&
      !collapsedChanged &&
      !statusFiltersChanged &&
      !tagFiltersChanged
    ) {
      return prev;
    }

    return { ...prev, selection, collapsedFolders, statusFilters, tagFilters };
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

/**
 * Toggle a tag in the active eval tag filter set. When at least one tag is
 * active, eval lists keep only evals whose tags include any selected tag.
 */
export function toggleEvalTagFilter(tag: string): void {
  const tagFilters = new Set(selectionStore.state.tagFilters);
  if (tagFilters.has(tag)) {
    tagFilters.delete(tag);
  } else {
    tagFilters.add(tag);
  }

  selectionStore.setPartialState({ tagFilters });
  updateSearchParams((searchParams) => {
    writeTagFiltersToSearchParams(searchParams, tagFilters);
  });
}

/** Clear every active eval tag filter. */
export function clearEvalTagFilters(): void {
  if (selectionStore.state.tagFilters.size === 0) return;
  selectionStore.setPartialState({ tagFilters: new Set<string>() });
  updateSearchParams((searchParams) => {
    searchParams.delete('tag');
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
  const tagFilters = readTagFiltersFromSearchParams(searchParams);
  applySelectionFromUrl(selection, statusFilters, tagFilters);
}
