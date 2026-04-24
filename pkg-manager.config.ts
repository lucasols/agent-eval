import { defineConfig } from '@ls-stack/pkg-manager';

export default defineConfig({
  requireMajorConfirmation: true,
  prePublish: [
    { command: 'pnpm lint', label: 'Linting' },
    { command: 'pnpm build', label: 'Building' },
  ],
  monorepo: {
    packages: [{ name: '@ls-stack/agent-eval', path: 'packages/cli' }],
  },
});
