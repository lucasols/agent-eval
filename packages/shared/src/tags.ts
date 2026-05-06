/** Result returned when validating one authored tag name. */
export type TagValidationResult = { ok: true } | { ok: false; message: string };

type Token =
  | { kind: 'word'; value: string }
  | { kind: 'and' | 'or' | 'not' | 'lparen' | 'rparen' };

type TagExpression =
  | { kind: 'pattern'; pattern: string }
  | { kind: 'and' | 'or'; left: TagExpression; right: TagExpression }
  | { kind: 'not'; value: TagExpression };

type ParseResult =
  | { ok: true; expression: TagExpression }
  | { ok: false; message: string };

const reservedTagNames = new Set(['and', 'or', 'not']);
const invalidTagNameChars = /[\s()&|!*]/;
const whitespaceRegex = /\s/;

/** Validate a tag name used in config, eval definitions, or cases. */
export function validateEvalTagName(tag: string): TagValidationResult {
  if (tag.length === 0) {
    return { ok: false, message: 'Tag names cannot be empty.' };
  }
  if (reservedTagNames.has(tag.toLowerCase())) {
    return { ok: false, message: `Tag name "${tag}" is reserved.` };
  }
  if (invalidTagNameChars.test(tag)) {
    return {
      ok: false,
      message:
        'Tag names cannot contain spaces or expression characters: (, ), &, |, !, *.',
    };
  }
  return { ok: true };
}

/** Return tags in first-seen order without duplicates. */
export function dedupeEvalTags(tags: readonly string[]): string[] {
  return [...new Set(tags)];
}

/** Return whether the typed runtime tag matcher accepts the current tags. */
export function matchesEvalTagInput(
  tags: readonly string[],
  input:
    | string
    | {
        all?: readonly string[];
        any?: readonly string[];
        not?: readonly string[];
      },
): boolean {
  const tagSet = new Set(tags);
  if (typeof input === 'string') return tagSet.has(input);

  const all = input.all ?? [];
  if (!all.every((tag) => tagSet.has(tag))) return false;

  const any = input.any ?? [];
  if (any.length > 0 && !any.some((tag) => tagSet.has(tag))) return false;

  const not = input.not ?? [];
  return !not.some((tag) => tagSet.has(tag));
}

/** Return whether all CLI tag filter expressions match the provided tags. */
export function matchesTagsFilter(params: {
  tags: readonly string[];
  filters: readonly string[] | undefined;
}): boolean {
  const { filters } = params;
  if (filters === undefined || filters.length === 0) return true;
  return filters.every((filter) => {
    const parsed = parseTagExpression(filter);
    if (!parsed.ok) return false;
    return evaluateTagExpression(parsed.expression, params.tags);
  });
}

/** Validate one CLI tag filter expression and return a human-readable error. */
export function validateTagsFilterExpression(
  expression: string,
): string | null {
  const parsed = parseTagExpression(expression);
  return parsed.ok ? null : parsed.message;
}

function parseTagExpression(expression: string): ParseResult {
  const tokens = tokenize(expression);
  if (!tokens.ok) return tokens;
  if (tokens.tokens.length === 0) {
    return { ok: false, message: 'Tags filter cannot be empty.' };
  }
  const parser = new TagExpressionParser(tokens.tokens);
  const parsed = parser.parseExpression();
  if (!parsed.ok) return parsed;
  const trailing = parser.peek();
  if (trailing !== undefined) {
    return { ok: false, message: 'Unexpected token in tags filter.' };
  }
  return parsed;
}

function tokenize(
  expression: string,
): { ok: true; tokens: Token[] } | { ok: false; message: string } {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    const next = expression[index + 1];
    if (char === undefined) break;
    if (whitespaceRegex.test(char)) {
      index++;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      index++;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      index++;
      continue;
    }
    if (char === '!' && next !== '=') {
      tokens.push({ kind: 'not' });
      index++;
      continue;
    }
    if (char === '&' && next === '&') {
      tokens.push({ kind: 'and' });
      index += 2;
      continue;
    }
    if (char === '|' && next === '|') {
      tokens.push({ kind: 'or' });
      index += 2;
      continue;
    }
    if (char === '&' || char === '|') {
      return {
        ok: false,
        message: `Unexpected "${char}" in tags filter. Use "${char}${char}".`,
      };
    }

    let end = index;
    while (end < expression.length) {
      const current = expression[end];
      if (
        current === undefined ||
        whitespaceRegex.test(current) ||
        current === '(' ||
        current === ')' ||
        current === '&' ||
        current === '|' ||
        current === '!'
      ) {
        break;
      }
      end++;
    }
    const value = expression.slice(index, end);
    const lower = value.toLowerCase();
    if (lower === 'and' || lower === 'or' || lower === 'not') {
      tokens.push({ kind: lower });
    } else {
      tokens.push({ kind: 'word', value });
    }
    index = end;
  }
  return { ok: true, tokens };
}

class TagExpressionParser {
  private index = 0;

  private readonly tokens: readonly Token[];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  peek(): Token | undefined {
    return this.tokens[this.index];
  }

  parseExpression(): ParseResult {
    return this.parseOr();
  }

  private consume(): Token | undefined {
    const token = this.peek();
    this.index++;
    return token;
  }

  private parseOr(): ParseResult {
    let left = this.parseAnd();
    if (!left.ok) return left;

    while (this.peek()?.kind === 'or') {
      this.consume();
      const right = this.parseAnd();
      if (!right.ok) return right;
      left = {
        ok: true,
        expression: {
          kind: 'or',
          left: left.expression,
          right: right.expression,
        },
      };
    }
    return left;
  }

  private parseAnd(): ParseResult {
    let left = this.parseNot();
    if (!left.ok) return left;

    while (this.peek()?.kind === 'and') {
      this.consume();
      const right = this.parseNot();
      if (!right.ok) return right;
      left = {
        ok: true,
        expression: {
          kind: 'and',
          left: left.expression,
          right: right.expression,
        },
      };
    }
    return left;
  }

  private parseNot(): ParseResult {
    if (this.peek()?.kind !== 'not') return this.parsePrimary();
    this.consume();
    const value = this.parseNot();
    if (!value.ok) return value;
    return { ok: true, expression: { kind: 'not', value: value.expression } };
  }

  private parsePrimary(): ParseResult {
    const token = this.consume();
    if (token === undefined) {
      return { ok: false, message: 'Unexpected end of tags filter.' };
    }
    if (token.kind === 'word') {
      return {
        ok: true,
        expression: { kind: 'pattern', pattern: token.value },
      };
    }
    if (token.kind === 'lparen') {
      const inner = this.parseExpression();
      if (!inner.ok) return inner;
      if (this.peek()?.kind !== 'rparen') {
        return { ok: false, message: 'Unclosed parenthesis in tags filter.' };
      }
      this.consume();
      return inner;
    }
    return { ok: false, message: 'Expected a tag name in tags filter.' };
  }
}

function evaluateTagExpression(
  expression: TagExpression,
  tags: readonly string[],
): boolean {
  switch (expression.kind) {
    case 'pattern':
      return tags.some((tag) => tagMatchesPattern(tag, expression.pattern));
    case 'and':
      return (
        evaluateTagExpression(expression.left, tags) &&
        evaluateTagExpression(expression.right, tags)
      );
    case 'or':
      return (
        evaluateTagExpression(expression.left, tags) ||
        evaluateTagExpression(expression.right, tags)
      );
    case 'not':
      return !evaluateTagExpression(expression.value, tags);
  }
}

function tagMatchesPattern(tag: string, pattern: string): boolean {
  if (!pattern.includes('*')) return tag === pattern;
  const source = pattern.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${source}$`).test(tag);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}
