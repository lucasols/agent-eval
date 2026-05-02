import { X } from 'lucide-react';
import { useEffect } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { centerContent, transition } from '#src/style/helpers';

const Overlay = styled.div`
  ${centerContent};
  position: fixed;
  inset: 0;
  background: ${colors.black.alpha(0.85)};
  z-index: 80;
  cursor: zoom-out;
  padding: 48px;
`;

const FullImage = styled.img`
  max-width: calc(100vw - 96px);
  max-height: calc(100vh - 96px);
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 30px 80px -20px ${colors.black.alpha(0.6)};
  cursor: zoom-out;
`;

const CloseButton = styled.button`
  ${centerContent};
  position: fixed;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border: none;
  background: ${colors.white.alpha(0.12)};
  border-radius: 8px;
  color: ${colors.white.var};
  cursor: pointer;
  ${transition({ property: 'background, color' })}

  &:hover {
    background: ${colors.white.alpha(0.22)};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }
`;

const Caption = styled.div`
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100vw - 96px);
  padding: 6px 12px;
  border-radius: 6px;
  background: ${colors.black.alpha(0.55)};
  color: ${colors.white.var};
  font-size: 12px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
`;

type ImageLightboxProps = {
  isOpen: boolean;
  src: string;
  alt: string;
  onClose: () => void;
};

/**
 * Fullscreen image viewer overlay. Closes on overlay click, the close
 * button, or pressing Escape. Sits above the standard `Modal` z-index so
 * it can be opened from inside other modal flows (e.g. manual input).
 */
export function ImageLightbox({
  isOpen,
  src,
  alt,
  onClose,
}: ImageLightboxProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <Overlay
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image preview'}
      onClick={onClose}
    >
      <FullImage
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
      />
      <CloseButton
        type="button"
        aria-label="Close"
        onClick={onClose}
      >
        <X size={18} />
      </CloseButton>
      {alt ? <Caption>{alt}</Caption> : null}
    </Overlay>
  );
}
