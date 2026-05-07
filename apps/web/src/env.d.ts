/// <reference types="vite/client" />

declare module '*.css' {}

interface ImportMetaEnv {
  readonly VITE_AGENT_EVALS_API_BASE_URL: string;
}
