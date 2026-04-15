import type { expect as VitestExpect } from 'vitest';
import type { EvalTraceTree } from './types.ts';

let expect: typeof VitestExpect | null = null;

if (process.env.VITEST) {
  const vitest = await import('vitest');
  expect = vitest.expect;
}

function isTraceTree(value: unknown): value is EvalTraceTree {
  return (
    typeof value === 'object' &&
    value !== null &&
    'spans' in value &&
    'rootSpans' in value &&
    'flattenDfs' in value
  );
}

export function installEvalMatchers(): void {
  if (!expect) {
    throw new Error(
      'installEvalMatchers() must be called inside a Vitest test run',
    );
  }
  expect.extend({
    toCallSpan(received: unknown, name: string) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      const found = received.findSpan(name);
      return {
        pass: !!found,
        message: () =>
          found
            ? `Expected trace not to contain span "${name}"`
            : `Expected trace to contain span "${name}"`,
      };
    },

    toCallTool(received: unknown, name: string) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      const tools = received.findSpansByKind('tool');
      const found = tools.some((s) => s.name === name);
      return {
        pass: found,
        message: () =>
          found
            ? `Expected trace not to contain tool call "${name}"`
            : `Expected trace to contain tool call "${name}"`,
      };
    },

    toContainSequence(
      received: unknown,
      sequence: Array<{ kind?: string; name?: string }>,
    ) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      const flat = received.flattenDfs();
      let seqIdx = 0;
      for (const span of flat) {
        const expected = sequence[seqIdx];
        if (!expected) break;
        const kindMatch = !expected.kind || span.kind === expected.kind;
        const nameMatch = !expected.name || span.name === expected.name;
        if (kindMatch && nameMatch) {
          seqIdx++;
        }
      }
      const pass = seqIdx === sequence.length;
      return {
        pass,
        message: () =>
          pass
            ? 'Expected trace not to contain the given sequence'
            : `Expected trace to contain sequence, matched ${String(seqIdx)}/${String(sequence.length)} steps`,
      };
    },

    toHaveMaxDepth(received: unknown, maxDepth: number) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      const depthMap = new Map<string, number>();
      for (const span of received.spans) {
        if (span.parentId === null) {
          depthMap.set(span.id, 0);
        } else {
          const parentDepth = depthMap.get(span.parentId) ?? 0;
          depthMap.set(span.id, parentDepth + 1);
        }
      }
      const actualMax = Math.max(0, ...depthMap.values());
      const pass = actualMax <= maxDepth;
      return {
        pass,
        message: () =>
          pass
            ? `Expected trace depth to exceed ${String(maxDepth)}, got ${String(actualMax)}`
            : `Expected trace depth <= ${String(maxDepth)}, got ${String(actualMax)}`,
      };
    },

    toUseAtMostTurns(received: unknown, maxTurns: number) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      const llmSpans = received.findSpansByKind('llm');
      const pass = llmSpans.length <= maxTurns;
      return {
        pass,
        message: () =>
          pass
            ? `Expected more than ${String(maxTurns)} LLM turns, got ${String(llmSpans.length)}`
            : `Expected at most ${String(maxTurns)} LLM turns, got ${String(llmSpans.length)}`,
      };
    },

    toCostLessThan(received: unknown, maxUsd: number) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      const totalCost = received.spans
        .filter((s) => s.costUsd !== null && s.costUsd !== undefined)
        .reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
      const pass = totalCost < maxUsd;
      return {
        pass,
        message: () =>
          pass
            ? `Expected cost >= $${String(maxUsd)}, got $${totalCost.toFixed(4)}`
            : `Expected cost < $${String(maxUsd)}, got $${totalCost.toFixed(4)}`,
      };
    },

    toStayUnderLatency(received: unknown, maxMs: number) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      let totalMs = 0;
      for (const span of received.rootSpans) {
        if (span.startedAt && span.endedAt) {
          totalMs +=
            new Date(span.endedAt).getTime() -
            new Date(span.startedAt).getTime();
        }
      }
      const pass = totalMs <= maxMs;
      return {
        pass,
        message: () =>
          pass
            ? `Expected latency > ${String(maxMs)}ms, got ${String(totalMs)}ms`
            : `Expected latency <= ${String(maxMs)}ms, got ${String(totalMs)}ms`,
      };
    },

    toHaveNoErrorSpans(received: unknown) {
      if (!isTraceTree(received)) {
        return { pass: false, message: () => 'Expected a trace tree' };
      }
      const errorSpans = received.spans.filter((s) => s.status === 'error');
      const pass = errorSpans.length === 0;
      return {
        pass,
        message: () =>
          pass
            ? 'Expected trace to have error spans'
            : `Expected no error spans, found ${String(errorSpans.length)}: ${errorSpans.map((s) => s.name).join(', ')}`,
      };
    },
  });
}
