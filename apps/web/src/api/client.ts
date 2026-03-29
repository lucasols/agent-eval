import { hc } from 'hono/client';
import type { app } from '../../../server/src/app.ts';

const baseUrl = '/';

export const apiClient = hc<typeof app>(baseUrl);
