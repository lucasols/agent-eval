import type { DisplayBlock, FileRef } from '@agent-evals/shared';

/** Helpers for constructing rich display blocks in eval outputs. */
export const blocks = {
  /** Create a plain text display block. */
  text(text: string): DisplayBlock {
    return { kind: 'text', text };
  },
  /** Create a Markdown display block. */
  markdown(text: string): DisplayBlock {
    return { kind: 'markdown', text };
  },
  /** Create a JSON display block rendered with structured formatting. */
  json(value: unknown): DisplayBlock {
    return { kind: 'json', value };
  },
  /** Create an image display block from a file reference. */
  image(ref: FileRef, alt?: string): DisplayBlock {
    return { kind: 'image', ref, alt };
  },
  /** Create an audio display block from a file reference. */
  audio(ref: FileRef, title?: string): DisplayBlock {
    return { kind: 'audio', ref, title };
  },
  /** Create a video display block from a file reference. */
  video(ref: FileRef, title?: string): DisplayBlock {
    return { kind: 'video', ref, title };
  },
  /** Create a generic downloadable file display block. */
  file(ref: FileRef, title?: string): DisplayBlock {
    return { kind: 'file', ref, title };
  },
};
