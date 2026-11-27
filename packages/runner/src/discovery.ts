import type { EvalRegistryEntry } from '@agent-evals/sdk';
import type { DiscoveryIssue } from '@agent-evals/shared';

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

const identifierCharRegex = /[A-Za-z0-9_$]/;
const whitespaceRegex = /\s/;

export function parseEvalMetas(
  filePath: string,
  content: string,
): EvalDiscoveryMeta[] {
  return parseEvalDiscovery(filePath, content).metas;
}

/** Parse static eval metadata and discovery issues from one eval file. */
export function parseEvalDiscovery(
  filePath: string,
  content: string,
): EvalDiscoveryResult {
  const metas: EvalDiscoveryMeta[] = [];
  let searchIndex = 0;

  while (searchIndex < content.length) {
    const defineEvalIndex = content.indexOf('defineEval', searchIndex);
    if (defineEvalIndex === -1) break;

    const extracted = extractDefineEvalObject(content, defineEvalIndex);
    if (!extracted) {
      searchIndex = defineEvalIndex + 'defineEval'.length;
      continue;
    }

    const id = findTopLevelStringProperty(extracted.objectText, 'id');
    if (id !== undefined) {
      const result: EvalDiscoveryMeta = {
        filePath,
        id,
        casesAsEvals:
          findTopLevelProperty(
            extracted.objectText,
            'casesAsEvals',
            readTrueLiteral,
          ) === true,
      };

      const title = findTopLevelStringProperty(extracted.objectText, 'title');
      if (title !== undefined) {
        result.title = title;
      }

      const description = findTopLevelStringProperty(
        extracted.objectText,
        'description',
      );
      if (description !== undefined) {
        result.description = description;
      }

      metas.push(result);
    }

    searchIndex = extracted.nextIndex;
  }

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

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && identifierCharRegex.test(char);
}

function skipWhitespace(content: string, startIndex: number): number {
  let index = startIndex;
  while (whitespaceRegex.test(content[index] ?? '')) {
    index++;
  }
  return index;
}

function readStringLiteral(
  content: string,
  startIndex: number,
): string | undefined {
  const quote = content[startIndex];
  if (quote !== '"' && quote !== "'") return undefined;

  let value = '';
  let isEscaped = false;
  for (let index = startIndex + 1; index < content.length; index++) {
    const currentChar = content[index];
    if (currentChar === undefined) return undefined;

    if (isEscaped) {
      value += currentChar;
      isEscaped = false;
      continue;
    }

    if (currentChar === '\\') {
      isEscaped = true;
      continue;
    }

    if (currentChar === quote) {
      return value;
    }

    value += currentChar;
  }

  return undefined;
}

function readTrueLiteral(
  content: string,
  startIndex: number,
): true | undefined {
  if (!content.startsWith('true', startIndex)) return undefined;
  if (isIdentifierChar(content[startIndex + 'true'.length])) return undefined;
  return true;
}

function findTopLevelStringProperty(
  objectText: string,
  propertyName: string,
): string | undefined {
  return findTopLevelProperty(objectText, propertyName, readStringLiteral);
}

function findTopLevelProperty<T>(
  objectText: string,
  propertyName: string,
  readValue: (content: string, startIndex: number) => T | undefined,
): T | undefined {
  let depth = 0;

  for (const index of codeCharIndexes(objectText, 0)) {
    const currentChar = objectText[index];

    if (currentChar === '{') {
      depth++;
      continue;
    }

    if (currentChar === '}') {
      depth--;
      continue;
    }

    if (
      depth !== 1 ||
      !objectText.startsWith(propertyName, index) ||
      isIdentifierChar(objectText[index - 1]) ||
      isIdentifierChar(objectText[index + propertyName.length])
    ) {
      continue;
    }

    const colonIndex = skipWhitespace(objectText, index + propertyName.length);
    if (objectText[colonIndex] !== ':') continue;

    const valueIndex = skipWhitespace(objectText, colonIndex + 1);
    const value = readValue(objectText, valueIndex);
    if (value !== undefined) return value;
  }

  return undefined;
}

function extractDefineEvalObject(
  content: string,
  defineEvalIndex: number,
): { nextIndex: number; objectText: string } | undefined {
  const openParenIndex = content.indexOf('(', defineEvalIndex);
  if (openParenIndex === -1) return undefined;

  const objectStartIndex = content.indexOf('{', openParenIndex);
  if (objectStartIndex === -1) return undefined;

  let depth = 0;

  for (const index of codeCharIndexes(content, objectStartIndex)) {
    const currentChar = content[index];

    if (currentChar === '{') {
      depth++;
      continue;
    }

    if (currentChar === '}') {
      depth--;
      if (depth === 0) {
        return {
          nextIndex: index + 1,
          objectText: content.slice(objectStartIndex, index + 1),
        };
      }
    }
  }

  return undefined;
}

/** Keywords after which a `/` starts a regex literal instead of a division. */
const regexPrecedingKeywords = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

/**
 * Yield the index of every character in `content` (from `startIndex`) that is
 * source code, skipping comments, string literals, template literal text and
 * regex literals. Code inside template `${...}` substitutions is yielded, but
 * the `${` and its closing `}` are not, so callers can balance braces safely.
 */
function* codeCharIndexes(
  content: string,
  startIndex: number,
): Generator<number> {
  // Brace depth at which each currently open template substitution started.
  const templateSubstitutionDepths: number[] = [];
  let braceDepth = 0;
  let lastSignificantIndex: number | undefined;
  let index = startIndex;

  while (index < content.length) {
    const currentChar = content[index];
    const nextChar = content[index + 1];

    if (currentChar === '/' && nextChar === '/') {
      const lineEnd = content.indexOf('\n', index + 2);
      index = lineEnd === -1 ? content.length : lineEnd + 1;
      continue;
    }

    if (currentChar === '/' && nextChar === '*') {
      const commentEnd = content.indexOf('*/', index + 2);
      index = commentEnd === -1 ? content.length : commentEnd + 2;
      continue;
    }

    if (currentChar === '"' || currentChar === "'") {
      index = skipQuotedString(content, index);
      lastSignificantIndex = index - 1;
      continue;
    }

    const resumesTemplate =
      currentChar === '}' && templateSubstitutionDepths.at(-1) === braceDepth;
    if (currentChar === '`' || resumesTemplate) {
      if (resumesTemplate) templateSubstitutionDepths.pop();
      const template = skipTemplateText(content, index + 1);
      if (template.opensSubstitution) {
        templateSubstitutionDepths.push(braceDepth);
        lastSignificantIndex = undefined;
      } else {
        lastSignificantIndex = template.nextIndex - 1;
      }
      index = template.nextIndex;
      continue;
    }

    if (currentChar === '/' && isRegexStart(content, lastSignificantIndex)) {
      const regexEnd = skipRegexLiteral(content, index);
      if (regexEnd !== undefined) {
        index = regexEnd;
        lastSignificantIndex = index - 1;
        continue;
      }
    }

    if (currentChar === '{') braceDepth++;
    if (currentChar === '}') braceDepth--;
    if (!whitespaceRegex.test(currentChar ?? '')) {
      lastSignificantIndex = index;
    }

    yield index;
    index++;
  }
}

/** Return the index right after the closing quote of a `'`/`"` string. */
function skipQuotedString(content: string, quoteIndex: number): number {
  const quote = content[quoteIndex];
  let index = quoteIndex + 1;

  while (index < content.length) {
    const currentChar = content[index];
    if (currentChar === '\\') {
      index += 2;
      continue;
    }
    index++;
    if (currentChar === quote || currentChar === '\n') return index;
  }

  return index;
}

/**
 * Skip template literal text starting at `startIndex` (right after a backtick
 * or a substitution's closing `}`) until the closing backtick or the next
 * `${`.
 */
function skipTemplateText(
  content: string,
  startIndex: number,
): { nextIndex: number; opensSubstitution: boolean } {
  let index = startIndex;

  while (index < content.length) {
    const currentChar = content[index];
    if (currentChar === '\\') {
      index += 2;
      continue;
    }
    if (currentChar === '`') {
      return { nextIndex: index + 1, opensSubstitution: false };
    }
    if (currentChar === '$' && content[index + 1] === '{') {
      return { nextIndex: index + 2, opensSubstitution: true };
    }
    index++;
  }

  return { nextIndex: index, opensSubstitution: false };
}

/**
 * Decide whether a `/` starts a regex literal based on the previous
 * significant source character: after a value (identifier, number, closing
 * bracket or literal) it is a division, otherwise a regex.
 */
function isRegexStart(
  content: string,
  lastSignificantIndex: number | undefined,
): boolean {
  if (lastSignificantIndex === undefined) return true;

  const previousChar = content[lastSignificantIndex];
  if (
    previousChar === ')' ||
    previousChar === ']' ||
    previousChar === '}' ||
    previousChar === '"' ||
    previousChar === "'" ||
    previousChar === '`'
  ) {
    return false;
  }

  if (!isIdentifierChar(previousChar)) return true;

  let wordStart = lastSignificantIndex;
  while (isIdentifierChar(content[wordStart - 1])) {
    wordStart--;
  }
  return regexPrecedingKeywords.has(
    content.slice(wordStart, lastSignificantIndex + 1),
  );
}

/**
 * Return the index right after a regex literal (including flags) starting at
 * `slashIndex`, or `undefined` when no closing `/` exists on the same line.
 */
function skipRegexLiteral(
  content: string,
  slashIndex: number,
): number | undefined {
  let inCharacterClass = false;
  let index = slashIndex + 1;

  while (index < content.length) {
    const currentChar = content[index];
    if (currentChar === '\n') return undefined;
    if (currentChar === '\\') {
      index += 2;
      continue;
    }
    if (currentChar === '[') inCharacterClass = true;
    if (currentChar === ']') inCharacterClass = false;
    index++;
    if (currentChar === '/' && !inCharacterClass) {
      while (isIdentifierChar(content[index])) {
        index++;
      }
      return index;
    }
  }

  return undefined;
}
