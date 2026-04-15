import { createGlobalStyle } from 'vindur';
import { colors } from '#src/style/colors';

const _ = createGlobalStyle`
  :root {
    color-scheme: dark;
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 8px;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html,
  body {
    height: 100%;
    font-family:
      'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui,
      sans-serif;
    font-feature-settings: 'ss01', 'cv01';
    background: ${colors.bg.var};
    color: ${colors.text.var};
    font-size: 13px;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  #root {
    height: 100%;
  }

  ::selection {
    background: ${colors.accent.alpha(0.3)};
    color: ${colors.text.var};
  }

  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: ${colors.border.var};
    border-radius: 5px;
    border: 2px solid ${colors.bg.var};
  }

  ::-webkit-scrollbar-thumb:hover {
    background: ${colors.borderStrong.var};
  }

  button {
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    color: inherit;
  }

  input,
  select,
  textarea {
    font-family: inherit;
    font-size: inherit;
    color: inherit;
  }

  a {
    color: ${colors.accent.var};
    text-decoration: none;
  }

  a:hover {
    color: ${colors.accentHover.var};
  }
`;
