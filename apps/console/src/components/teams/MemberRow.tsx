import {
  Button,
  Card,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { RoleBadge } from './RoleBadge.js';

interface MemberRowProps {
  subjectId: string;
  subjectType: 'agent' | 'human';
  role: string;
  displayName: string;
  fingerprint?: string;
  email?: string;
  canRemove: boolean;
  onRemove: () => void;
}

export function MemberRow({
  subjectType,
  role,
  displayName,
  fingerprint,
  email,
  canRemove,
  onRemove,
}: MemberRowProps) {
  const theme = useTheme();

  return (
    <Card variant="outlined" padding="sm">
      <Stack direction="row" gap={3} align="center">
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.full,
            backgroundColor: theme.color.bg.overlay,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: theme.font.size.sm,
            fontWeight: theme.font.weight.medium,
            color: theme.color.text.muted,
            flexShrink: 0,
          }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>

        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          {subjectType === 'agent' && fingerprint ? (
            <KeyFingerprint fingerprint={fingerprint} size="sm" copyable />
          ) : (
            <Text variant="body">{displayName}</Text>
          )}
          {subjectType === 'human' && email && (
            <Text variant="caption" color="muted">
              {email}
            </Text>
          )}
        </Stack>

        <Stack direction="row" gap={2} align="center">
          <RoleBadge role={role} />
          {canRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
