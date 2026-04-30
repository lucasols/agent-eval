import type {
  ResolvedApiCallsConfig,
  ResolvedCallDerivedAttribute,
  ResolvedLlmCallsConfig,
} from '../schemas/config.ts';
import type { EvalTraceSpan } from '../schemas/trace.ts';
import { getNestedAttribute } from './getNestedAttribute.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mergeNestedAttribute(
  value: Record<string, unknown> | undefined,
  path: string,
  attributeValue: unknown,
): Record<string, unknown> {
  const root = value === undefined ? {} : { ...value };
  const parts = path.split('.');
  let current: Record<string, unknown> = root;

  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      current[part] = attributeValue;
      continue;
    }

    const nextValue = current[part];
    const nextRecord = isRecord(nextValue) ? { ...nextValue } : {};
    current[part] = nextRecord;
    current = nextRecord;
  }

  return root;
}

function applyDerivedAttributesForKind(params: {
  span: EvalTraceSpan;
  derivedAttributes: ResolvedCallDerivedAttribute[];
}): EvalTraceSpan {
  let attributes = params.span.attributes;

  for (const derivedAttribute of params.derivedAttributes) {
    if (derivedAttribute.compute === undefined) continue;

    const span = { ...params.span, attributes };
    const value = (() => {
      try {
        return derivedAttribute.compute({
          attributes,
          span,
          get: (path) => getNestedAttribute(attributes, path),
        });
      } catch {
        return undefined;
      }
    })();
    if (value === undefined) continue;

    attributes = mergeNestedAttribute(attributes, derivedAttribute.path, value);
  }

  if (attributes === params.span.attributes) return params.span;
  return { ...params.span, attributes };
}

/**
 * Persist configured derived attributes onto matching LLM/API spans.
 *
 * These derived attributes are applied before trace consumers run, so
 * `deriveFromTracing`, default usage extraction, trace display, and call
 * metrics can all read them by normal dot-path lookup.
 */
export function applyDerivedCallAttributes(params: {
  spans: EvalTraceSpan[];
  llmCallsConfig: ResolvedLlmCallsConfig;
  apiCallsConfig: ResolvedApiCallsConfig;
}): EvalTraceSpan[] {
  const llmKinds = new Set(params.llmCallsConfig.kinds);
  const apiKinds = new Set(params.apiCallsConfig.kinds);

  return params.spans.map((span) => {
    let nextSpan = span;
    if (llmKinds.has(span.kind)) {
      nextSpan = applyDerivedAttributesForKind({
        span: nextSpan,
        derivedAttributes: params.llmCallsConfig.derivedAttributes,
      });
    }
    if (apiKinds.has(span.kind)) {
      nextSpan = applyDerivedAttributesForKind({
        span: nextSpan,
        derivedAttributes: params.apiCallsConfig.derivedAttributes,
      });
    }
    return nextSpan;
  });
}
