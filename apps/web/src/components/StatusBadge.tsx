import { styled } from 'vindur';
import { colors } from '#src/style/colors';
import { inline } from '#src/style/helpers';

type StatusBadgeProps = {
  status: string;
};

const statusColors: Record<string, string> = {
  pass: colors.success.var,
  completed: colors.success.var,
  fail: colors.error.var,
  error: colors.error.var,
  running: colors.accent.var,
  pending: colors.textMuted.var,
  cancelled: colors.warning.var,
};

const Badge = styled.span`
  ${inline({ gap: 4 })}
  display: inline-flex;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
`;

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = statusColors[status] ?? colors.textMuted.var;

  return (
    <Badge
      style={{
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
      }}
    >
      {status}
    </Badge>
  );
}
