import type { EvalTraceSpan } from '@agent-evals/shared';
import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { monoFont } from '#src/style/helpers';

const CacheBadge = styled.span<{
  hit: boolean;
  miss: boolean;
  refresh: boolean;
  bypass: boolean;
}>`
  ${monoFont};
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  background: ${colors.borderStrong.var};
  color: ${colors.textMuted.var};

  &.hit {
    background: ${colors.success.alpha(0.15)};
    color: ${colors.success.var};
  }
  &.miss {
    background: ${colors.warning.alpha(0.15)};
    color: ${colors.warning.var};
  }
  &.refresh {
    background: ${colors.accent.alpha(0.15)};
    color: ${colors.accent.var};
  }
  &.bypass {
    background: ${colors.borderStrong.var};
    color: ${colors.textMuted.var};
  }
`;

type TraceCacheBadgeProps = { span: EvalTraceSpan };

export function TraceCacheBadge({ span }: TraceCacheBadgeProps) {
  const status = span.attributes?.['cache.status'];
  const stored = span.attributes?.['cache.stored'];
  if (
    status !== 'hit' &&
    status !== 'miss' &&
    status !== 'refresh' &&
    status !== 'bypass'
  ) {
    return null;
  }
  return (
    <CacheBadge
      hit={status === 'hit'}
      miss={status === 'miss'}
      refresh={status === 'refresh'}
      bypass={status === 'bypass'}
    >
      cache {status}
      {stored === false ? ' not stored' : ''}
    </CacheBadge>
  );
}
