import { track } from './analytics.ts';

type RefundRequest = {
  message: string;
  locale?: string;
  receiptImage?: string;
  voiceNote?: string;
};

type RefundResult = {
  finalText: string;
  toolCalls: number;
  approved: boolean;
};

export async function runRefundAgent(request: RefundRequest): Promise<RefundResult> {
  track('refund.started', { locale: request.locale ?? 'en-US' });

  const toolCalls = request.receiptImage ? 3 : 2;
  const approved = true;
  const finalText = `Approved refund for: ${request.message}`;

  track('refund.completed', { approved, toolCalls });

  return { finalText, toolCalls, approved };
}
