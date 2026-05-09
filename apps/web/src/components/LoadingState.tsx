import { LoaderCircle } from 'lucide-react';
import { type ReactNode } from 'react';
import { keyframes, styled } from 'vindur';
import { EmptyState } from '#src/components/EmptyState';
import { inline } from '#src/style/helpers';

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

const LoadingIconWrap = styled.span<{ small: boolean }>`
  ${inline({ align: 'center', justify: 'center' })}
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  &.small {
    width: 14px;
    height: 14px;
  }

  & > svg {
    width: 100%;
    height: 100%;
    animation: ${spin} 0.9s linear infinite;
  }
`;

const LoadingLineWrap = styled.span`
  ${inline({ align: 'center', gap: 8 })}
`;

export function LoadingIcon({
  size = 'medium',
}: {
  size?: 'small' | 'medium';
}) {
  return (
    <LoadingIconWrap small={size === 'small'}>
      <LoaderCircle />
    </LoadingIconWrap>
  );
}

export function LoadingLine({ children }: { children: ReactNode }) {
  return (
    <LoadingLineWrap>
      <LoadingIcon size="small" />
      {children}
    </LoadingLineWrap>
  );
}

export function LoadingState({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <EmptyState
      icon={<LoadingIcon />}
      title={title}
      description={description}
    />
  );
}
