import { Store } from 't-state';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'agent-evals.sidebar-width';
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_DEFAULT_WIDTH = 248;

function initialSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!raw) return SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, parsed),
  );
}

type LayoutState = { sidebarWidth: number };

/**
 * Shared layout state so right-side drawers can cap their max width to
 * `viewport - sidebarWidth` reactively as the sidebar is resized.
 */
export const layoutStore = new Store<LayoutState>({
  state: { sidebarWidth: initialSidebarWidth() },
});

export function setSidebarWidth(width: number): void {
  layoutStore.setState((s) => ({ ...s, sidebarWidth: width }));
}
