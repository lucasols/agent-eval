import type { DisplayBlock, FileRef } from '@agent-evals/shared';

export const blocks = {
  text(text: string): DisplayBlock {
    return { kind: 'text', text };
  },
  markdown(text: string): DisplayBlock {
    return { kind: 'markdown', text };
  },
  json(value: unknown): DisplayBlock {
    return { kind: 'json', value };
  },
  image(ref: FileRef, alt?: string): DisplayBlock {
    return { kind: 'image', ref, alt };
  },
  audio(ref: FileRef, title?: string): DisplayBlock {
    return { kind: 'audio', ref, title };
  },
  video(ref: FileRef, title?: string): DisplayBlock {
    return { kind: 'video', ref, title };
  },
  file(ref: FileRef, title?: string): DisplayBlock {
    return { kind: 'file', ref, title };
  },
};
