import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline, monoFont } from '#src/style/helpers';

type StatusBadgeProps = { status: string };

type Tone = 'pass' | 'fail' | 'running' | 'pending' | 'cancelled';

const Badge = styled.span<{
  pass: boolean;
  fail: boolean;
  running: boolean;
  cancelled: boolean;
}>`
  ${inline({ gap: 6, align: 'center' })}
  ${monoFont};
  display: inline-flex;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 3px 8px;
  border-radius: 20px;
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};

  &.pass {
    color: ${colors.success.var};
    background: ${colors.success.alpha(0.1)};
  }
  &.fail {
    color: ${colors.error.var};
    background: ${colors.error.alpha(0.1)};
  }
  &.running {
    color: ${colors.accentDim.var};
    background: ${colors.accent.alpha(0.12)};
  }
  &.cancelled {
    color: ${colors.warning.var};
    background: ${colors.warning.alpha(0.1)};
  }
`;

const Dot = styled.span<{
  pass: boolean;
  fail: boolean;
  running: boolean;
  cancelled: boolean;
}>`
  width: 5px;
  height: 5px;
  border-radius: 5px;
  flex-shrink: 0;
  background: ${colors.textDim.var};

  &.pass {
    background: ${colors.success.var};
  }
  &.fail {
    background: ${colors.error.var};
  }
  &.running {
    background: ${colors.accent.var};
    animation: pulseDot 1.6s ease-in-out infinite;
  }
  &.cancelled {
    background: ${colors.warning.var};
  }

  @keyframes pulseDot {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
`;

function getTone(status: string): Tone {
  if (status === 'pass') return 'pass';
  if (status === 'fail' || status === 'error') return 'fail';
  if (status === 'running') return 'running';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const tone = getTone(status);
  return (
    <Badge
      pass={tone === 'pass'}
      fail={tone === 'fail'}
      running={tone === 'running'}
      cancelled={tone === 'cancelled'}
    >
      <Dot
        pass={tone === 'pass'}
        fail={tone === 'fail'}
        running={tone === 'running'}
        cancelled={tone === 'cancelled'}
      />
      {status}
    </Badge>
  );
}

export function StatusDot({ status }: { status: string }) {
  const tone = getTone(status);
  return (
    <Dot
      pass={tone === 'pass'}
      fail={tone === 'fail'}
      running={tone === 'running'}
      cancelled={tone === 'cancelled'}
    />
  );
}
