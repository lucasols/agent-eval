import { stripVTControlCharacters } from 'node:util';

const orphanedAnsiSgrPattern = /\[(?:\d{1,3}(?:;\d{1,3})*)?m/g;

/**
 * Remove terminal styling control codes from captured stack text.
 *
 * Some stack providers add ANSI SGR codes for terminal output. Persisted eval
 * artifacts are rendered in the web UI, so stacks should be stored as plain
 * text.
 */
export function stripTerminalControlCodes(value: string): string {
  return stripVTControlCharacters(value).replaceAll(orphanedAnsiSgrPattern, '');
}
