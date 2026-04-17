import type { EvalTraceSpan } from '@agent-evals/shared';
import { getCurrentScope } from './runtime.ts';
import type { EvalTraceTree } from './types.ts';

export type TraceActiveSpan = {
  setName(value: string): void;
  setAttribute(key: string, value: unknown): void;
  setAttributes(value: Record<string, unknown>): void;
};

let spanIdCounter = 0;

function generateSpanId(): string {
  spanIdCounter++;
  return `span_${String(Date.now())}_${String(spanIdCounter)}`;
}

function updateCurrentSpan(
  update: (currentSpan: EvalTraceSpan) => void,
): void {
  const scope = getCurrentScope();
  const currentSpan = scope?.activeSpanStack.at(-1);
  if (!currentSpan) return;
  update(currentSpan);
}

function noopActiveSpan(): TraceActiveSpan {
  return {
    setName() {},
    setAttribute() {},
    setAttributes() {},
  };
}

function mergeSpanAttributes(
  span: EvalTraceSpan,
  attributes: Record<string, unknown>,
): void {
  span.attributes = { ...span.attributes, ...attributes };
}

function createSpanHandle(span: EvalTraceSpan): TraceActiveSpan {
  return {
    setName(value) {
      span.name = value;
    },
    setAttribute(key, value) {
      mergeSpanAttributes(span, { [key]: value });
    },
    setAttributes(value) {
      mergeSpanAttributes(span, value);
    },
  };
}

export const span: TraceActiveSpan = {
  setName(value) {
    updateCurrentSpan((currentSpan) => {
      currentSpan.name = value;
    });
  },
  setAttribute(key, value) {
    updateCurrentSpan((currentSpan) => {
      mergeSpanAttributes(currentSpan, { [key]: value });
    });
  },
  setAttributes(value) {
    updateCurrentSpan((currentSpan) => {
      mergeSpanAttributes(currentSpan, value);
    });
  },
};

function traceSpan<T>(
  info: {
    kind: EvalTraceSpan['kind'];
    name: string;
    attributes?: Record<string, unknown>;
  },
  fn: () => Promise<T> | T,
): Promise<T>;
function traceSpan<T>(
  info: {
    kind: EvalTraceSpan['kind'];
    name: string;
    attributes?: Record<string, unknown>;
  },
  fn: (span: TraceActiveSpan) => Promise<T> | T,
): Promise<T>;
async function traceSpan<T>(
  info: {
    kind: EvalTraceSpan['kind'];
    name: string;
    attributes?: Record<string, unknown>;
  },
  fn: ((span: TraceActiveSpan) => Promise<T> | T) | (() => Promise<T> | T),
): Promise<T> {
  const scope = getCurrentScope();
  if (!scope) {
    return await fn(noopActiveSpan());
  }

  const id = generateSpanId();
  const parentId = scope.activeSpanStack.at(-1)?.id ?? null;

  const spanRecord: EvalTraceSpan = {
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

  scope.spans.push(spanRecord);
  scope.spanStack.push(id);
  scope.activeSpanStack.push(spanRecord);

  const activeSpan = createSpanHandle(spanRecord);

  try {
    const result = await fn(activeSpan);
    spanRecord.status = 'ok';
    spanRecord.endedAt = new Date().toISOString();
    return result;
  } catch (error) {
    spanRecord.status = 'error';
    spanRecord.endedAt = new Date().toISOString();
    if (error instanceof Error) {
      spanRecord.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else {
      spanRecord.error = { message: String(error) };
    }
    throw error;
  } finally {
    scope.spanStack.pop();
    scope.activeSpanStack.pop();
  }
}

export const tracer = {
  span: traceSpan,

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
      attributes: { value: data },
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
        for (const childSpan of spans) {
          if (childSpan.parentId === parentId) {
            result.push(childSpan);
            visit(childSpan.id);
          }
        }
      }
      visit(null);
      return result;
    },
    checkpoints,
  };
}
