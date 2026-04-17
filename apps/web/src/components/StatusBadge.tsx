import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline } from '#src/style/helpers';

type StatusBadgeProps = {
  status: string;
};

type Tone = 'pass' | 'fail' | 'running' | 'pending' | 'cancelled';

const Badge = styled.span<{
  pass: boolean;
  fail: boolean;
  running: boolean;
  cancelled: boolean;
}>`
  ${inline({ gap: 6, align: 'center' })}
  display: inline-flex;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 3px 7px 3px 8px;
  border: 1px solid ${colors.borderStrong.var};
  color: ${colors.textMuted.var};
  background: ${colors.surface.var};

  &.pass {
    color: ${colors.success.var};
    border-color: ${colors.success.alpha(0.4)};
    background: ${colors.success.alpha(0.08)};
  }
  &.fail {
    color: ${colors.error.var};
    border-color: ${colors.error.alpha(0.4)};
    background: ${colors.error.alpha(0.08)};
  }
  &.running {
    color: ${colors.accent.var};
    border-color: ${colors.accent.alpha(0.4)};
    background: ${colors.accent.alpha(0.08)};
  }
  &.cancelled {
    color: ${colors.warning.var};
    border-color: ${colors.warning.alpha(0.4)};
    background: ${colors.warning.alpha(0.08)};
  }
`;

const Dot = styled.span<{
  pass: boolean;
  fail: boolean;
  running: boolean;
  cancelled: boolean;
}>`
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  background: ${colors.textDim.var};

  &.pass {
    background: ${colors.success.var};
    box-shadow: 0 0 6px ${colors.success.alpha(0.6)};
  }
  &.fail {
    background: ${colors.error.var};
    box-shadow: 0 0 6px ${colors.error.alpha(0.6)};
  }
  &.running {
    background: ${colors.accent.var};
    animation: pulseDot 1.4s ease-in-out infinite;
  }
  &.cancelled {
    background: ${colors.warning.var};
  }

  @keyframes pulseDot {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 ${colors.accent.alpha(0.6)};
    }
    50% {
      opacity: 0.6;
      box-shadow: 0 0 0 5px ${colors.accent.alpha(0)};
    }
  }
`;

function getTone(status: string): Tone {
  if (status === 'pass' || status === 'completed') return 'pass';
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
