import { createGlobalStyle } from 'vindur';
import { colors } from '#src/style/colors';

const _ = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');

  :root {
    color-scheme: light;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
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
      'Geist', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui,
      sans-serif;
    font-feature-settings: 'ss01', 'ss03', 'cv11';
    background: ${colors.bg.var};
    color: ${colors.text.var};
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    letter-spacing: -0.005em;
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
    background: ${colors.borderStrong.var};
    border-radius: 10px;
    border: 2px solid ${colors.bg.var};
  }

  ::-webkit-scrollbar-thumb:hover {
    background: ${colors.textDim.var};
  }

  button {
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    color: inherit;
    letter-spacing: inherit;
  }

  input,
  select,
  textarea {
    font-family: inherit;
    font-size: inherit;
    color: inherit;
  }

  a {
    color: ${colors.accentDim.var};
    text-decoration: none;
  }

  a:hover {
    color: ${colors.accent.var};
    text-decoration: underline;
    text-underline-offset: 3px;
  }
`;
