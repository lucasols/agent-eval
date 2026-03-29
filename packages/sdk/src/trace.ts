import type { EvalTraceSpan } from '@agent-evals/shared';
import type { EvalTraceActiveSpan, EvalTraceRecorder, EvalTraceTree } from './types.ts';

let spanIdCounter = 0;

function generateSpanId(): string {
  spanIdCounter++;
  return `span_${Date.now()}_${String(spanIdCounter)}`;
}

export function createTraceRecorder(caseId: string): {
  recorder: EvalTraceRecorder;
  getSpans: () => EvalTraceSpan[];
  buildTree: () => EvalTraceTree;
} {
  const spans: EvalTraceSpan[] = [];
  const checkpoints = new Map<string, unknown>();
  const parentStack: string[] = [];

  const recorder: EvalTraceRecorder = {
    async span(info, fn) {
      const id = generateSpanId();
      const parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;

      const span: EvalTraceSpan = {
        id,
        parentId,
        caseId,
        kind: info.kind,
        name: info.name,
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: 'running',
        attributes: info.attributes,
      };

      spans.push(span);
      parentStack.push(id);

      const activeSpan: EvalTraceActiveSpan = {
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
        addArtifact(params) {
          return {
            source: 'run',
            artifactId: `artifact_${Date.now()}_${String(spanIdCounter++)}`,
            mimeType: params.mimeType,
            fileName: params.fileName,
          };
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
        parentStack.pop();
      }
    },
    checkpoint(name, data) {
      checkpoints.set(name, data);
      const id = generateSpanId();
      const parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;
      spans.push({
        id,
        parentId,
        caseId,
        kind: 'checkpoint',
        name,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        status: 'ok',
        output: data,
      });
    },
  };

  function buildTree(): EvalTraceTree {
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

  return {
    recorder,
    getSpans: () => spans,
    buildTree,
  };
}
