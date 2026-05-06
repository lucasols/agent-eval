import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vindurPlugin } from '@vindur-css/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { getDevPorts } from '../../scripts/dev-ports.mjs';

const rootDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(rootDir, 'src');
const { serverPort, webPort } = getDevPorts();

export default defineConfig({
  plugins: [
    vindurPlugin({ importAliases: { '#src': srcDir } }),
    react({ babel: { plugins: [['babel-plugin-react-compiler']] } }),
  ],
  resolve: { alias: { '#src': srcDir } },
  server: {
    host: '0.0.0.0',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${String(serverPort)}`,
        changeOrigin: true,
      },
    },
  },
});
