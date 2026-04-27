import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'react18-json-view/src/style.css';
import { App } from '#src/App';
import '#src/style/globalStyle';

const rootEl = document.getElementById('root');

if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
