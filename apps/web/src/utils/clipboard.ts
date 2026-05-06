import { resultify } from 't-result';

export async function copyTextToClipboard(
  text: string,
  promptTitle: string,
): Promise<void> {
  const copyResult = await resultify(() => navigator.clipboard.writeText(text));
  if (!copyResult.error) return;

  window.prompt(promptTitle, text);
}
