import '@ls-stack/agent-eval';

declare module '@ls-stack/agent-eval' {
  interface AgentEvalTagRegistry {
    tags: 'example' | 'refunds' | 'media' | 'manual' | 'playground' | 'slow';
  }
}
