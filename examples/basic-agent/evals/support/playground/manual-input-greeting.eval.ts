import { defineEval, z } from '@ls-stack/agent-eval';

const manualInputGreetingSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .describe('Person being greeted; required so the message has a subject.'),
  tone: z
    .enum(['friendly', 'formal', 'playful'])
    .describe('Voice the agent uses when composing the greeting.'),
  notes: z
    .string()
    .max(500)
    .optional()
    .describe(
      'Optional context the agent should weave into the greeting (multi-line allowed).',
    ),
  sendEmail: z
    .boolean()
    .default(false)
    .describe('Whether to also queue an email send after responding.'),
  locale: z.enum(['en', 'pt-BR', 'es']).default('en'),
});
type ManualInputGreetingInput = z.infer<typeof manualInputGreetingSchema>;

const manualInputGreetingOutputsSchema = z.object({
  greeting: z.string(),
  channelHint: z.string(),
  notesIncluded: z.boolean(),
});
type ManualInputGreetingOutputs = z.infer<
  typeof manualInputGreetingOutputsSchema
>;

const localeLabels: Record<ManualInputGreetingInput['locale'], string> = {
  en: 'English',
  'pt-BR': 'Brazilian Portuguese',
  es: 'Spanish',
};

const toneOpenings: Record<ManualInputGreetingInput['tone'], string> = {
  friendly: 'Hi',
  formal: 'Greetings',
  playful: 'Heya',
};

defineEval<ManualInputGreetingInput, ManualInputGreetingOutputs>({
  id: 'manual-input-greeting',
  title: 'Manual Input Greeting',
  manualInput: {
    schema: manualInputGreetingSchema,
    title: 'Greet someone',
    description:
      'Type the recipient, tone, and channel; the agent composes a greeting.',
    submitLabel: 'Greet',
    fields: {
      name: { label: 'Recipient', placeholder: 'Ada' },
      notes: {
        multiline: true,
        rows: 4,
        placeholder: 'Anything the agent should know',
      },
      sendEmail: { label: 'Send via email after replying' },
      locale: { label: 'Language' },
    },
  },
  outputsSchema: manualInputGreetingOutputsSchema,
  execute({ input, setOutput }) {
    const opening = toneOpenings[input.tone];
    const trimmedNotes = input.notes?.trim() ?? '';
    const greeting =
      trimmedNotes.length > 0
        ? `${opening}, ${input.name}! Note: ${trimmedNotes}`
        : `${opening}, ${input.name}!`;
    const localeLabel = localeLabels[input.locale];
    const channelHint = input.sendEmail
      ? `Will follow up via email in ${localeLabel}.`
      : `Reply will be shown on screen in ${localeLabel}.`;
    setOutput('greeting', greeting);
    setOutput('channelHint', channelHint);
    setOutput('notesIncluded', trimmedNotes.length > 0);
  },
});
