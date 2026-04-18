import {
  blocks,
  evalAssert,
  incrementOutput,
  setOutput,
  span,
  tracer,
} from '@agent-evals/sdk';
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
  return tracer.span(
    { kind: 'agent', name: 'voice-return-follow-up' },
    async () => {
      span.setAttribute('input', input);

      const detectedLocale = input.locale ?? 'en-US';

      await tracer.span({ kind: 'llm', name: 'transcribe-voice-note' }, async () => {
        await waitForWorkflowDelay('transcribeVoiceNote');

        const usage = { inputTokens: 130, outputTokens: 90 };
        const costUsd = calculateWorkflowCostUsd(usage);

        span.setAttributes({
          input: { voiceNote: input.voiceNote },
          model: 'gpt-4o-mini',
          usage,
          costUsd,
          output: {
            detectedLocale,
            transcriptSummary: 'Customer requested a return and follow-up instructions.',
          },
        });

        incrementOutput('costUsd', costUsd);
      });

      await tracer.span({ kind: 'tool', name: 'draft-follow-up' }, async () => {
        await waitForWorkflowDelay('draftFollowUp');

        span.setAttributes({
          input: {
            orderId: input.orderId,
            preferredChannel: input.preferredChannel,
          },
          output: {
            channel: input.preferredChannel,
            nextStep: 'send-return-label',
          },
        });
      });

      const result = await tracer.span(
        { kind: 'llm', name: 'localize-follow-up' },
        async () => {
          await waitForWorkflowDelay('localizeFollowUp');

          const usage = { inputTokens: 110, outputTokens: 70 };
          const costUsd = calculateWorkflowCostUsd(usage);
          const finalText = `Prepared a ${input.preferredChannel} follow-up with return steps for order ${input.orderId}.`;

          span.setAttributes({
            input: {
              customerMessage: input.customerMessage,
              locale: detectedLocale,
            },
            model: 'gpt-4o-mini',
            usage,
            costUsd,
            output: {
              detectedLocale,
              finalText,
              followUpChannel: input.preferredChannel,
            },
          });

          incrementOutput('costUsd', costUsd);

          return {
            detectedLocale,
            finalText,
            followUpChannel: input.preferredChannel,
          };
        },
      );

      tracer.checkpoint('follow-up-ready', {
        followUpChannel: result.followUpChannel,
      });

      setOutput('response', [blocks.markdown(result.finalText)]);
      setOutput('detectedLocale', result.detectedLocale);
      setOutput('followUpChannel', result.followUpChannel);
      evalAssert(
        result.finalText.includes('return steps'),
        'voice follow-up should include return steps',
      );

      span.setAttribute('output', result);
      return result;
    },
  );
}
