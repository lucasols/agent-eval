import { stripVTControlCharacters } from 'node:util';

const orphanedAnsiSgrPattern = /\[(?:\d{1,3}(?:;\d{1,3})*)?m/g;

export function stripTerminalControlCodes(value: string): string {
  return stripVTControlCharacters(value).replaceAll(orphanedAnsiSgrPattern, '');
}
