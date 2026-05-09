import { createStoreManager, type StoreError } from 'tsdf';

function normalizeStoreError(error: Error): StoreError {
  return {
    code: 500,
    id: 'fetch-error',
    message: error.message || 'Request failed',
  };
}

export const dataStoreManager = createStoreManager({
  getSessionKey: () => 'agent-evals-local',
  errorNormalizer: normalizeStoreError,
  blockWindowClose: null,
  revalidateOnWindowFocus: false,
});
