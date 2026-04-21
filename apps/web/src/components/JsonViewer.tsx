import JsonView, { type JsonViewProps } from 'react18-json-view';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { monoFont } from '#src/style/helpers';

const ViewerCard = styled.div<{
  compact?: boolean;
  isDetailHeight?: boolean;
  isRawHeight?: boolean;
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
  return (
    <ViewerCard
      compact={compact}
      isDetailHeight={maxHeight === 'detail'}
      isRawHeight={maxHeight === 'raw'}
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
  );
}
