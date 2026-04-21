import { useSyncExternalStore } from 'react';

const SEARCH_PARAMS_CHANGE_EVENT = 'agent-evals:search-params-change';

let historyPatched = false;

function dispatchSearchParamsChange(): void {
  window.dispatchEvent(new Event(SEARCH_PARAMS_CHANGE_EVENT));
}

function ensureHistoryPatched(): void {
  if (typeof window === 'undefined' || historyPatched) return;

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = function pushState(...args) {
    originalPushState(...args);
    dispatchSearchParamsChange();
  };

  window.history.replaceState = function replaceState(...args) {
    originalReplaceState(...args);
    dispatchSearchParamsChange();
  };

  historyPatched = true;
}

function getSearchSnapshot(): string {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

function subscribeToSearchParams(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  ensureHistoryPatched();

  window.addEventListener('popstate', onStoreChange);
  window.addEventListener(SEARCH_PARAMS_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('popstate', onStoreChange);
    window.removeEventListener(SEARCH_PARAMS_CHANGE_EVENT, onStoreChange);
  };
}

export function getCurrentSearchParams(): URLSearchParams {
  return new URLSearchParams(getSearchSnapshot());
}

export function updateSearchParams(
  update: (searchParams: URLSearchParams) => void,
): void {
  if (typeof window === 'undefined') return;

  ensureHistoryPatched();

  const searchParams = getCurrentSearchParams();
  update(searchParams);

  const search = searchParams.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (next === current) return;
  window.history.pushState(null, '', next);
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    subscribeToSearchParams,
    getSearchSnapshot,
    () => '',
  );

  return new URLSearchParams(search);
}
