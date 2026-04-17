import type { DisplayBlock, EvalTraceSpan } from '@agent-evals/shared';
import { getCurrentScope } from './runtime.ts';
import type { EvalTraceTree } from './types.ts';

export type TraceActiveSpan = {
  setInput(value: unknown): void;
  setOutput(value: unknown): void;
  setDisplay(blocks: DisplayBlock[]): void;
  setAttributes(value: Record<string, unknown>): void;
  setUsage(value: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): void;
  setCostUsd(value: number | null): void;
  setCache(value: {
    status: 'hit' | 'miss' | 'write' | 'bypass';
    key?: string;
  }): void;
};

let spanIdCounter = 0;

function generateSpanId(): string {
  spanIdCounter++;
  return `span_${String(Date.now())}_${String(spanIdCounter)}`;
}

function noopActiveSpan(): TraceActiveSpan {
  return {
    setInput() {},
    setOutput() {},
    setDisplay() {},
    setAttributes() {},
    setUsage() {},
    setCostUsd() {},
    setCache() {},
  };
}

export const tracer = {
  async span<T>(
    info: {
      kind: EvalTraceSpan['kind'];
      name: string;
      attributes?: Record<string, unknown>;
    },
    fn: (span: TraceActiveSpan) => Promise<T> | T,
  ): Promise<T> {
    const scope = getCurrentScope();
    if (!scope) {
      return await fn(noopActiveSpan());
    }

    const id = generateSpanId();
    const parentId = scope.spanStack.at(-1) ?? null;

    const span: EvalTraceSpan = {
      id,
      parentId,
      caseId: scope.caseId,
      kind: info.kind,
      name: info.name,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'running',
      attributes: info.attributes,
    };

    scope.spans.push(span);
    scope.spanStack.push(id);

    const activeSpan: TraceActiveSpan = {
      setInput(value) {
        span.input = value;
      },
      setOutput(value) {
        span.output = value;
      },
      setDisplay(blocks) {
        span.display = blocks;
      },
      setAttributes(value) {
        span.attributes = { ...span.attributes, ...value };
      },
      setUsage(value) {
        span.usage = value;
      },
      setCostUsd(value) {
        span.costUsd = value;
      },
      setCache(value) {
        span.cache = value;
      },
    };

    try {
      const result = await fn(activeSpan);
      span.status = 'ok';
      span.endedAt = new Date().toISOString();
      return result;
    } catch (error) {
      span.status = 'error';
      span.endedAt = new Date().toISOString();
      if (error instanceof Error) {
        span.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      } else {
        span.error = { message: String(error) };
      }
      throw error;
    } finally {
      scope.spanStack.pop();
    }
  },

  checkpoint(name: string, data: unknown): void {
    const scope = getCurrentScope();
    if (!scope) return;
    scope.checkpoints.set(name, data);
    const id = generateSpanId();
    const parentId = scope.spanStack.at(-1) ?? null;
    scope.spans.push({
      id,
      parentId,
      caseId: scope.caseId,
      kind: 'checkpoint',
      name,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: 'ok',
      output: data,
    });
  },
};

export function buildTraceTree(
  spans: EvalTraceSpan[],
  checkpoints: Map<string, unknown>,
): EvalTraceTree {
  const rootSpans = spans.filter((s) => s.parentId === null);

  return {
    spans,
    rootSpans,
    findSpan(name) {
      return spans.find((s) => s.name === name);
    },
    findSpansByKind(kind) {
      return spans.filter((s) => s.kind === kind);
    },
    flattenDfs() {
      const result: EvalTraceSpan[] = [];
      function visit(parentId: string | null) {
        for (const span of spans) {
          if (span.parentId === parentId) {
            result.push(span);
            visit(span.id);
          }
        }
      }
      visit(null);
      return result;
    },
    checkpoints,
  };
}
