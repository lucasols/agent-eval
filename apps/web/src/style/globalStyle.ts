import { createGlobalStyle } from 'vindur';
import { colors } from './colors.ts';

const _ = createGlobalStyle`
  :root {
    color-scheme: dark;
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: ${colors.bg.var};
    color: ${colors.text.var};
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  #root {
    height: 100%;
  }

  button {
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }

  input,
  select {
    font-family: inherit;
    font-size: inherit;
  }
`;
