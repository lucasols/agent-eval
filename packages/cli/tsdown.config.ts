import { defineConfig, type UserConfig } from 'tsdown';

const sharedConfig = {
  deps: {
    alwaysBundle: [
      '@agent-evals/runner',
      '@agent-evals/sdk',
      '@agent-evals/shared',
    ],
  },
  format: 'esm',
  platform: 'node',
} satisfies UserConfig;

export default defineConfig([
  {
    ...sharedConfig,
    clean: true,
    copy: [
      { from: '../../apps/web/dist/**/*', to: 'dist/web', flatten: false },
    ],
    dts: false,
    entry: ['src/index.ts', 'src/bin.ts', 'src/runChild.ts'],
    name: 'cli-js',
  },
  {
    ...sharedConfig,
    clean: false,
    dts: { eager: true, emitDtsOnly: true, tsconfig: 'tsconfig.build.json' },
    entry: 'src/index.ts',
    name: 'cli-types',
  },
]);
