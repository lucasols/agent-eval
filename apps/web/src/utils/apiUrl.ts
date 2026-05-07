export const apiBaseUrl = import.meta.env.VITE_AGENT_EVALS_API_BASE_URL;

export function apiUrl(path: `/api${string}`): string {
  return `${apiBaseUrl}${path}`;
}
