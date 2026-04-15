import { css, vindurFn } from 'vindur';

export const centerContent = css`
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const fillContainer = css`
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
`;

export const ellipsis = css`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const inline = vindurFn(
  ({
    justify = 'left',
    align = 'center',
    gap = 0,
  }: {
    justify?:
      | 'left'
      | 'center'
      | 'right'
      | 'stretch'
      | 'space-between'
      | 'space-around'
      | 'space-evenly';
    align?: 'left' | 'center' | 'right' | 'stretch';
    gap?: number;
  } = {}) => `
  display: flex;
  align-items: ${
    align === 'left' ? 'flex-start'
    : align === 'right' ? 'flex-end'
    : align
  };
  justify-content: ${
    justify === 'left' ? 'flex-start'
    : justify === 'right' ? 'flex-end'
    : justify
  };
  ${gap ? `gap: ${gap}px;` : ''}
`,
);

export const stack = vindurFn(
  ({
    justify = 'top',
    align = 'stretch',
    gap,
  }: {
    justify?:
      | 'top'
      | 'center'
      | 'bottom'
      | 'space-between'
      | 'space-around'
      | 'space-evenly';
    align?: 'left' | 'center' | 'right' | 'stretch';
    gap?: number;
  } = {}) => `
  display: flex;
  flex-direction: column;
  align-items: ${
    align === 'left' ? 'flex-start'
    : align === 'right' ? 'flex-end'
    : align
  };
  justify-content: ${
    justify === 'top' ? 'flex-start'
    : justify === 'bottom' ? 'flex-end'
    : justify
  };
  ${gap ? `gap: ${gap}px;` : ''}
`,
);

export const transition = vindurFn(
  ({
    duration = 'medium',
    property,
  }: {
    duration?: 'medium' | 'slow' | 'fast';
    property?: string;
  } = {}) =>
    `transition: ${
      duration === 'medium' ? 0.24
      : duration === 'slow' ? 0.36
      : 0.12
    }s cubic-bezier(0.4, 0.0, 0.2, 1);
    ${property ? `transition-property: ${property};` : ''}
  `,
);

export const monoFont = css`
  font-family:
    'JetBrains Mono', 'SF Mono', 'Fira Code', 'Fira Mono', ui-monospace,
    monospace;
  font-feature-settings: 'tnum', 'cv02';
`;

export const sansFont = css`
  font-family:
    'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui,
    sans-serif;
  font-feature-settings: 'ss01', 'cv01';
`;

export const tabularNums = css`
  font-variant-numeric: tabular-nums;
`;
