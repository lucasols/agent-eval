import type { EvalRegistryEntry } from '@agent-evals/sdk';
import type { DiscoveryIssue } from '@agent-evals/shared';
import {
  parseSync,
  Visitor,
  type Expression,
  type ObjectExpression,
  type ObjectProperty,
} from 'oxc-parser';

type EvalDiscoveryMeta = {
  filePath: string;
  id: string;
  title?: string;
  description?: string;
  /** Whether the definition sets `casesAsEvals: true`. */
  casesAsEvals: boolean;
};

/** Discovered eval after splitting `casesAsEvals` definitions per case. */
export type ResolvedEvalDiscoveryMeta = {
  filePath: string;
  id: string;
  title?: string;
  description?: string;
  /** Authored `defineEval(...)` id the eval was split from, if any. */
  parentEvalId: string | undefined;
};
export type EvalDiscoveryResult = {
  metas: EvalDiscoveryMeta[];
  issues: DiscoveryIssue[];
};

export function parseEvalMetas(
  filePath: string,
  content: string,
): EvalDiscoveryMeta[] {
  return parseEvalDiscovery(filePath, content).metas;
}

/**
 * Parse static eval metadata and discovery issues from one eval file.
 *
 * The file is parsed into an AST and every `defineEval({...})` call is read
 * without executing the module. Only statically known values are picked up:
 * `id`, `title` and `description` must be string literals (or templates
 * without substitutions) and `casesAsEvals` must be the literal `true`.
 * Definitions without a static `id` are skipped. Files with syntax errors
 * yield whatever definitions the parser could still recover.
 */
export function parseEvalDiscovery(
  filePath: string,
  content: string,
): EvalDiscoveryResult {
  const metas: EvalDiscoveryMeta[] = [];
  const { program } = parseSync(filePath, content, {
    lang: 'ts',
    sourceType: 'module',
  });

  new Visitor({
    CallExpression(node) {
      if (
        node.callee.type !== 'Identifier' ||
        node.callee.name !== 'defineEval'
      )
        return;

      const [definition] = node.arguments;
      if (definition?.type !== 'ObjectExpression') return;

      const meta = readEvalDiscoveryMeta(filePath, definition);
      if (meta) metas.push(meta);
    },
  }).visit(program);

  const countsById = new Map<string, number>();
  for (const meta of metas) {
    countsById.set(meta.id, (countsById.get(meta.id) ?? 0) + 1);
  }
  const duplicateIds = new Set(
    [...countsById].filter(([, count]) => count > 1).map(([id]) => id),
  );
  const issues: DiscoveryIssue[] = [...duplicateIds].map((evalId) => ({
    type: 'duplicate-eval-id',
    severity: 'error',
    filePath,
    evalId,
    message: `Duplicate eval id "${evalId}" in ${filePath}. Eval ids must be unique within one file.`,
  }));

  return { metas: metas.filter((meta) => !duplicateIds.has(meta.id)), issues };
}

/**
 * Replace statically discovered `casesAsEvals` definitions with the per-case
 * evals they registered. Without a loaded registry (module failed to import)
 * the authored definition is kept so the import error surfaces when it runs.
 */
export function resolveCasesAsEvalsMetas(
  metas: EvalDiscoveryMeta[],
  registry: Map<string, EvalRegistryEntry> | undefined,
): ResolvedEvalDiscoveryMeta[] {
  return metas.flatMap((meta): ResolvedEvalDiscoveryMeta[] => {
    const { casesAsEvals, ...baseMeta } = meta;
    if (!casesAsEvals || registry === undefined) {
      return [{ ...baseMeta, parentEvalId: undefined }];
    }

    return [...registry.values()]
      .filter((entry) => entry.parentEvalId === meta.id)
      .map((entry) => ({
        filePath: meta.filePath,
        id: entry.id,
        title: entry.title,
        description: entry.description,
        parentEvalId: meta.id,
      }));
  });
}

function readEvalDiscoveryMeta(
  filePath: string,
  definition: ObjectExpression,
): EvalDiscoveryMeta | undefined {
  const properties = new Map<string, Expression>();
  for (const property of definition.properties) {
    if (property.type !== 'Property') continue;
    const name = getStaticPropertyName(property);
    // Later keys win, matching object literal semantics.
    if (name !== undefined) properties.set(name, property.value);
  }

  const id = readStaticString(properties.get('id'));
  if (id === undefined) return undefined;

  const casesAsEvalsValue = properties.get('casesAsEvals');
  const meta: EvalDiscoveryMeta = {
    filePath,
    id,
    casesAsEvals:
      casesAsEvalsValue?.type === 'Literal' && casesAsEvalsValue.value === true,
  };

  const title = readStaticString(properties.get('title'));
  if (title !== undefined) meta.title = title;

  const description = readStaticString(properties.get('description'));
  if (description !== undefined) meta.description = description;

  return meta;
}

function getStaticPropertyName(property: ObjectProperty): string | undefined {
  if (property.kind !== 'init' || property.method) return undefined;

  const { key } = property;
  if (!property.computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return undefined;
}

function readStaticString(value: Expression | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.type === 'Literal') {
    return typeof value.value === 'string' ? value.value : undefined;
  }
  if (value.type === 'TemplateLiteral' && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}
