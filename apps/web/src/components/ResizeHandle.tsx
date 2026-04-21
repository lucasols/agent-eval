import { styled } from 'vindur';
import { colors } from '#src/style/colors';

const HandleRoot = styled.div<{ dragging: boolean; onLeftEdge: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  right: -3px;
  cursor: col-resize;
  z-index: 5;
  user-select: none;
  touch-action: none;

  &.onLeftEdge {
    right: auto;
    left: -3px;
  }

  &::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
    transition: background 0.15s ease;
  }

  &:hover::after,
  &.dragging::after {
    background: ${colors.accent.var};
  }
`;

type ResizeHandleProps = {
  dragging: boolean;
  /** Edge the handle is pinned to. `right` for panels on the shell's left
   *  side (e.g. sidebar); `left` for panels on the shell's right side
   *  (e.g. case/run drawers). */
  edge: 'left' | 'right';
  onPointerDown: (event: React.PointerEvent) => void;
  onDoubleClick: () => void;
};

/**
 * Drag handle for `useResizableWidth`. Mount inside a `position: relative`
 * panel root.
 */
export function ResizeHandle({
  dragging,
  edge,
  onPointerDown,
  onDoubleClick,
}: ResizeHandleProps) {
  return (
    <HandleRoot
      dragging={dragging}
      onLeftEdge={edge === 'left'}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
