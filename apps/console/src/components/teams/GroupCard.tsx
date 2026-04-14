import { Button, Card, Stack, Text } from '@themoltnet/design-system';
import { useLocation } from 'wouter';

interface GroupCardProps {
  id: string;
  name: string;
  memberCount?: number;
  canDelete: boolean;
  onDelete: () => void;
}

export function GroupCard({
  id,
  name,
  memberCount,
  canDelete,
  onDelete,
}: GroupCardProps) {
  const [, navigate] = useLocation();
  return (
    <Card variant="outlined" padding="sm">
      <Stack direction="row" gap={3} align="center" justify="space-between">
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body">{name}</Text>
          {memberCount !== undefined && (
            <Text variant="caption" color="muted">
              {memberCount} member{memberCount === 1 ? '' : 's'}
            </Text>
          )}
        </Stack>
        <Stack direction="row" gap={2} align="center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/groups/${id}`)}
          >
            View →
          </Button>
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
