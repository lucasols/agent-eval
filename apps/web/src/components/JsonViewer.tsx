import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import JsonView, { type JsonViewProps } from 'react18-json-view';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, monoFont, transition } from '#src/style/helpers';

const ViewerWrapper = styled.div`
  position: relative;
  min-width: 0;
`;

const ViewerCard = styled.div<{
  compact?: boolean;
  isDetailHeight?: boolean;
  isRawHeight?: boolean;
  expanded?: boolean;
}>`
  ${monoFont};
  font-size: 12px;
  line-height: 1.6;
  color: ${colors.text.var};
  background: ${colors.bg.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-md);
  padding: 12px 14px;
  overflow: auto;
  min-width: 0;

  &.compact {
    font-size: 11px;
    padding: 10px 12px;
  }

  &.isDetailHeight {
    max-height: 200px;
  }

  &.isRawHeight {
    max-height: 320px;
  }

  &.expanded {
    max-height: none;
  }

  & .json-view {
    ${monoFont};
    color: ${colors.text.var};
    font-size: inherit;
    line-height: inherit;
    --json-property: ${colors.accentDim.var};
    --json-index: ${colors.accent.var};
    --json-number: ${colors.accent.var};
    --json-string: ${colors.warning.var};
    --json-boolean: ${colors.error.var};
    --json-null: ${colors.textDim.var};
  }

  & .jv-size,
  & .jv-chevron {
    color: ${colors.textDim.var};
  }

  & .json-view--copy,
  & .json-view--edit,
  & .json-view--link svg {
    color: ${colors.textDim.var};
  }

  & .json-view--input {
    color: ${colors.text.var};
  }
`;

const ToggleButton = styled.button`
  ${inline({ align: 'center', gap: 4 })}
  ${transition({
    duration: 'fast',
    property: 'background, color, border-color',
  })}
  position: absolute;
  bottom: 6px;
  right: 6px;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 500;
  color: ${colors.textMuted.var};
  background: ${colors.bgElevated.var};
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  padding: 3px 7px;
  cursor: pointer;

  &:hover {
    color: ${colors.text.var};
    background: ${colors.surfaceHover.var};
    border-color: ${colors.borderStrong.var};
  }
`;

type JsonViewerProps = {
  value: unknown;
  compact?: boolean;
  maxHeight?: 'detail' | 'raw';
  collapsed?: JsonViewProps['collapsed'];
  displaySize?: JsonViewProps['displaySize'];
  collapseStringsAfterLength?: number;
  collapseObjectsAfterLength?: number;
  enableClipboard?: boolean;
};

/**
 * Renders a JSON value with syntax highlighting. When `maxHeight` is set and
 * the content overflows, a toggle button lets the user expand the viewer to
 * its natural height and collapse it back.
 */
export function JsonViewer({
  value,
  compact = false,
  maxHeight,
  collapsed = false,
  displaySize = 'collapsed',
  collapseStringsAfterLength = 120,
  collapseObjectsAfterLength = 20,
  enableClipboard = true,
}: JsonViewerProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    if (!maxHeight || expanded) return;
    const element = cardRef.current;
    if (!element) return;

    const measure = () => {
      setOverflowing(element.scrollHeight - element.clientHeight > 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [maxHeight, expanded, value]);

  useEffect(() => {
    if (!maxHeight) setExpanded(false);
  }, [maxHeight]);

  const showToggle = maxHeight !== undefined && (overflowing || expanded);

  return (
    <ViewerWrapper>
      <ViewerCard
        ref={cardRef}
        compact={compact}
        isDetailHeight={maxHeight === 'detail'}
        isRawHeight={maxHeight === 'raw'}
        expanded={expanded}
      >
        <JsonView
          src={value}
          collapsed={collapsed}
          displaySize={displaySize}
          collapseStringsAfterLength={collapseStringsAfterLength}
          collapseObjectsAfterLength={collapseObjectsAfterLength}
          enableClipboard={enableClipboard}
        />
      </ViewerCard>
      {showToggle ? (
        <ToggleButton
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </ToggleButton>
      ) : null}
    </ViewerWrapper>
  );
}
