import { hc } from 'hono/client';
import { apiBaseUrl } from '#src/utils/apiUrl';
// eslint-disable-next-line @ls-stack/no-relative-imports, no-restricted-syntax -- this is needed
import type { AppType } from '../../../server/src/app.ts';

export const apiClient = hc<AppType>(`${apiBaseUrl}/`);
