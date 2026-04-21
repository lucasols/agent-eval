type EvalDiscoveryMeta = {
  filePath: string;
  id: string;
  title?: string;
  passThreshold: number;
};

const evalIdMatchRegex = /\bid\s*:\s*['"]([^'"]+)['"]/;
const evalTitleMatchRegex = /\btitle\s*:\s*['"]([^'"]+)['"]/;
const identifierCharRegex = /[A-Za-z0-9_$]/;
const whitespaceRegex = /\s/;
const nullLiteralRegex = /^null\b/;
const numberLiteralRegex = /^-?\d+(?:\.\d+)?/;

export function parseEvalMetas(
  filePath: string,
  content: string,
): EvalDiscoveryMeta[] {
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

    const idMatch = evalIdMatchRegex.exec(extracted.objectText);
    const id = idMatch?.[1];
    if (id !== undefined) {
      const result: EvalDiscoveryMeta = {
        filePath,
        id,
        passThreshold: parseEvalPassThreshold(extracted.objectText),
      };

      const titleMatch = evalTitleMatchRegex.exec(extracted.objectText);
      const title = titleMatch?.[1];
      if (title !== undefined) {
        result.title = title;
      }

      metas.push(result);
    }

    searchIndex = extracted.nextIndex;
  }

  return metas;
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
  let quote: '"' | "'" | '`' | undefined;
  let inBlockComment = false;
  let inLineComment = false;
  let isEscaped = false;

  for (let index = objectStartIndex; index < content.length; index++) {
    const currentChar = content[index];
    const nextChar = content[index + 1];

    if (inLineComment) {
      if (currentChar === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (currentChar === '*' && nextChar === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (quote) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (currentChar === '\\') {
        isEscaped = true;
        continue;
      }
      if (currentChar === quote) {
        quote = undefined;
      }
      continue;
    }

    if (currentChar === '/' && nextChar === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (currentChar === '/' && nextChar === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    if (currentChar === '"' || currentChar === "'" || currentChar === '`') {
      quote = currentChar;
      continue;
    }

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

function parseEvalPassThreshold(objectText: string): number {
  const key = 'passThreshold';
  let depth = 0;
  let quote: '"' | "'" | '`' | undefined;
  let inBlockComment = false;
  let inLineComment = false;
  let isEscaped = false;

  for (let index = 0; index < objectText.length; index++) {
    const currentChar = objectText[index];
    const nextChar = objectText[index + 1];

    if (inLineComment) {
      if (currentChar === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (currentChar === '*' && nextChar === '/') {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (quote) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (currentChar === '\\') {
        isEscaped = true;
        continue;
      }
      if (currentChar === quote) {
        quote = undefined;
      }
      continue;
    }

    if (currentChar === '/' && nextChar === '/') {
      inLineComment = true;
      index++;
      continue;
    }

    if (currentChar === '/' && nextChar === '*') {
      inBlockComment = true;
      index++;
      continue;
    }

    if (currentChar === '"' || currentChar === "'" || currentChar === '`') {
      quote = currentChar;
      continue;
    }

    if (currentChar === '{') {
      depth++;
      continue;
    }

    if (currentChar === '}') {
      depth--;
      continue;
    }

    if (depth !== 1) continue;
    if (!objectText.startsWith(key, index)) continue;

    const previousChar = objectText[index - 1];
    if (previousChar !== undefined && identifierCharRegex.test(previousChar)) {
      continue;
    }

    let valueStart = index + key.length;
    while (whitespaceRegex.test(objectText[valueStart] ?? '')) {
      valueStart++;
    }
    if (objectText[valueStart] !== ':') continue;
    valueStart++;
    while (whitespaceRegex.test(objectText[valueStart] ?? '')) {
      valueStart++;
    }

    if (nullLiteralRegex.test(objectText.slice(valueStart))) {
      return 0.5;
    }

    const valueMatch = numberLiteralRegex.exec(objectText.slice(valueStart));
    if (!valueMatch) return 0.5;
    return Number(valueMatch[0]);
  }

  return 0.5;
}
