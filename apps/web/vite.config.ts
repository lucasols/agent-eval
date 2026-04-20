import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vindurPlugin } from '@vindur-css/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(rootDir, 'src');

export default defineConfig({
  plugins: [
    vindurPlugin({ importAliases: { '#src': srcDir } }),
    react({ babel: { plugins: [['babel-plugin-react-compiler']] } }),
  ],
  resolve: { alias: { '#src': srcDir } },
  server: {
    port: 4200,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4100', changeOrigin: true } },
  },
});
