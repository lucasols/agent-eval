import { useCallback, useEffect, useRef, useState } from 'react';

type Edge = 'left' | 'right';

type UseResizableWidthOptions = {
  storageKey: string;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  /** Edge where the resize handle is mounted. `right` grows when dragged right; `left` grows when dragged left. */
  edge: Edge;
};

export type UseResizableWidthResult<T extends HTMLElement = HTMLElement> = {
  width: number;
  dragging: boolean;
  rootRef: React.RefObject<T | null>;
  handlePointerDown: (event: React.PointerEvent) => void;
  handleDoubleClick: () => void;
  setWidth: (value: number) => void;
};

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth({
  storageKey,
  minWidth,
  maxWidth,
  defaultWidth,
}: Omit<UseResizableWidthOptions, 'edge'>): number {
  if (typeof window === 'undefined') return defaultWidth;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return defaultWidth;
  const parsed = Number.parseFloat(raw);
  return clamp(parsed, minWidth, maxWidth, defaultWidth);
}

/**
 * Drives a persisted, drag-to-resize width for a panel. The caller renders
 * a handle element that forwards `onPointerDown` / `onDoubleClick` to the
 * returned handlers, and applies `width` to the panel root via `rootRef`.
 *
 * Width is clamped to `[minWidth, maxWidth]`, persisted in `localStorage`
 * under `storageKey`, and reset to `defaultWidth` on double-click.
 */
export function useResizableWidth<T extends HTMLElement = HTMLElement>(
  options: UseResizableWidthOptions,
): UseResizableWidthResult<T> {
  const { storageKey, minWidth, maxWidth, defaultWidth, edge } = options;
  const [width, setWidth] = useState<number>(() =>
    readStoredWidth({ storageKey, minWidth, maxWidth, defaultWidth }),
  );
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<T>(null);

  const boundsRef = useRef({ minWidth, maxWidth, defaultWidth });
  boundsRef.current = { minWidth, maxWidth, defaultWidth };

  useEffect(() => {
    setWidth((current) => clamp(current, minWidth, maxWidth, defaultWidth));
  }, [minWidth, maxWidth, defaultWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const root = rootRef.current;
      if (!root) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = root.getBoundingClientRect().width;
      const direction = edge === 'right' ? 1 : -1;
      setDragging(true);

      function onMove(e: PointerEvent) {
        const bounds = boundsRef.current;
        const delta = (e.clientX - startX) * direction;
        const next = clamp(
          startWidth + delta,
          bounds.minWidth,
          bounds.maxWidth,
          bounds.defaultWidth,
        );
        setWidth(next);
      }

      function onUp() {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [edge],
  );

  const handleDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth]);

  const setWidthClamped = useCallback((value: number) => {
    const bounds = boundsRef.current;
    setWidth(
      clamp(value, bounds.minWidth, bounds.maxWidth, bounds.defaultWidth),
    );
  }, []);

  return {
    width,
    dragging,
    rootRef,
    handlePointerDown,
    handleDoubleClick,
    setWidth: setWidthClamped,
  };
}
