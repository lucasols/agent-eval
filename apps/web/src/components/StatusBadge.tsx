import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline } from '#src/style/helpers';

type StatusBadgeProps = {
  status: string;
};

type Tone = 'pass' | 'fail' | 'running' | 'pending' | 'cancelled';

const Badge = styled.span`
  ${inline({ gap: 6 })}
  display: inline-flex;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: ${colors.textMuted.var};
  text-transform: lowercase;
`;

const Dot = styled.span<{
  pass: boolean;
  fail: boolean;
  running: boolean;
  cancelled: boolean;
}>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
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
    animation: pulseDot 1.4s ease-in-out infinite;
  }
  &.cancelled {
    background: ${colors.warning.var};
  }

  @keyframes pulseDot {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 ${colors.accent.alpha(0.5)};
    }
    50% {
      opacity: 0.65;
      box-shadow: 0 0 0 5px ${colors.accent.alpha(0)};
    }
  }
`;

const Label = styled.span<{
  pass: boolean;
  fail: boolean;
  running: boolean;
  cancelled: boolean;
}>`
  color: ${colors.textMuted.var};

  &.pass {
    color: ${colors.success.var};
  }
  &.fail {
    color: ${colors.error.var};
  }
  &.running {
    color: ${colors.accent.var};
  }
  &.cancelled {
    color: ${colors.warning.var};
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
    <Badge>
      <Dot
        pass={tone === 'pass'}
        fail={tone === 'fail'}
        running={tone === 'running'}
        cancelled={tone === 'cancelled'}
      />
      <Label
        pass={tone === 'pass'}
        fail={tone === 'fail'}
        running={tone === 'running'}
        cancelled={tone === 'cancelled'}
      >
        {status}
      </Label>
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
