import { Store } from 't-state';

type SortDirection = 'asc' | 'desc';

type UiState = {
  columnVisibility: Record<string, boolean>;
  sortColumn: string | null;
  sortDirection: SortDirection;
  selectedTraceSpanId: string | null;
};

export const uiStore = new Store<UiState>({
  state: {
    columnVisibility: loadColumnVisibility(),
    sortColumn: null,
    sortDirection: 'asc',
    selectedTraceSpanId: null,
  },
});

function loadColumnVisibility(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem('agent-evals:column-visibility');
    if (stored) return JSON.parse(stored) as Record<string, boolean>;
  } catch {
    // ignore
  }
  return {};
}

export function toggleColumnVisibility(key: string): void {
  uiStore.setState((prev) => {
    const next = {
      ...prev.columnVisibility,
      [key]: !(prev.columnVisibility[key] ?? true),
    };
    localStorage.setItem('agent-evals:column-visibility', JSON.stringify(next));
    return { ...prev, columnVisibility: next };
  });
}

export function setSortColumn(column: string): void {
  uiStore.setState((prev) => {
    if (prev.sortColumn === column) {
      return {
        ...prev,
        sortDirection: prev.sortDirection === 'asc' ? 'desc' : 'asc',
      };
    }
    return { ...prev, sortColumn: column, sortDirection: 'asc' };
  });
}

export function setSelectedTraceSpanId(id: string | null): void {
  uiStore.setPartialState({ selectedTraceSpanId: id });
}
