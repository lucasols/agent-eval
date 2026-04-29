import {
  evalAssert,
  incrementEvalOutput,
  setEvalOutput,
  evalSpan,
  evalTracer,
} from '@ls-stack/agent-eval';
import { waitForWorkflowDelay } from './simulatedDelay.ts';
import { calculateWorkflowCostUsd } from './workflowCost.ts';

export type VoiceReturnFollowUpInput = {
  customerMessage: string;
  locale?: string;
  orderId: string;
  preferredChannel: 'email' | 'sms';
  voiceNote: string;
};

export type VoiceReturnFollowUpResult = {
  detectedLocale: string;
  finalText: string;
  followUpChannel: 'email' | 'sms';
};

export async function runVoiceReturnFollowUpWorkflow(
  input: VoiceReturnFollowUpInput,
): Promise<VoiceReturnFollowUpResult> {
  return evalTracer.span(
    { kind: 'agent', name: 'voice-return-follow-up' },
    async () => {
      evalSpan.setAttribute('input', input);

      const detectedLocale = input.locale ?? 'en-US';

      await evalTracer.span(
        { kind: 'llm', name: 'transcribe-voice-note' },
        async () => {
          await waitForWorkflowDelay('transcribeVoiceNote');

          const usage = { inputTokens: 130, outputTokens: 90 };
          const costUsd = calculateWorkflowCostUsd(usage);

          evalSpan.setAttributes({
            input: { voiceNote: input.voiceNote },
            model: 'whisper-1',
            provider: 'openai',
            usage,
            steps: 1,
            finishReason: 'stop',
            tokensPerSecond: 88.4,
            retryCount: 0,
            streamed: false,
            output: {
              detectedLocale,
              transcriptSummary:
                'Customer requested a return and follow-up instructions.',
            },
          });

          incrementEvalOutput('costUsd', costUsd);
        },
      );

      await evalTracer.span(
        { kind: 'tool', name: 'draft-follow-up' },
        async () => {
          await waitForWorkflowDelay('draftFollowUp');

          evalSpan.setAttributes({
            input: {
              orderId: input.orderId,
              preferredChannel: input.preferredChannel,
            },
            output: {
              channel: input.preferredChannel,
              nextStep: 'send-return-label',
            },
          });
        },
      );

      const result = await evalTracer.span(
        { kind: 'llm', name: 'localize-follow-up' },
        async () => {
          await waitForWorkflowDelay('localizeFollowUp');

          const usage = { inputTokens: 320, outputTokens: 180 };
          const costUsd = calculateWorkflowCostUsd(usage);
          const finalText = `Prepared a ${input.preferredChannel} follow-up with return steps for order ${input.orderId}.`;

          evalSpan.setAttributes({
            input: {
              customerMessage: input.customerMessage,
              locale: detectedLocale,
            },
            model: 'gpt-4o',
            provider: 'openai',
            usage,
            steps: [
              {
                index: 0,
                text: 'Looking up the localized template catalog for the detected locale.',
                toolCalls: [
                  {
                    id: 'call_lookup_locale',
                    name: 'lookup-locale-templates',
                    arguments: { locale: detectedLocale },
                  },
                ],
                usage: { inputTokens: 110, outputTokens: 40 },
                finishReason: 'tool_use',
              },
              {
                index: 1,
                text: 'Rendering the follow-up template for the requested channel.',
                toolCalls: [
                  {
                    id: 'call_render_template',
                    name: 'render-follow-up-template',
                    arguments: {
                      channel: input.preferredChannel,
                      orderId: input.orderId,
                      locale: detectedLocale,
                    },
                  },
                ],
                usage: { inputTokens: 130, outputTokens: 90 },
                finishReason: 'tool_use',
              },
              {
                index: 2,
                text: 'Composing the final follow-up message and returning it to the caller.',
                toolCalls: [],
                usage: { inputTokens: 80, outputTokens: 50 },
                finishReason: 'stop',
              },
            ],
            finishReason: 'tool_use',
            tokensPerSecond: 54.8,
            retryCount: 0,
            streamed: true,
            params: { temperature: 0.4, toolChoice: 'auto' },
            toolCalls: [
              {
                id: 'call_lookup_locale',
                name: 'lookup-locale-templates',
                arguments: { locale: detectedLocale },
              },
              {
                id: 'call_render_template',
                name: 'render-follow-up-template',
                arguments: {
                  channel: input.preferredChannel,
                  orderId: input.orderId,
                  locale: detectedLocale,
                },
              },
            ],
            output: {
              detectedLocale,
              finalText,
              followUpChannel: input.preferredChannel,
            },
          });

          incrementEvalOutput('costUsd', costUsd);

          return {
            detectedLocale,
            finalText,
            followUpChannel: input.preferredChannel,
          };
        },
      );

      evalTracer.checkpoint('follow-up-ready', {
        followUpChannel: result.followUpChannel,
      });

      setEvalOutput('response', result.finalText);
      setEvalOutput('detectedLocale', result.detectedLocale);
      setEvalOutput('followUpChannel', result.followUpChannel);
      evalAssert(
        result.finalText.includes('return steps'),
        'voice follow-up should include return steps',
      );

      evalSpan.setAttribute('output', result);
      return result;
    },
  );
}
