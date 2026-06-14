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

function readMessageRole(message: Record<string, unknown>): string {
  const rawRole = message.role;
  return typeof rawRole === 'string' && rawRole.length > 0
    ? rawRole
    : 'message';
}

function simplifyAssistantOutput(output: unknown): SimplifiedLlmMessage | null {
  if (typeof output === 'string') return { role: 'assistant', text: output };
  if (!isRecord(output)) return null;

  const text = simplifyMessageContent(output.text);
  if (text !== null) return { role: 'assistant', text };

  const content = simplifyMessageContent(output.content);
  if (content !== null) return { role: 'assistant', text: content };

  const message = output.message;
  if (!isRecord(message)) return null;

  const messageText =
    simplifyMessageContent(message.content) ??
    simplifyMessageContent(message.text);
  if (messageText === null) return null;

  return { role: readMessageRole(message), text: messageText };
}

/**
 * Extracts human-readable chat messages from an LLM call payload.
 *
 * The common provider shape stores prompts under `input.messages`, with each
 * message content either as a string or as an array of typed content parts.
 * Final model responses commonly live under `output.text`. Text parts are
 * preserved verbatim so prompt indentation and line breaks stay readable in the
 * LLM calls drawer.
 */
export function getSimplifiedLlmMessages(
  input: unknown,
  output: unknown = undefined,
): SimplifiedLlmMessage[] {
  const messages: SimplifiedLlmMessage[] = [];

  if (isRecord(input)) {
    const rawMessages = input.messages;
    if (Array.isArray(rawMessages)) {
      for (const rawMessage of rawMessages) {
        if (!isRecord(rawMessage)) continue;

        const text = simplifyMessageContent(rawMessage.content);
        if (text === null) continue;

        messages.push({ role: readMessageRole(rawMessage), text });
      }
    }
  }

  const assistantOutput = simplifyAssistantOutput(output);
  if (assistantOutput !== null) messages.push(assistantOutput);

  return messages;
}
