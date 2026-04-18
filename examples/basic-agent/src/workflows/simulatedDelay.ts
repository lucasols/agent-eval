const workflowDelayMs = {
  planRefund: 180,
  inspectReceipt: 120,
  processRefund: 220,
  ocrReceipt: 140,
  compareClaimAgainstReceipt: 220,
  publishAuditSummary: 140,
  extractReceiptMetadata: 150,
  flagTamperingSignals: 260,
  openRiskCase: 160,
  assessRefundRisk: 240,
  inspectPremiumReceipt: 150,
  openFinanceEscalation: 170,
  transcribeVoiceNote: 280,
  draftFollowUp: 150,
  localizeFollowUp: 190,
} satisfies Record<string, number>;

export type WorkflowDelayName = keyof typeof workflowDelayMs;

export async function waitForWorkflowDelay(
  stepName: WorkflowDelayName,
): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, workflowDelayMs[stepName]);
  });
}
