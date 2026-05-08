import { describe, expect, test } from 'vitest';
import { getSimplifiedLlmMessages } from '#src/utils/llmMessages';

describe('getSimplifiedLlmMessages', () => {
  test('extracts string and text-part messages while preserving formatting', () => {
    const messages = getSimplifiedLlmMessages({
      messages: [
        {
          role: 'system',
          content:
            '<role>\n  You are the support agent.\n  Keep answers short.\n</role>',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<user-msg>\n  <message format="markdown">hi</message>\n</user-msg>',
              providerOptions: { mastra: { createdAt: 1775779200284 } },
            },
          ],
        },
      ],
    });

    expect(messages).toEqual([
      {
        role: 'system',
        text: '<role>\n  You are the support agent.\n  Keep answers short.\n</role>',
      },
      {
        role: 'user',
        text: '<user-msg>\n  <message format="markdown">hi</message>\n</user-msg>',
      },
    ]);
  });

  test('returns no messages when input.messages is absent or malformed', () => {
    expect(getSimplifiedLlmMessages(undefined)).toEqual([]);
    expect(getSimplifiedLlmMessages({ prompt: 'hi' })).toEqual([]);
    expect(getSimplifiedLlmMessages({ messages: 'hi' })).toEqual([]);
  });

  test('uses compact placeholders for non-text content parts', () => {
    expect(
      getSimplifiedLlmMessages({
        messages: [
          {
            role: 'user',
            content: [{ type: 'image' }, { type: 'text', text: 'describe it' }],
          },
        ],
      }),
    ).toEqual([{ role: 'user', text: '[image]\n\ndescribe it' }]);
  });
});
