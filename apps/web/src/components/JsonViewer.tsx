import JsonView, { type JsonViewProps } from '@uiw/react-json-view';
import { Maximize2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resultify } from 't-result';
import { styled } from 'vindur';
import { IconButton } from '#src/components/IconButton';
import { formatPrimitiveValue } from '#src/components/JsonViewer.search';
import { Tooltip } from '#src/components/Tooltip';
import {
  openJsonFullscreenModal,
  openTextViewModal,
} from '#src/stores/modalStore';
import { colors } from '#src/style/colors';
import { inline, monoFont, transition } from '#src/style/helpers';
import { deserializeSerializedValue } from '#src/utils/serializedValues';

const newlineRegex = /\n/;

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

const ViewerActions = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  border: 1px solid ${colors.border.var};
  border-radius: var(--radius-sm);
  background: ${colors.bgElevated.alpha(0.94)};
  box-shadow: 0 4px 14px -10px ${colors.black.alpha(0.35)};

  & button {
    width: 22px;
    height: 22px;
  }

  & svg {
    width: 12px;
    height: 12px;
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
  collapsedPreviewValue?: unknown;
  compact?: boolean;
  maxHeight?: 'detail' | 'raw';
  collapsed?: JsonViewProps<object>['collapsed'];
  collapseStringsAfterLength?: number;
  enableClipboard?: boolean;
  fullscreen?: boolean;
  displayDataTypes?: boolean;
};

const PrimitiveValue = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function formatRootPrimitiveValue(value: unknown): string {
  if (typeof value === 'string') return formatRootStringValue(value);
  return formatPrimitiveValue(value);
}

function formatRootStringValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return value;

  const parsed = resultify((): unknown => JSON.parse(trimmed));
  if (parsed.error || typeof parsed.value !== 'string') return value;
  return parsed.value;
}

function readRowTextValue(
  parentValue: unknown,
  keyName: unknown,
): string | null {
  if (isUnknownArray(parentValue)) {
    const index =
      typeof keyName === 'number'
        ? keyName
        : typeof keyName === 'string'
          ? Number.parseInt(keyName, 10)
          : Number.NaN;
    if (!Number.isInteger(index)) return null;
    const value = parentValue[index];
    return typeof value === 'string' ? value : null;
  }

  if (!isRecord(parentValue) || typeof keyName !== 'string') return null;
  const value = parentValue[keyName];
  return typeof value === 'string' ? value : null;
}

function JsonContent({
  value,
  collapsed,
  collapseStringsAfterLength,
  enableClipboard,
  displayDataTypes,
}: {
  value: unknown;
  collapsed: JsonViewProps<object>['collapsed'];
  collapseStringsAfterLength: number;
  enableClipboard: boolean;
  displayDataTypes: boolean;
}) {
  function openTextValue(text: string, keyName: unknown) {
    openTextViewModal({
      title: 'JSON text value',
      subtitle:
        typeof keyName === 'string' || typeof keyName === 'number'
          ? String(keyName)
          : undefined,
      text,
    });
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <>
        <JsonView
          value={value}
          collapsed={collapsed}
          displayDataTypes={displayDataTypes}
          shortenTextAfterLength={collapseStringsAfterLength}
          enableClipboard={enableClipboard}
        >
          <JsonView.String
            render={({ children, ...reset }, { type }) => {
              if (type === 'type') {
                return <span />;
              }
              if (typeof children === 'string' && newlineRegex.test(children)) {
                return (
                  <span {...reset}>"{children.replaceAll('\n', '\\n')}"</span>
                );
              }

              return;
            }}
          />
          <JsonView.Row
            as="div"
            render={(props, { keyName, parentValue }) => {
              const textValue = readRowTextValue(parentValue, keyName);
              return (
                <div
                  {...props}
                  onClick={(event) => {
                    if (textValue !== null && event.altKey) {
                      event.preventDefault();
                      event.stopPropagation();
                      openTextValue(textValue, keyName);
                      return;
                    }
                    props.onClick?.(event);
                  }}
                />
              );
            }}
          />
        </JsonView>
      </>
    );
  }

  if (typeof value === 'string') {
    const displayText = formatRootStringValue(value);
    return (
      <>
        <PrimitiveValue
          onClick={(event) => {
            if (!event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            openTextValue(displayText, undefined);
          }}
        >
          {displayText}
        </PrimitiveValue>
      </>
    );
  }

  return <PrimitiveValue>{formatRootPrimitiveValue(value)}</PrimitiveValue>;
}

/**
 * Renders a JSON value with syntax highlighting. When `maxHeight` is set and
 * the content overflows, a toggle button expands object/array values inline.
 * Root string values open `TextViewModal` instead so long text is inspected as
 * text rather than as a JSON string literal.
 */
export function JsonViewer({
  value,
  collapsedPreviewValue,
  compact = false,
  maxHeight,
  collapsed = false,
  collapseStringsAfterLength = 120,
  enableClipboard = true,
  fullscreen = true,
  displayDataTypes = false,
}: JsonViewerProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const displayValue = useMemo(
    () => deserializeSerializedValue(value),
    [value],
  );
  const previewValue = useMemo(
    () =>
      collapsedPreviewValue === undefined
        ? undefined
        : deserializeSerializedValue(collapsedPreviewValue),
    [collapsedPreviewValue],
  );
  const inlineValue =
    previewValue !== undefined && !expanded ? previewValue : displayValue;
  const rootStringValue =
    typeof displayValue === 'string'
      ? formatRootStringValue(displayValue)
      : undefined;

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
  }, [maxHeight, expanded, inlineValue]);

  useEffect(() => {
    if (!maxHeight) setExpanded(false);
  }, [maxHeight]);

  const showToggle =
    maxHeight !== undefined &&
    (overflowing || expanded || previewValue !== undefined);

  return (
    <ViewerWrapper>
      {fullscreen ? (
        <ViewerActions>
          <Tooltip
            content={
              rootStringValue === undefined
                ? 'View JSON fullscreen'
                : 'View text fullscreen'
            }
          >
            <IconButton
              aria-label={
                rootStringValue === undefined
                  ? 'View JSON fullscreen'
                  : 'View text fullscreen'
              }
              onClick={() => {
                if (rootStringValue !== undefined) {
                  openTextViewModal({
                    title: 'JSON text value',
                    text: rootStringValue,
                  });
                  return;
                }

                openJsonFullscreenModal({
                  value: displayValue,
                  collapsed,
                  collapseStringsAfterLength,
                  enableClipboard,
                });
              }}
            >
              <Maximize2 />
            </IconButton>
          </Tooltip>
        </ViewerActions>
      ) : null}
      <ViewerCard
        ref={cardRef}
        compact={compact}
        isDetailHeight={maxHeight === 'detail'}
        isRawHeight={maxHeight === 'raw'}
        expanded={expanded}
      >
        <JsonContent
          value={inlineValue}
          collapsed={collapsed}
          collapseStringsAfterLength={collapseStringsAfterLength}
          enableClipboard={enableClipboard}
          displayDataTypes={displayDataTypes}
        />
      </ViewerCard>
      {showToggle ? (
        <ToggleButton
          type="button"
          onClick={() => {
            if (rootStringValue !== undefined) {
              openTextViewModal({
                title: 'JSON text value',
                text: rootStringValue,
              });
              return;
            }
            setExpanded((v) => !v);
          }}
          aria-expanded={rootStringValue === undefined ? expanded : false}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </ToggleButton>
      ) : null}
    </ViewerWrapper>
  );
}
