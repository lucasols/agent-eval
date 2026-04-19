import { colors } from '#src/style/colors';
import { createGlobalStyle } from 'vindur';

const _ = createGlobalStyle`
  :root {
    color-scheme: light;
    --radius-sm: 0px;
    --radius-md: 0px;
    --radius-lg: 0px;
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
      'JetBrains Mono', 'SF Mono', 'Fira Code', 'Fira Mono', ui-monospace,
      monospace;
    font-feature-settings: 'tnum', 'ss01', 'cv02';
    background: ${colors.bg.var};
    color: ${colors.text.var};
    font-size: 16px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    letter-spacing: 0.005em;
  }

  #root {
    height: 100%;
  }

  ::selection {
    background: ${colors.accent.alpha(0.35)};
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
