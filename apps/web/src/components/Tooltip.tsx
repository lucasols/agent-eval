import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStyles,
  type Placement,
} from '@floating-ui/react';
import { cloneElement, useState, type FC } from 'react';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';

const TooltipContent = styled.div`
  background: ${colors.black.var};
  color: ${colors.white.var};
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  z-index: 10000;
  max-width: 300px;
  white-space: pre-line;
  overflow-wrap: break-word;
`;

type Props = {
  content: string | undefined;
  placement?: Placement;
  children: React.ReactElement<{
    ref?: React.Ref<HTMLElement>;
    [key: string]: unknown;
  }>;
};

export const Tooltip: FC<Props> = ({
  content,
  placement = 'top',
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [offset(5), flip(), shift({ padding: 4 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    move: false,
    delay: { open: 400, close: 0 },
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  const referenceProps = getReferenceProps();
  const floatingProps = getFloatingProps();

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 150,
    initial: { opacity: 0 },
  });

  const mergedRef = useMergeRefs([refs.setReference, children.props.ref]);

  if (!content) return children;

  return (
    <>
      {cloneElement(children, { ref: mergedRef, ...referenceProps })}

      {isMounted && (
        <FloatingPortal>
          <TooltipContent
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...transitionStyles }}
            {...floatingProps}
          >
            {content}
          </TooltipContent>
        </FloatingPortal>
      )}
    </>
  );
};
