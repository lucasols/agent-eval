import type { EvalDefinition } from '@agent-evals/sdk';
import type { DiscoveryIssue } from '@agent-evals/shared';
import {
  dedupeEvalTags,
  matchesTagsFilter,
  validateEvalTagName,
  validateTagsFilterExpression,
} from '@agent-evals/shared';

type TaggableCase<TInput = unknown> = {
  id: string;
  input: TInput;
  tags?: string[];
};

export type TaggedEvalCase<TInput = unknown> = TaggableCase<TInput> & {
  tags: string[];
};

function getInvalidTagMessages(params: {
  tags: readonly string[] | undefined;
  source: string;
}): string[] {
  return (params.tags ?? []).flatMap((tag) => {
    const validation = validateEvalTagName(tag);
    return validation.ok
      ? []
      : [`${params.source} tag "${tag}" is invalid: ${validation.message}`];
  });
}

/** Resolve effective eval-level tags and discovery issues for one eval. */
export function resolveEvalTags(params: {
  configTags: readonly string[] | undefined;
  evalDef: Pick<EvalDefinition<unknown>, 'tags' | 'removeTags'>;
  evalId: string;
  filePath: string;
}): { tags: string[]; issues: DiscoveryIssue[] } {
  const configTags = params.configTags ?? [];
  const removeTags = params.evalDef.removeTags ?? [];
  const messages = [
    ...getInvalidTagMessages({ tags: configTags, source: 'config' }),
    ...getInvalidTagMessages({ tags: params.evalDef.tags, source: 'eval' }),
    ...getInvalidTagMessages({ tags: removeTags, source: 'removeTags' }),
  ];

  const globalTagSet = new Set(configTags);
  for (const tag of removeTags) {
    if (!globalTagSet.has(tag)) {
      messages.push(
        `removeTags tag "${tag}" is not defined in AgentEvalsConfig.tags.`,
      );
    }
  }

  const removeTagSet = new Set(removeTags);
  const tags = dedupeEvalTags([
    ...configTags.filter((tag) => !removeTagSet.has(tag)),
    ...(params.evalDef.tags ?? []),
  ]);

  return {
    tags,
    issues: messages.map((message) => ({
      type: 'invalid-tags',
      severity: 'error',
      filePath: params.filePath,
      evalId: params.evalId,
      message: `Invalid tags for eval "${params.evalId}" in ${params.filePath}: ${message}`,
    })),
  };
}

/** Return effective case tags or throw when authored case tags are invalid. */
export function resolveCaseTags(params: {
  evalTags: readonly string[];
  evalCase: TaggableCase;
  evalId: string;
  filePath: string;
}): string[] {
  const messages = getInvalidTagMessages({
    tags: params.evalCase.tags,
    source: `case "${params.evalCase.id}"`,
  });
  if (messages.length > 0) {
    throw new Error(
      `Invalid tags for case "${params.evalCase.id}" in ${params.filePath}#${params.evalId}: ${messages.join('; ')}`,
    );
  }
  return dedupeEvalTags([...params.evalTags, ...(params.evalCase.tags ?? [])]);
}

/** Validate CLI/API tags filters and return the first error message. */
export function validateTagsFilters(
  filters: readonly string[] | undefined,
): string | null {
  for (const filter of filters ?? []) {
    const error = validateTagsFilterExpression(filter);
    if (error !== null) return `Invalid --tags-filter "${filter}": ${error}`;
  }
  return null;
}

/** Filter cases by Vitest-style tag expressions. */
export function filterEvalCasesByTags<TInput>(
  cases: readonly TaggedEvalCase<TInput>[],
  tagsFilter: readonly string[] | undefined,
): TaggedEvalCase<TInput>[] {
  if (tagsFilter === undefined || tagsFilter.length === 0) return [...cases];
  return cases.filter((evalCase) =>
    matchesTagsFilter({ tags: evalCase.tags, filters: tagsFilter }),
  );
}

/** Return whether eval-level tags alone satisfy the run's tag filters. */
export function evalTagsMatchFilter(params: {
  tags: readonly string[];
  tagsFilter: readonly string[] | undefined;
}): boolean {
  return matchesTagsFilter({ tags: params.tags, filters: params.tagsFilter });
}
