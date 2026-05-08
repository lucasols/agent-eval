import { useEffect, type ReactNode } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import {
  centerContent,
  fillContainer,
  inline,
  stack,
  transition,
} from '#src/style/helpers';

const Overlay = styled.div`
  ${fillContainer};
  ${centerContent};
  position: fixed;
  inset: 0;
  background: ${colors.black.alpha(0.4)};
  z-index: 60;
`;

const Dialog = styled.div<{ wide: boolean }>`
  ${stack({ gap: 0 })}
  background: ${colors.bg.var};
  border: 1px solid ${colors.borderStrong.var};
  border-radius: 12px;
  box-shadow: 0 20px 50px -20px ${colors.black.alpha(0.35)};
  min-width: 480px;
  max-width: min(640px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  overflow: hidden;
  ${transition({ property: 'opacity, transform' })}

  &.wide {
    width: min(1180px, calc(100vw - 32px));
    max-width: min(1180px, calc(100vw - 32px));
  }
`;

const Header = styled.header`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  padding: 16px 20px;
  border-bottom: 1px solid ${colors.border.var};
`;

const TitleStack = styled.div`
  ${stack({ gap: 4 })}
`;

const Title = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: ${colors.text.var};
  margin: 0;
`;

const Subtitle = styled.p`
  font-size: 13px;
  color: ${colors.textMuted.var};
  margin: 0;
`;

const Body = styled.div`
  padding: 16px 20px;
  overflow: auto;
`;

const Footer = styled.footer`
  ${inline({ justify: 'space-between', align: 'center', gap: 12 })}
  padding: 12px 20px;
  border-top: 1px solid ${colors.border.var};
  background: ${colors.bgElevated.var};
`;

const CloseButton = styled.button`
  ${centerContent};
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: ${colors.textMuted.var};
  cursor: pointer;
  ${transition({ property: 'background, color' })}

  &:hover {
    background: ${colors.surfaceHover.var};
    color: ${colors.text.var};
  }

  &:focus-visible {
    outline: 2px solid ${colors.accent.var};
    outline-offset: 2px;
  }
`;

type ModalProps = {
  isOpen: boolean;
  title: string;
  subtitle?: string | undefined;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

/**
 * Centered overlay dialog used for short modal flows. Closes on overlay
 * click, the close button, or pressing Escape; the inner card stops
 * propagation so clicks on form fields do not dismiss the modal.
 */
export function Modal({
  isOpen,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: ModalProps) {
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
    <Overlay onClick={onClose}>
      <Dialog
        wide={wide}
        onClick={(event) => event.stopPropagation()}
      >
        <Header>
          <TitleStack>
            <Title>{title}</Title>
            {subtitle ? <Subtitle>{subtitle}</Subtitle> : null}
          </TitleStack>
          <CloseButton
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </CloseButton>
        </Header>
        <Body>{children}</Body>
        {footer ? <Footer>{footer}</Footer> : null}
      </Dialog>
    </Overlay>
  );
}
