import JsonView, { type JsonViewProps } from '@uiw/react-json-view';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  --w-rjv-font-family: inherit;
  --w-rjv-color: ${colors.text.var};
  --w-rjv-background-color: transparent;
  --w-rjv-line-color: ${colors.border.var};
  --w-rjv-arrow-color: ${colors.textDim.var};
  --w-rjv-info-color: ${colors.textDim.var};
  --w-rjv-update-color: ${colors.accent.alpha(0.16)};
  --w-rjv-copied-color: ${colors.textDim.var};
  --w-rjv-copied-success-color: ${colors.success.var};
  --w-rjv-key-number: ${colors.accent.var};
  --w-rjv-key-string: ${colors.accentDim.var};
  --w-rjv-curlybraces-color: ${colors.textMuted.var};
  --w-rjv-colon-color: ${colors.textMuted.var};
  --w-rjv-brackets-color: ${colors.textMuted.var};
  --w-rjv-ellipsis-color: ${colors.warning.var};
  --w-rjv-quotes-color: ${colors.accentDim.var};
  --w-rjv-quotes-string-color: ${colors.warning.var};
  --w-rjv-type-string-color: ${colors.warning.var};
  --w-rjv-type-int-color: ${colors.accent.var};
  --w-rjv-type-float-color: ${colors.accent.var};
  --w-rjv-type-bigint-color: ${colors.accent.var};
  --w-rjv-type-boolean-color: ${colors.error.var};
  --w-rjv-type-date-color: ${colors.cost.var};
  --w-rjv-type-url-color: ${colors.accentDim.var};
  --w-rjv-type-null-color: ${colors.textDim.var};
  --w-rjv-type-nan-color: ${colors.cost.var};
  --w-rjv-type-undefined-color: ${colors.textDim.var};

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

  & .w-rjv {
    ${monoFont};
    color: ${colors.text.var};
    font-size: inherit !important;
    line-height: inherit !important;
    background: transparent;
  }

  & .w-rjv-object-size,
  & .w-rjv-object-extra {
    color: ${colors.textDim.var};
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
  collapsed?: JsonViewProps<object>['collapsed'];
  collapseStringsAfterLength?: number;
  enableClipboard?: boolean;
};

const PrimitiveValue = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
`;

function formatPrimitiveValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[Function]';
  return '[Object]';
}

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
  collapseStringsAfterLength = 120,
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
        {typeof value === 'object' && value !== null ? (
          <JsonView
            value={value}
            collapsed={collapsed}
            displayDataTypes={false}
            shortenTextAfterLength={collapseStringsAfterLength}
            enableClipboard={enableClipboard}
          />
        ) : (
          <PrimitiveValue>{formatPrimitiveValue(value)}</PrimitiveValue>
        )}
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
