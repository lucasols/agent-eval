import { hc } from 'hono/client';
// eslint-disable-next-line @ls-stack/no-relative-imports, no-restricted-syntax -- this is needed
import type { AppType } from '../../../server/src/app.ts';

const baseUrl = '/';

export const apiClient = hc<AppType>(baseUrl);
