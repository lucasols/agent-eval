export type SimplifiedLlmMessage = { role: string; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyFallback(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) return 'null';
  return JSON.stringify(value, null, 2);
}

function simplifyContentPart(part: unknown): string | null {
  if (typeof part === 'string') return part;

  if (isRecord(part)) {
    const text = part.text;
    if (typeof text === 'string') return text;

    const type = part.type;
    if (typeof type === 'string' && type.length > 0) {
      return `[${type}]`;
    }
  }

  return stringifyFallback(part);
}

function simplifyMessageContent(content: unknown): string | null {
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => simplifyContentPart(part))
      .filter((part): part is string => part !== null && part.length > 0);
    return parts.join('\n\n');
  }

  return stringifyFallback(content);
}

/**
 * Extracts human-readable chat messages from an LLM call input payload.
 *
 * The common provider shape stores prompts under `input.messages`, with each
 * message content either as a string or as an array of typed content parts.
 * Text parts are preserved verbatim so prompt indentation and line breaks stay
 * readable in the LLM calls drawer.
 */
export function getSimplifiedLlmMessages(
  input: unknown,
): SimplifiedLlmMessage[] {
  if (!isRecord(input)) return [];
  const rawMessages = input.messages;
  if (!Array.isArray(rawMessages)) return [];

  const messages: SimplifiedLlmMessage[] = [];
  for (const rawMessage of rawMessages) {
    if (!isRecord(rawMessage)) continue;

    const rawRole = rawMessage.role;
    const role =
      typeof rawRole === 'string' && rawRole.length > 0 ? rawRole : 'message';
    const text = simplifyMessageContent(rawMessage.content);
    if (text === null) continue;

    messages.push({ role, text });
  }

  return messages;
}
