import {
  Button,
  Card,
  CopyButton,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { RoleBadge } from './RoleBadge.js';

interface InviteCardProps {
  id: string;
  code: string;
  role: string;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  createdAt: string;
  onDelete: (id: string) => void;
}

function formatRelativeExpiry(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d remaining`;
}

export function InviteCard({
  id,
  code,
  role,
  maxUses,
  useCount,
  expiresAt,
  onDelete,
}: InviteCardProps) {
  const theme = useTheme();
  const isExpired = new Date(expiresAt).getTime() < Date.now();
  const isExhausted = useCount >= maxUses;

  return (
    <Card variant="outlined" padding="sm">
      <Stack gap={3}>
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <CopyButton value={code} size="sm" />
          <Stack direction="row" gap={2} align="center">
            <RoleBadge role={role} />
            <Button variant="ghost" size="sm" onClick={() => onDelete(id)}>
              Delete
            </Button>
          </Stack>
        </Stack>
        <Stack direction="row" gap={4}>
          <Text variant="caption" color="muted">
            Uses: {useCount}/{maxUses}
          </Text>
          <Text
            variant="caption"
            color={isExpired || isExhausted ? 'muted' : undefined}
            style={isExpired ? { color: theme.color.error.DEFAULT } : undefined}
          >
            {formatRelativeExpiry(expiresAt)}
          </Text>
          <Text variant="caption" color="muted" mono>
            {new Date(expiresAt).toLocaleDateString()}
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}
