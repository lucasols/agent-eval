import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vindurPlugin } from '@vindur-css/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { getDevPorts } from '../../scripts/dev-ports.mjs';

const rootDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(rootDir, 'src');
const { serverPort, webPort } = getDevPorts();

export default defineConfig(({ command }) => ({
  define: {
    'import.meta.env.VITE_AGENT_EVALS_API_BASE_URL': JSON.stringify(
      command === 'serve' ? `http://127.0.0.1:${String(serverPort)}` : '',
    ),
  },
  plugins: [
    vindurPlugin({ importAliases: { '#src': srcDir } }),
    react({ babel: { plugins: [['babel-plugin-react-compiler']] } }),
  ],
  resolve: { alias: { '#src': srcDir } },
  server: { host: '127.0.0.1', port: webPort, strictPort: true },
}));
