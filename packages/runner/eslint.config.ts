import { createBaseConfig } from '../../eslint.config.base.ts';

export default createBaseConfig({
  tsconfigRootDir: import.meta.dirname,
});
