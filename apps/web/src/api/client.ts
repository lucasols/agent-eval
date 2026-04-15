import { hc } from 'hono/client';
import type { AppType } from '../../../server/src/app.ts';

const baseUrl = '/';

export const apiClient = hc<AppType>(baseUrl);
