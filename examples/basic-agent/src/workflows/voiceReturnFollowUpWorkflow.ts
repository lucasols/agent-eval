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
            model: 'gpt-4o-mini',
            usage,
            costUsd,
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

          const usage = { inputTokens: 110, outputTokens: 70 };
          const costUsd = calculateWorkflowCostUsd(usage);
          const finalText = `Prepared a ${input.preferredChannel} follow-up with return steps for order ${input.orderId}.`;

          evalSpan.setAttributes({
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
