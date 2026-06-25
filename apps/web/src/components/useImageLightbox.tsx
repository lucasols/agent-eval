import { useCallback, useState, type ReactNode } from 'react';
import { ImageLightbox } from '#src/components/ImageLightbox';

type LightboxState = { src: string; alt: string };

/**
 * Manages open state for an `ImageLightbox`. Returns `openImage` to show
 * any image fullscreen and a `lightbox` node the caller renders alongside
 * its content. The caller does not need to track `isOpen` itself.
 */
export function useImageLightbox(options: { footer?: ReactNode } = {}): {
  openImage: (src: string, alt?: string) => void;
  lightbox: ReactNode;
} {
  const [state, setState] = useState<LightboxState | null>(null);

  const openImage = useCallback((src: string, alt?: string) => {
    setState({ src, alt: alt ?? '' });
  }, []);

  const close = useCallback(() => setState(null), []);

  const lightbox = (
    <ImageLightbox
      isOpen={state !== null}
      src={state?.src ?? ''}
      alt={state?.alt ?? ''}
      onClose={close}
      footer={options.footer}
    />
  );

  return { openImage, lightbox };
}
