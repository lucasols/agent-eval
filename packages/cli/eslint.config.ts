import { createBaseConfig } from '../../eslint.config.base.ts';

export default createBaseConfig({
  allowDefaultExport: ['**/tsdown.config.ts'],
  tsconfigRootDir: import.meta.dirname,
});
