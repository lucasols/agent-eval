import path from 'path';
import { vindurPlugin } from '@vindur-css/eslint-plugin';
import { createBaseConfig, ERROR } from '../../eslint.config.base.ts';

export default createBaseConfig({
  tsconfigRootDir: import.meta.dirname,
  extraIgnorePatterns: ['dist/**', 'vite.config.ts'],
  extraRuleGroups: [
    {
      plugins: { '@vindur': vindurPlugin },
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      rules: {
        '@vindur/check-transform': [
          ERROR,
          {
            importAliases: { '#src': path.resolve(import.meta.dirname, 'src') },
          },
        ],
      },
    },
  ],
});
